use super::*;
use crate::file_tools::request;
use reqwest::Method;
use std::collections::{HashSet, VecDeque};
const FIELDS:&str="id,name,mimeType,size,version,sha256Checksum,md5Checksum,parents,appProperties,ownedByMe,trashed,capabilities(canCopy,canDownload,canTrash,canAddChildren)";
async fn get(window: &Window, account: &str, id: &str) -> Result<Value, String> {
    crate::file_tools::valid_id(id)?;
    request(
        window,
        account,
        Method::GET,
        &format!("files/{id}"),
        &[
            ("fields", FIELDS.into()),
            ("supportsAllDrives", "true".into()),
        ],
        None,
    )
    .await
}
fn quoted(value: &str) -> String {
    value.replace('\\', "\\\\").replace('\'', "\\'")
}
async fn children(window: &Window, account: &str, parent: &str) -> Result<Vec<Value>, String> {
    let mut files = vec![];
    let mut page = String::new();
    loop {
        let value = request(
            window,
            account,
            Method::GET,
            "files",
            &[
                (
                    "q",
                    format!("'{}' in parents and trashed=false", quoted(parent)),
                ),
                (
                    "fields",
                    format!("files({FIELDS}),nextPageToken,incompleteSearch"),
                ),
                ("pageSize", "1000".into()),
                ("pageToken", page),
                ("supportsAllDrives", "true".into()),
                ("includeItemsFromAllDrives", "true".into()),
            ],
            None,
        )
        .await?;
        if value["incompleteSearch"] == true {
            return Err("Incomplete Drive listing. No source files were removed.".into());
        }
        files.extend(
            value["files"]
                .as_array()
                .ok_or("Invalid Drive listing")?
                .iter()
                .cloned(),
        );
        if let Some(next) = value["nextPageToken"].as_str() {
            page = next.into();
        } else {
            break;
        }
    }
    Ok(files)
}
fn folder(value: &Value) -> bool {
    value["mimeType"] == "application/vnd.google-apps.folder"
}
fn leaf(name: &str) -> Result<(), String> {
    if name.is_empty()
        || name == "."
        || name == ".."
        || name.contains(['/', '\\'])
        || name.chars().any(char::is_control)
    {
        Err("A Drive name cannot be represented safely. Rename it in Drive first.".into())
    } else {
        Ok(())
    }
}
async fn snapshot(window: &Window, account: &str, id: &str) -> Result<Vec<Value>, String> {
    let root = get(window, account, id).await?;
    if root["trashed"] == true {
        return Err("Source is in Trash".into());
    }
    let mut root = root;
    root["path"] = json!("");
    let mut nodes = vec![root.clone()];
    let mut queue = VecDeque::new();
    let mut visited = HashSet::new();
    if folder(&root) {
        queue.push_back((id.to_owned(), String::new()));
    }
    while let Some((id, path)) = queue.pop_front() {
        if !visited.insert(id.clone()) {
            return Err("Folder cycle detected".into());
        }
        let mut names = HashSet::new();
        for mut file in children(window, account, &id).await? {
            let name = file["name"].as_str().ok_or("Missing file name")?;
            leaf(name)?;
            if !names.insert(name.to_lowercase()) {
                return Err(
                    "Folder has duplicate names. Resolve them in Drive before transferring.".into(),
                );
            }
            let path = if path.is_empty() {
                name.to_owned()
            } else {
                format!("{path}/{name}")
            };
            file["path"] = json!(path);
            if folder(&file) {
                queue.push_back((file["id"].as_str().ok_or("Missing folder ID")?.into(), path));
            }
            nodes.push(file);
            if nodes.len() > 10000 {
                return Err(
                    "Transfer exceeds 10,000 items. Transfer smaller folders separately.".into(),
                );
            }
        }
    }
    Ok(nodes)
}
async fn allocate(
    window: &Window,
    account: &str,
    parent: &str,
    name: &str,
) -> Result<String, String> {
    leaf(name)?;
    let files = children(window, account, parent).await?;
    let names: HashSet<_> = files
        .iter()
        .filter_map(|file| file["name"].as_str())
        .map(str::to_lowercase)
        .collect();
    if !names.contains(&name.to_lowercase()) {
        return Ok(name.into());
    }
    let (stem, extension) = name
        .rsplit_once('.')
        .map(|(s, e)| (s.to_owned(), format!(".{e}")))
        .unwrap_or((name.into(), String::new()));
    for index in 2..10000 {
        let name = format!("{stem} ({index}){extension}");
        if !names.contains(&name.to_lowercase()) {
            return Ok(name);
        }
    }
    Err("Too many matching names. Rename the source first.".into())
}
async fn marked(
    window: &Window,
    account: &str,
    parent: &str,
    marker: &str,
) -> Result<Option<Value>, String> {
    let value=request(window,account,Method::GET,"files",&[("q",format!("'{}' in parents and trashed=false and appProperties has {{key='cirroTransfer' and value='{}'}}",quoted(parent),quoted(marker))),("fields",format!("files({FIELDS}),nextPageToken")),("supportsAllDrives","true".into()),("includeItemsFromAllDrives","true".into())],None).await?;
    let items = value["files"]
        .as_array()
        .ok_or("Invalid transfer marker listing")?;
    if items.len() > 1 || value["nextPageToken"].is_string() {
        return Err(
            "Ambiguous destination transfer markers. Review the destination before retrying."
                .into(),
        );
    }
    Ok(items.first().cloned())
}
async fn make_folder(
    window: &Window,
    job: &Job,
    parent: &str,
    name: &str,
    marker: &str,
) -> Result<String, String> {
    if let Some(file) = marked(window, &job.target, parent, marker).await? {
        return file["id"]
            .as_str()
            .map(str::to_owned)
            .ok_or("Missing destination ID".into());
    }
    let value=request(window,&job.target,Method::POST,"files",&[("fields","id".into()),("supportsAllDrives","true".into())],Some(json!({"name":name,"mimeType":"application/vnd.google-apps.folder","parents":[parent],"appProperties":{"cirroTransfer":marker}}))).await?;
    value["id"]
        .as_str()
        .map(str::to_owned)
        .ok_or("Missing folder ID".into())
}
pub async fn run(window: &Window, job: &mut Job) -> Result<(), String> {
    if job.kind == "download" {
        return download(window, job).await;
    }
    let target = get(window, &job.target, &job.parent).await?;
    if target["capabilities"]["canAddChildren"] != true || target["trashed"] == true {
        return Err("Destination is unavailable or read-only".into());
    }
    job.parent = target["id"]
        .as_str()
        .ok_or("Destination ID missing")?
        .into();
    checkpoint(window, job)?;
    if job.kind == "upload" {
        return upload(window, job).await;
    }
    let source = job.data["source"]
        .as_str()
        .ok_or("Source missing")?
        .to_owned();
    let root = get(window, &job.account, &source).await?;
    if root["trashed"] == true && !(job.kind == "move" && job.data["copyVerified"] == true) {
        return Err("Source was moved to Trash. Review it before retrying.".into());
    }
    if folder(&root) && job.account == job.target {
        let mut cursor = job.parent.clone();
        let mut seen = HashSet::new();
        loop {
            if cursor == source {
                return Err(
                    "A folder cannot be copied or moved into itself or a descendant".into(),
                );
            }
            if !seen.insert(cursor.clone()) {
                return Err("Destination ancestry is cyclic".into());
            }
            let parent = get(window, &job.target, &cursor).await?;
            if let Some(id) = parent["parents"][0].as_str() {
                cursor = id.into();
            } else {
                break;
            }
        }
    }
    if job.kind == "move" && job.account == job.target {
        if root["parents"]
            .as_array()
            .is_some_and(|parents| parents.iter().any(|parent| parent == &job.parent))
        {
            return Ok(());
        }
        let mut cursor = job.parent.clone();
        let mut seen = HashSet::new();
        loop {
            if cursor == source {
                return Err("A folder cannot be moved into itself or a descendant".into());
            }
            if !seen.insert(cursor.clone()) {
                return Err("Destination ancestry is cyclic".into());
            }
            let item = get(window, &job.target, &cursor).await?;
            if let Some(parent) = item["parents"][0].as_str() {
                cursor = parent.into();
            } else {
                break;
            }
        }
        check(window, &job.id)?;
        request(
            window,
            &job.account,
            Method::PATCH,
            &format!("files/{source}"),
            &[
                ("addParents", job.parent.clone()),
                (
                    "removeParents",
                    root["parents"]
                        .as_array()
                        .map(|parents| {
                            parents
                                .iter()
                                .filter_map(Value::as_str)
                                .collect::<Vec<_>>()
                                .join(",")
                        })
                        .unwrap_or_default(),
                ),
                ("supportsAllDrives", "true".into()),
            ],
            Some(json!({})),
        )
        .await?;
        return Ok(());
    }
    if job.kind == "move" && root["trashed"] == true && job.data["copyVerified"] == true {
        return Ok(());
    }
    if job.kind == "move" && root["capabilities"]["canTrash"] != true {
        return Err("This account cannot move the source to Trash. Choose Copy instead.".into());
    }
    if !job.data["nodes"].is_array() {
        job.data["nodes"] = json!(snapshot(window, &job.account, &source).await?);
        job.data["done"] = json!({});
        job.data["dirs"] = json!({});
        checkpoint(window, job)?;
    }
    let nodes = job.data["nodes"]
        .as_array()
        .ok_or("Transfer manifest missing")?
        .clone();
    job.total = nodes
        .iter()
        .filter_map(|item| {
            item["size"]
                .as_str()
                .and_then(|size| size.parse::<u64>().ok())
        })
        .sum();
    if !job.data["destinationName"].is_string() {
        job.data["destinationName"] = json!(
            allocate(
                window,
                &job.target,
                &job.parent,
                root["name"].as_str().ok_or("Source name missing")?
            )
            .await?
        );
        checkpoint(window, job)?;
    }
    job.bytes = nodes
        .iter()
        .filter(|item| {
            item["id"]
                .as_str()
                .is_some_and(|id| job.data["done"][id].is_string())
        })
        .filter_map(|item| {
            item["size"]
                .as_str()
                .and_then(|size| size.parse::<u64>().ok())
        })
        .sum();
    let destination_name = job.data["destinationName"]
        .as_str()
        .ok_or("Destination name missing")?
        .to_owned();
    if folder(&root) && !job.data["destRoot"].is_string() {
        let id = make_folder(
            window,
            job,
            &job.parent,
            &destination_name,
            &format!("{}-root", job.id),
        )
        .await?;
        job.data["destRoot"] = json!(id);
        checkpoint(window, job)?;
    }
    let destination = job.data["destRoot"]
        .as_str()
        .unwrap_or(&job.parent)
        .to_owned();
    for node in &nodes {
        check(window, &job.id)?;
        let id = node["id"].as_str().ok_or("Source identity missing")?;
        let path = node["path"].as_str().ok_or("Source path missing")?;
        if path.is_empty() && folder(node) {
            continue;
        }
        let current = get(window, &job.account, id).await?;
        if current["version"] != node["version"] || current["trashed"] == true {
            return Err("Source changed during transfer. Copies are retained; nothing was removed. Cancel and create a fresh transfer.".into());
        }
        let parent_path = path
            .rsplit_once('/')
            .map(|(parent, _)| parent)
            .unwrap_or("");
        let parent = if parent_path.is_empty() {
            destination.clone()
        } else {
            job.data["dirs"][parent_path]
                .as_str()
                .ok_or("Destination folder checkpoint missing")?
                .to_owned()
        };
        let name = if path.is_empty() {
            destination_name.as_str()
        } else {
            node["name"].as_str().ok_or("Name missing")?
        };
        if folder(node) {
            if !job.data["dirs"][path].is_string() {
                let dest =
                    make_folder(window, job, &parent, name, &format!("{}-{id}", job.id)).await?;
                job.data["dirs"][path] = json!(dest);
                checkpoint(window, job)?;
            }
            continue;
        }
        if node["capabilities"]["canCopy"] == false {
            return Err(format!("Drive does not permit copying {}", node["name"]));
        }
        if job.data["done"][id].is_string() {
            let destination = get(
                window,
                &job.target,
                job.data["done"][id].as_str().ok_or("Checkpoint missing")?,
            )
            .await?;
            verify(node, &destination)?;
            continue;
        }
        let marker = format!("{}-{id}", job.id);
        let destination = if let Some(destination) =
            marked(window, &job.target, &parent, &marker).await?
        {
            destination
        } else if job.account == job.target
            || node["mimeType"]
                .as_str()
                .is_some_and(|mime| mime.starts_with("application/vnd.google-apps."))
        {
            request(window,&job.target,Method::POST,&format!("files/{id}/copy"),&[("fields",FIELDS.into()),("supportsAllDrives","true".into())],Some(json!({"name":name,"parents":[parent],"appProperties":{"cirroTransfer":marker}}))).await.map_err(|error|format!("{error}. Google documents require the destination account to have access; share the source with it first. Source retained."))?
        } else {
            engine(
                window,
                job,
                vec![
                    "backend".into(),
                    "copyid".into(),
                    "source:".into(),
                    id.into(),
                    format!("target:{name}"),
                ],
                Some(&parent),
            )
            .await?;
            let matches = children(window, &job.target, &parent)
                .await?
                .into_iter()
                .filter(|file| file["name"] == name)
                .collect::<Vec<_>>();
            if matches.len() != 1 {
                return Err("Destination name is ambiguous. Source retained.".into());
            }
            let destination = matches[0].clone();
            verify(node, &destination)?;
            request(
                window,
                &job.target,
                Method::PATCH,
                &format!(
                    "files/{}",
                    destination["id"].as_str().ok_or("Destination missing")?
                ),
                &[("supportsAllDrives", "true".into())],
                Some(json!({"appProperties":{"cirroTransfer":marker}})),
            )
            .await?;
            destination
        };
        verify(node, &destination)?;
        job.data["done"][id] = destination["id"].clone();
        if node["mimeType"]
            .as_str()
            .is_some_and(|mime| mime.starts_with("application/vnd.google-apps."))
        {
            job.data["versions"][id] = destination["version"].clone();
        }
        job.bytes = nodes
            .iter()
            .filter(|item| {
                item["id"]
                    .as_str()
                    .is_some_and(|id| job.data["done"][id].is_string())
            })
            .filter_map(|item| {
                item["size"]
                    .as_str()
                    .and_then(|size| size.parse::<u64>().ok())
            })
            .sum();
        checkpoint(window, job)?;
    }
    if job.kind == "move" {
        for node in &nodes {
            check(window, &job.id)?;
            let id = node["id"].as_str().ok_or("Source identity missing")?;
            let path = node["path"].as_str().ok_or("Source path missing")?;
            let target = if folder(node) {
                if path.is_empty() {
                    &job.data["destRoot"]
                } else {
                    &job.data["dirs"][path]
                }
            } else {
                &job.data["done"][id]
            };
            let destination = get(
                window,
                &job.target,
                target.as_str().ok_or("Destination checkpoint missing")?,
            )
            .await?;
            verify(node, &destination)?;
            if !folder(node)
                && job.data["versions"][id].is_string()
                && job.data["versions"][id] != destination["version"]
            {
                return Err(
                    "Destination document changed during transfer. Source retained.".into(),
                );
            }
        }
        let fresh = snapshot(window, &job.account, &source).await?;
        if !same_snapshot(&nodes, &fresh) {
            return Err("Source changed during copy. Destination copies are retained; source was not removed.".into());
        }
        job.data["copyVerified"] = json!(true);
        checkpoint(window, job)?;
        check(window, &job.id)?;
        request(
            window,
            &job.account,
            Method::PATCH,
            &format!("files/{source}"),
            &[("supportsAllDrives", "true".into())],
            Some(json!({"trashed":true})),
        )
        .await?;
    }
    Ok(())
}
fn same_snapshot(left: &[Value], right: &[Value]) -> bool {
    let map = |items: &[Value]| {
        items
            .iter()
            .map(|item| {
                (
                    item["id"].to_string(),
                    (item["version"].to_string(), item["path"].to_string()),
                )
            })
            .collect::<std::collections::BTreeMap<_, _>>()
    };
    map(left) == map(right)
}
fn verify(source: &Value, destination: &Value) -> Result<(), String> {
    if destination["trashed"] == true || source["mimeType"] != destination["mimeType"] {
        return Err("Destination type changed or was deleted. Source retained.".into());
    }
    if source["mimeType"]
        .as_str()
        .is_some_and(|mime| mime.starts_with("application/vnd.google-apps."))
    {
        return Ok(());
    }
    if source["size"] != destination["size"] {
        return Err("Destination size does not match. Source retained.".into());
    }
    for key in ["sha256Checksum", "md5Checksum"] {
        if source[key].is_string() && destination[key].is_string() {
            if source[key] == destination[key] {
                return Ok(());
            }
            return Err("Destination checksum mismatch. Source retained.".into());
        }
    }
    Err("Drive supplied no checksum; the destination cannot be verified. Source retained.".into())
}
async fn upload(window: &Window, job: &mut Job) -> Result<(), String> {
    let root = directory(window, &job.id)?;
    if !job.data["planned"].is_boolean() {
        let mut top = HashSet::new();
        let files = job.data["files"]
            .as_array()
            .ok_or("Upload manifest missing")?
            .clone();
        let choice = job.data["choice"].as_str().unwrap_or("keep").to_owned();
        let existing = children(window, &job.target, &job.parent).await?;
        for file in &files {
            let path = file["path"].as_str().ok_or("Path missing")?;
            let name = path.split('/').next().ok_or("Name missing")?;
            if !top.insert(name.to_owned()) {
                continue;
            }
            let is_folder = path.contains('/');
            let matching = existing
                .iter()
                .filter(|item| {
                    item["name"]
                        .as_str()
                        .is_some_and(|value| value.eq_ignore_ascii_case(name))
                })
                .collect::<Vec<_>>();
            let planned_name = job.data["renames"][name].as_str().map(str::to_owned);
            if matching.is_empty() && planned_name.is_none() {
                continue;
            }
            if planned_name.is_none() && choice == "replace" && !is_folder {
                if matching.len() != 1
                    || folder(matching[0])
                    || matching[0]["mimeType"]
                        .as_str()
                        .is_some_and(|mime| mime.starts_with("application/vnd.google-apps."))
                {
                    return Err(
                        "Cannot replace an ambiguous or Google-native item. Retry with Keep both."
                            .into(),
                    );
                }
                continue;
            }
            if planned_name.is_none() && choice == "ask" {
                return Err(
                    "Choose Keep both or Replace in the upload dialog before retrying.".into(),
                );
            }
            let allocated = if let Some(name) = planned_name {
                name
            } else {
                let allocated = allocate(window, &job.target, &job.parent, name).await?;
                job.data["renames"][name] = json!(allocated);
                checkpoint(window, job)?;
                allocated
            };
            let from = root.join(relative(name)?);
            let to = root.join(relative(&allocated)?);
            if from.exists() {
                if to.exists() {
                    return Err(
                        "Staged upload destination already exists. Cancel and choose files again."
                            .into(),
                    );
                }
                std::fs::rename(&from, &to).map_err(|e| e.to_string())?;
            } else if !to.exists() {
                return Err("Staged upload is missing. Choose the files again.".into());
            }
            let mut adjusted = job.data["files"]
                .as_array()
                .ok_or("Upload manifest missing")?
                .clone();
            for item in &mut adjusted {
                if let Some(path) = item["path"].as_str() {
                    if path == name || path.starts_with(&format!("{name}/")) {
                        item["path"] = json!(format!("{allocated}{}", &path[name.len()..]));
                    }
                }
            }
            job.data["files"] = json!(adjusted);
            checkpoint(window, job)?;
        }
        job.data["planned"] = json!(true);
        checkpoint(window, job)?;
    }
    engine(
        window,
        job,
        vec![
            "copy".into(),
            root.to_string_lossy().into_owned(),
            "target:".into(),
            "--create-empty-src-dirs".into(),
        ],
        None,
    )
    .await
}
async fn engine(
    window: &Window,
    job: &mut Job,
    args: Vec<String>,
    target_root: Option<&str>,
) -> Result<(), String> {
    use std::process::Stdio;
    use tokio::{
        io::{AsyncBufReadExt, BufReader},
        process::Command,
    };
    let source = crate::auth::flow_credentials(&job.account)?;
    let target = crate::auth::flow_credentials(&job.target)?;
    let mut command = Command::new(crate::flow::engine(window)?);
    command.args(args).args([
        "--config",
        "NUL",
        "--checksum",
        "--retries",
        "1",
        "--low-level-retries",
        "2",
        "--use-json-log",
        "--stats",
        "1s",
        "--stats-log-level",
        "NOTICE",
        "--log-level",
        "NOTICE",
    ]);
    if job.kind != "download" && (job.kind != "upload" || job.data["choice"] != "replace") {
        command.arg("--immutable");
    }
    for (name, credentials, root) in [
        ("SOURCE", &source, "root"),
        ("TARGET", &target, target_root.unwrap_or(&job.parent)),
    ] {
        for (key, value) in [
            ("TYPE", "drive"),
            ("CLIENT_ID", credentials.0.as_str()),
            ("CLIENT_SECRET", credentials.1.as_str()),
            ("TOKEN", credentials.2.as_str()),
            ("ROOT_FOLDER_ID", root),
            ("USE_TRASH", "true"),
        ] {
            command.env(format!("RCLONE_CONFIG_{name}_{key}"), value);
        }
    }
    command
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let mut child = command.spawn().map_err(|e| e.to_string())?;
    let mut lines =
        BufReader::new(child.stderr.take().ok_or("Transfer output unavailable")?).lines();
    let base_bytes = if matches!(job.kind.as_str(), "copy" | "move") {
        job.bytes
    } else {
        0
    };
    let mut errors = String::new();
    let mut timer = tokio::time::interval(std::time::Duration::from_secs(1));
    loop {
        tokio::select! {
               line=lines.next_line()=>match line.map_err(|e|e.to_string())?{Some(line)=>{if let Ok(value)=serde_json::from_str::<Value>(&line){if value["stats"].is_object(){job.bytes=base_bytes.saturating_add(value["stats"]["bytes"].as_u64().unwrap_or(0));job.speed=value["stats"]["speed"].as_f64().unwrap_or(0.);if job.kind=="upload"{job.total=value["stats"]["totalBytes"].as_u64().unwrap_or(job.total);}checkpoint(window,job)?;}else if value["level"]=="error"{errors.push_str(value["msg"].as_str().unwrap_or("Transfer error"));errors.push('\n');}}
        if errors.len()>8192{errors=errors.chars().rev().take(8192).collect::<String>().chars().rev().collect();}},None=>break},
               _=timer.tick()=>{if let Err(error)=check(window,&job.id){let _=child.kill().await;let _=child.wait().await;return Err(error);}}
               }
    }
    let status = child.wait().await.map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        for credentials in [&source, &target] {
            let token: Value = serde_json::from_str(&credentials.2).unwrap_or(Value::Null);
            for secret in [
                credentials.0.as_str(),
                credentials.1.as_str(),
                credentials.2.as_str(),
                token["refresh_token"].as_str().unwrap_or(""),
                token["access_token"].as_str().unwrap_or(""),
            ] {
                if !secret.is_empty() {
                    errors = errors.replace(secret, "[redacted]");
                }
            }
        }
        Err(format!(
            "Transfer stopped safely ({}). {}",
            status.code().unwrap_or(-1),
            errors.chars().take(2500).collect::<String>()
        ))
    }
}
fn file_hash(path: &Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 1024];
    loop {
        crate::security::require_unlocked()?;
        let count = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}
async fn download(window: &Window, job: &mut Job) -> Result<(), String> {
    let id = job.data["source"]
        .as_str()
        .ok_or("Download source missing")?
        .to_owned();
    let source = get(window, &job.account, &id).await?;
    if folder(&source) || source["capabilities"]["canDownload"] == false {
        return Err("Choose a downloadable file".into());
    }
    if job.data["downloadVersion"].is_string() && job.data["downloadVersion"] != source["version"] {
        return Err(
            "Source changed since this download was queued. Cancel it and start a fresh download."
                .into(),
        );
    }
    if !job.data["downloadPath"].is_string() {
        let directory = Path::new(
            job.data["downloadDirectory"]
                .as_str()
                .ok_or("Download folder missing")?,
        );
        if !directory.is_dir() {
            return Err("Download folder is unavailable. Reconnect the drive and retry.".into());
        }
        let mut name = source["name"].as_str().ok_or("Name missing")?.to_owned();
        if source["mimeType"]
            .as_str()
            .is_some_and(|mime| mime.starts_with("application/vnd.google-apps."))
        {
            name.push_str(".pdf");
        }
        let target = crate::offline::readable_target(directory, &name);
        job.data["downloadPath"] = json!(target.to_string_lossy());
        job.data["downloadVersion"] = source["version"].clone();
        job.total = source["size"]
            .as_str()
            .and_then(|size| size.parse().ok())
            .unwrap_or(0);
        checkpoint(window, job)?;
    }
    let target = std::path::PathBuf::from(
        job.data["downloadPath"]
            .as_str()
            .ok_or("Download target missing")?,
    );
    if target.exists() {
        if job.data["downloadHash"]
            .as_str()
            .is_some_and(|hash| file_hash(&target).is_ok_and(|actual| actual == hash))
        {
            return Ok(());
        }
        return Err("Another file now exists at the download destination. Cancel and start a new download; it will receive a numbered name.".into());
    }
    let part = target
        .parent()
        .ok_or("Download parent missing")?
        .join(format!(".cirro-transfer-{}.part", job.id));
    engine(
        window,
        job,
        vec![
            "backend".into(),
            "copyid".into(),
            "source:".into(),
            id.clone(),
            part.to_string_lossy().into_owned(),
            "--inplace".into(),
            "--drive-export-formats".into(),
            "pdf".into(),
        ],
        None,
    )
    .await?;
    check(window, &job.id)?;
    let current = get(window, &job.account, &id).await?;
    if current["version"] != source["version"] {
        return Err("Source changed during download. The temporary copy was not published.".into());
    }
    let hash = file_hash(&part)?;
    if source["sha256Checksum"]
        .as_str()
        .is_some_and(|expected| expected != hash)
    {
        return Err("Download checksum mismatch. Retry the transfer.".into());
    }
    job.total = std::fs::metadata(&part).map_err(|e| e.to_string())?.len();
    job.data["downloadHash"] = json!(hash);
    checkpoint(window, job)?;
    check(window, &job.id)?;
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        let wide = |path: &Path| {
            path.as_os_str()
                .encode_wide()
                .chain(Some(0))
                .collect::<Vec<_>>()
        };
        unsafe {
            if windows_sys::Win32::Storage::FileSystem::MoveFileExW(
                wide(&part).as_ptr(),
                wide(&target).as_ptr(),
                windows_sys::Win32::Storage::FileSystem::MOVEFILE_WRITE_THROUGH,
            ) == 0
            {
                return Err(format!(
                    "Could not publish download without overwriting: {}",
                    std::io::Error::last_os_error()
                ));
            }
        }
    }
    #[cfg(not(windows))]
    {
        std::fs::hard_link(&part, &target).map_err(|e| e.to_string())?;
        std::fs::remove_file(&part).map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn verification_never_accepts_same_size_different_content() {
        let source = json!({"size":"5","mimeType":"text/plain","sha256Checksum":"original"});
        assert!(verify(
            &source,
            &json!({"size":"5","mimeType":"text/plain","sha256Checksum":"other"})
        )
        .is_err());
        assert!(verify(&source, &source).is_ok());
    }
    #[test]
    fn source_additions_block_cross_account_move_cleanup() {
        let original = vec![json!({"id":"a","version":"1","path":""})];
        let mut changed = original.clone();
        changed.push(json!({"id":"b","version":"1","path":"new"}));
        assert!(!same_snapshot(&original, &changed));
    }
}
