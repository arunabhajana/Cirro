use crate::{auth, drive};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Manager, Window};
use tokio::process::Command;
#[derive(Default)]
pub struct FlowState(
    pub tokio::sync::Mutex<()>,
    pub std::sync::Mutex<Option<String>>,
    pub std::sync::atomic::AtomicBool,
);
struct Running<'a>(&'a Window);
impl Drop for Running<'_> {
    fn drop(&mut self) {
        let state = self.0.state::<FlowState>();
        if let Ok(mut running) = state.1.lock() {
            *running = None;
        }
        let _ = self.0.emit("cirro-flow", ());
    }
}
#[derive(Clone, Serialize, Deserialize)]
struct Pair {
    id: String,
    account: String,
    local: String,
    remote: String,
    name: String,
    initialized: bool,
    paused: bool,
    last: u64,
    error: String,
    #[serde(default)]
    retry_at: u64,
    #[serde(default)]
    failures: u32,
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn retryable(error: &str) -> bool {
    let error = error.to_lowercase();
    // Recovery/integrity failures take precedence even if the engine also logged a timeout.
    if [
        "resync",
        "bisync critical",
        "exceeded --max-delete",
        "access check",
        "permission",
        "invalid_grant",
        "401",
        "storagequotaexceeded",
        "collision",
        "no space left",
        "disk full",
    ]
    .iter()
    .any(|text| error.contains(text))
    {
        return false;
    }
    [
        "offline",
        "unreachable",
        "network",
        "timed out",
        "timeout",
        "dns",
        "connection reset",
        "connection refused",
        "connection closed",
        "error sending request",
        "could not connect to google",
        "temporary failure",
        "temporarily unavailable",
        "429",
        "500 internal",
        "drive 500",
        "502",
        "503",
        "504",
        "ratelimitexceeded",
        "userratelimitexceeded",
        "service unavailable",
    ]
    .iter()
    .any(|text| error.contains(text))
}
fn retry_delay(failures: u32) -> u64 {
    (60u64.saturating_mul(1u64 << failures.saturating_sub(1).min(5))).min(1800)
}
pub(crate) fn cloud_source(window: &Window, id: &str) -> Result<(String, String, String), String> {
    let pair = pairs(window)?
        .into_iter()
        .find(|pair| pair.id == id)
        .ok_or("Flow folder not found")?;
    Ok((pair.account, pair.remote, pair.name))
}
fn overlaps(first: &Path, second: &Path) -> bool {
    #[cfg(windows)]
    {
        let first = first.to_string_lossy().replace('/', "\\").to_lowercase();
        let second = second.to_string_lossy().replace('/', "\\").to_lowercase();
        first == second
            || first.starts_with(&(second.clone() + "\\"))
            || second.starts_with(&(first + "\\"))
    }
    #[cfg(not(windows))]
    {
        first.starts_with(second) || second.starts_with(first)
    }
}
fn process_lease(window: &Window) -> Result<std::fs::File, String> {
    let directory = window
        .app_handle()
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("Flow");
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let file = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(directory.join("engine.lock"))
        .map_err(|e| e.to_string())?;
    file.try_lock()
        .map_err(|_| "Flow is already running in another Cirro process.".to_string())?;
    Ok(file)
}
fn db(window: &Window) -> Result<rusqlite::Connection, String> {
    let c = drive::db(window)?;
    c.execute_batch(
        "CREATE TABLE IF NOT EXISTS flow_pairs(id TEXT PRIMARY KEY,data TEXT NOT NULL);",
    )
    .map_err(|e| e.to_string())?;
    Ok(c)
}
fn pairs(window: &Window) -> Result<Vec<Pair>, String> {
    let c = db(window)?;
    let mut q = c
        .prepare("SELECT data FROM flow_pairs ORDER BY id")
        .map_err(|e| e.to_string())?;
    let result = q
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .map(|row| {
            serde_json::from_str(&row.map_err(|e| e.to_string())?).map_err(|e| e.to_string())
        })
        .collect();
    result
}
fn save(window: &Window, pair: &Pair) -> Result<(), String> {
    db(window)?
        .execute(
            "INSERT OR REPLACE INTO flow_pairs VALUES(?,?)",
            rusqlite::params![
                pair.id,
                serde_json::to_string(pair).map_err(|e| e.to_string())?
            ],
        )
        .map_err(|e| e.to_string())?;
    let _ = window.emit("cirro-flow", ());
    Ok(())
}
pub(crate) fn engine(window: &Window) -> Result<PathBuf, String> {
    let development = Path::new(env!("CARGO_MANIFEST_DIR")).join("flow-engine/rclone.exe");
    let path = if cfg!(debug_assertions) {
        development
    } else {
        window
            .app_handle()
            .path()
            .resource_dir()
            .map_err(|e| e.to_string())?
            .join("flow-engine/rclone.exe")
    };
    if !path.is_file() {
        return Err(
            "The Cirro Flow engine is missing. Reinstall Cirro with its Flow engine.".into(),
        );
    }
    Ok(path)
}
fn state_dir(window: &Window, pair: &Pair) -> Result<PathBuf, String> {
    let path = window
        .app_handle()
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("Flow")
        .join(&pair.id);
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(path)
}
fn validate_tree(root: &Path) -> Result<usize, String> {
    let mut count = 0usize;
    let mut pending = vec![root.to_path_buf()];
    let mut seen = HashSet::new();
    while let Some(path) = pending.pop() {
        if !seen.insert(path.clone()) {
            return Err("Folder cycle detected.".into());
        }
        let metadata = std::fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if metadata.file_attributes() & 0x400 != 0 {
                return Err(format!("Links, junctions, and another provider’s cloud placeholders are not supported: {}",path.display()));
            }
        }
        if metadata.file_type().is_symlink() {
            return Err("Symbolic links are not supported in Flow folders.".into());
        }
        if metadata.is_dir() {
            for entry in std::fs::read_dir(&path).map_err(|e| e.to_string())? {
                let entry = entry.map_err(|e| e.to_string())?;
                if entry.file_name() == "Cirro Recovery" {
                    return Err("Cirro Recovery is reserved for recovery copies. Rename that local folder first.".into());
                }
                pending.push(entry.path());
            }
        } else if !metadata.is_file() {
            return Err("Unsupported filesystem item.".into());
        } else if path
            .file_name()
            .is_some_and(|name| name != ".cirro-flow-check")
        {
            count += 1;
        }
    }
    Ok(count)
}
async fn cloud(
    window: &Window,
    account: &str,
    method: reqwest::Method,
    path: &str,
    query: &[(&str, String)],
    body: Option<Value>,
) -> Result<Value, String> {
    auth::account_scope(account.to_string(), async {
        let state = window.state::<auth::AuthState>();
        let (_, token) = auth::drive_credentials(&state).await?;
        drive::api(&drive::client()?, &token, method, path, query, body).await
    })
    .await
}
async fn execute(window: &Window, pair: &Pair, args: Vec<String>) -> Result<(), String> {
    let credentials = auth::flow_credentials(&pair.account)?;
    let mut command = Command::new(engine(window)?);
    command
        .args(args)
        .env("RCLONE_CONFIG_CLOUD_TYPE", "drive")
        .env("RCLONE_CONFIG_CLOUD_CLIENT_ID", &credentials.0)
        .env("RCLONE_CONFIG_CLOUD_CLIENT_SECRET", &credentials.1)
        .env("RCLONE_CONFIG_CLOUD_ROOT_FOLDER_ID", &pair.remote)
        .env("RCLONE_CONFIG_CLOUD_TOKEN", &credentials.2)
        .env("RCLONE_CONFIG_CLOUD_SCOPE", "drive")
        .env("RCLONE_CONFIG_CLOUD_USE_TRASH", "true")
        .arg("--config")
        .arg(if cfg!(windows) { "NUL" } else { "/dev/null" })
        .kill_on_drop(true);
    #[cfg(windows)]
    {
        command.creation_flags(0x08000000);
    }
    use tokio::io::AsyncReadExt;
    command
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped());
    let mut child = command.spawn().map_err(|e| e.to_string())?;
    let pid = child.id().ok_or("Flow process has no identity")?;
    let mut stderr = child.stderr.take().ok_or("Could not capture Flow status")?;
    let reader = tokio::spawn(async move {
        let mut result = Vec::new();
        let mut chunk = [0u8; 1024];
        loop {
            let count = stderr.read(&mut chunk).await.unwrap_or(0);
            if count == 0 {
                break;
            }
            result.extend_from_slice(&chunk[..count]);
            if result.len() > 8192 {
                result.drain(..result.len() - 8192);
            }
        }
        result
    });
    let outcome = tokio::select! {status=child.wait()=>Some(status.map_err(|e|e.to_string())?),_=async{loop{tokio::time::sleep(Duration::from_secs(2)).await;if window.state::<FlowState>().2.load(std::sync::atomic::Ordering::SeqCst)||auth::flow_credentials(&pair.account).is_err()||pairs(window).ok().and_then(|list|list.into_iter().find(|p|p.id==pair.id)).is_none_or(|p|p.paused){break;}}}=>None};
    let status = if let Some(status) = outcome {
        status
    } else {
        let _ = child.kill().await;
        child.wait().await.map_err(|e| e.to_string())?;
        let _ = reader.await;
        let directory = state_dir(window, pair)?;
        for entry in std::fs::read_dir(directory).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            if entry.path().extension().is_some_and(|ext| ext == "lck") {
                if let Ok(raw) = std::fs::read_to_string(entry.path()) {
                    let owner = serde_json::from_str::<Value>(&raw)
                        .ok()
                        .and_then(|value| value["PID"].as_str().map(str::to_owned))
                        .unwrap_or_else(|| raw.trim().to_string());
                    if owner == pid.to_string() {
                        let _ = std::fs::remove_file(entry.path());
                    }
                }
            }
        }
        return Err(
            "Flow paused or account disconnected. Transfer state is retained for recovery.".into(),
        );
    };
    let stderr = reader.await.map_err(|e| e.to_string())?;
    if !status.success() {
        let mut error = String::from_utf8_lossy(&stderr).into_owned();
        let token: Value = serde_json::from_str(&credentials.2).unwrap_or(Value::Null);
        for secret in [
            &credentials.0,
            &credentials.1,
            &credentials.2,
            token["refresh_token"].as_str().unwrap_or(""),
        ] {
            if !secret.is_empty() {
                error = error.replace(secret, "[redacted]");
            }
        }
        return Err(format!(
            "Flow stopped safely ({}). {}",
            status.code().unwrap_or(-1),
            error.chars().take(2500).collect::<String>()
        ));
    }
    Ok(())
}
fn arguments(pair: &Pair, work: &Path) -> Vec<String> {
    let recovery = work.join("Recovery");
    let mut args = vec![
        "bisync".into(),
        "--compare".into(),
        "size,modtime,checksum".into(),
        pair.local.clone(),
        "cloud:".into(),
        "--workdir".into(),
        work.to_string_lossy().into_owned(),
        "--check-access".into(),
        "--check-filename".into(),
        ".cirro-flow-check".into(),
        "--max-delete".into(),
        "10".into(),
        "--conflict-resolve".into(),
        "none".into(),
        "--conflict-loser".into(),
        "num".into(),
        "--conflict-suffix".into(),
        "cirro-conflict".into(),
        "--resilient".into(),
        "--recover".into(),
        "--check-sync".into(),
        "true".into(),
        "--create-empty-src-dirs".into(),
        "--drive-skip-gdocs".into(),
        "--drive-skip-shortcuts".into(),
        "--exclude".into(),
        "/Cirro Recovery/**".into(),
        "--backup-dir1".into(),
        recovery.to_string_lossy().into_owned(),
        "--backup-dir2".into(),
        format!("cloud:Cirro Recovery/{}", now()),
        "--suffix".into(),
        format!(".cirro-recovery-{}", now()),
        "--retries".into(),
        "1".into(),
        "--log-level".into(),
        "ERROR".into(),
    ];
    if !pair.initialized {
        args.push("--resync".into());
    }
    args
}
async fn run(window: &Window, pair: &Pair) -> Result<(), String> {
    let root = Path::new(&pair.local);
    if !root.is_dir() {
        return Err("Local folder is missing. Restore the folder or reconnect the disk. No deletions were propagated.".into());
    }
    if std::fs::read_to_string(root.join(".cirro-flow-check"))
        .ok()
        .as_deref()
        != Some(&pair.id)
    {
        return Err("Folder identity marker is missing or changed. Sync paused to prevent accidental deletion.".into());
    }
    let local_count = validate_tree(root)?;
    let remote = cloud(
        window,
        &pair.account,
        reqwest::Method::GET,
        &format!("files/{}", pair.remote),
        &[("fields", "id,trashed,capabilities(canAddChildren)".into())],
        None,
    )
    .await?;
    if remote["trashed"] == true || remote["capabilities"]["canAddChildren"] != true {
        return Err(
            "Cloud folder is deleted or no longer writable. Restore its access before resuming."
                .into(),
        );
    }
    let remote_count = validate_remote(window, pair).await?;
    let work = state_dir(window, pair)?;
    if !pair.initialized {
        execute(
            window,
            pair,
            vec![
                "copyto".into(),
                root.join(".cirro-flow-check")
                    .to_string_lossy()
                    .into_owned(),
                "cloud:.cirro-flow-check".into(),
            ],
        )
        .await?;
    }
    let mut args = arguments(pair, &work);
    if let Some(index) = args.iter().position(|arg| arg == "--max-delete") {
        args[index + 1] = deletion_limit(local_count.max(remote_count)).to_string();
    }
    execute(window, pair, args).await
}
async fn tick(window: &Window) -> Result<(), String> {
    if !crate::storage_policy::background_allowed(window) {
        return Ok(());
    }
    let state = window.state::<FlowState>();
    let Ok(_guard) = state.0.try_lock() else {
        return Ok(());
    };
    let Ok(_lease) = process_lease(window) else {
        return Ok(());
    };
    for pair in pairs(window)?
        .into_iter()
        .filter(|p| !p.paused && p.retry_at <= now())
    {
        if state.2.load(std::sync::atomic::Ordering::SeqCst) {
            break;
        }
        *state.1.lock().map_err(|e| e.to_string())? = Some(pair.id.clone());
        let _running = Running(window);
        let _ = window.emit("cirro-flow", ());
        let result = run(window, &pair).await;
        let Some(mut current) = pairs(window)?.into_iter().find(|p| p.id == pair.id) else {
            continue;
        };
        match result {
            Ok(()) => {
                current.initialized = true;
                current.last = now();
                current.error.clear();
                current.failures = 0;
                current.retry_at = 0;
            }
            Err(error) => {
                let transient = retryable(&error);
                current.error = error;
                if !state.2.load(std::sync::atomic::Ordering::SeqCst) {
                    if transient && !current.paused {
                        current.failures = current.failures.saturating_add(1);
                        current.retry_at = now() + retry_delay(current.failures);
                    } else {
                        current.paused = true;
                        current.retry_at = 0;
                    }
                    let _ = window.emit("cirro-flow-error", json!({"name":current.name,"error":current.error,"retryAt":current.retry_at,"paused":current.paused}));
                }
            }
        }
        save(window, &current)?;
        *state.1.lock().map_err(|e| e.to_string())? = None;
        let _ = window.emit("cirro-flow", ());
    }
    Ok(())
}
#[tauri::command]
pub async fn flow_command(window: Window, action: String, args: Value) -> Result<Value, String> {
    if window.label() != "main" {
        return Err("Main window required.".into());
    }
    let text = |key: &str| {
        args[key]
            .as_str()
            .map(str::to_owned)
            .ok_or_else(|| format!("Missing {key}"))
    };
    if matches!(
        action.as_str(),
        "recovery-list" | "restore-copy" | "reveal-conflict"
    ) {
        let id = text("id")?;
        let pair = pairs(&window)?
            .into_iter()
            .find(|pair| pair.id == id)
            .ok_or("Flow folder not found")?;
        let recovery = state_dir(&window, &pair)?.join("Recovery");
        std::fs::create_dir_all(&recovery).map_err(|e| e.to_string())?;
        if action == "recovery-list" {
            return Ok(
                json!({"backups":recovery_files(&recovery,false)?,"conflicts":recovery_files(Path::new(&pair.local),true)?,"paused":pair.paused,"remote":pair.remote}),
            );
        }
        let key = text("path")?;
        let root = if action == "restore-copy" {
            recovery.clone()
        } else {
            PathBuf::from(&pair.local)
        };
        let relative = Path::new(&key);
        if relative.is_absolute()
            || relative
                .components()
                .any(|part| !matches!(part, std::path::Component::Normal(_)))
        {
            return Err("Invalid recovery path".into());
        }
        let source = std::fs::canonicalize(root.join(relative)).map_err(|e| e.to_string())?;
        let root = std::fs::canonicalize(root).map_err(|e| e.to_string())?;
        if !source.starts_with(&root) || !source.is_file() {
            return Err("Recovery file is outside this Flow".into());
        }
        if action == "reveal-conflict" {
            open::that(source.parent().ok_or("Parent missing")?).map_err(|e| e.to_string())?;
            return Ok(Value::Null);
        }
        if !pair.paused {
            return Err("Pause Flow before restoring a recovery copy".into());
        }
        let state = window.state::<FlowState>();
        let _guard = state
            .0
            .try_lock()
            .map_err(|_| "Wait for the active Flow process to stop")?;
        let _lease = process_lease(&window)?;
        validate_tree(Path::new(&pair.local))?;
        let parent = Path::new(&pair.local).join(relative.parent().unwrap_or(Path::new("")));
        std::fs::create_dir_all(&parent).map_err(|e| e.to_string())?;
        let resolved = std::fs::canonicalize(&parent).map_err(|e| e.to_string())?;
        let local = std::fs::canonicalize(&pair.local).map_err(|e| e.to_string())?;
        if !resolved.starts_with(&local) {
            return Err("Restore destination is outside this Flow".into());
        }
        let name = relative
            .file_name()
            .ok_or("Recovery name missing")?
            .to_string_lossy();
        let original = name
            .rsplit_once(".cirro-recovery-")
            .filter(|(_, suffix)| !suffix.is_empty() && suffix.chars().all(|c| c.is_ascii_digit()))
            .map(|(name, _)| name)
            .unwrap_or(&name);
        let target = crate::offline::readable_target(&resolved, original);
        use std::io::Write;
        let mut output = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)
            .map_err(|e| e.to_string())?;
        let result = (|| -> Result<(), String> {
            let mut input = std::fs::File::open(source).map_err(|e| e.to_string())?;
            std::io::copy(&mut input, &mut output).map_err(|e| e.to_string())?;
            output.flush().map_err(|e| e.to_string())?;
            output.sync_all().map_err(|e| e.to_string())
        })();
        drop(output);
        if let Err(error) = result {
            let _ = std::fs::remove_file(&target);
            return Err(error);
        }
        return Ok(json!(target.to_string_lossy()));
    }
    match action.as_str() {
        "list" => {
            let running = window
                .state::<FlowState>()
                .1
                .lock()
                .map_err(|e| e.to_string())?
                .clone();
            Ok(json!({"pairs":pairs(&window)?,"running":running}))
        }
        "run" => {
            for mut pair in pairs(&window)?.into_iter().filter(|p| !p.paused) {
                pair.retry_at = 0;
                save(&window, &pair)?;
            }
            let copy = window.clone();
            tauri::async_runtime::spawn(async move {
                let _ = tick(&copy).await;
            });
            Ok(Value::Null)
        }
        "add" => {
            let runtime = window.state::<FlowState>();
            let _guard = runtime.0.lock().await;
            let _lease = process_lease(&window)?;
            engine(&window)?;
            let account = text("account")?;
            auth::flow_credentials(&account)?;
            let local = std::fs::canonicalize(text("local")?)
                .map_err(|_| "Choose an existing local folder.")?;
            if !local.is_dir() || local.parent().is_none() {
                return Err("Choose a folder, not a drive root.".into());
            }
            validate_tree(&local)?;
            let appdata = window
                .app_handle()
                .path()
                .app_local_data_dir()
                .map_err(|e| e.to_string())?;
            if overlaps(&local, &appdata) {
                return Err("Cirro’s own data directory cannot be synced.".into());
            }
            for pair in pairs(&window)? {
                let previous = Path::new(&pair.local);
                if overlaps(previous, &local) {
                    return Err(
                        "Flow folders cannot overlap another pair, even in another account.".into(),
                    );
                }
            }
            if local.join(".cirro-flow-check").exists() {
                return Err(
                    "This folder already has a Flow identity. Use its existing pair.".into(),
                );
            }
            let root=cloud(&window,&account,reqwest::Method::GET,"files",&[("q","name = 'Cirro' and mimeType = 'application/vnd.google-apps.folder' and 'root' in parents and 'me' in owners and trashed = false".into()),("fields","files(id),nextPageToken".into())],None).await?;
            let roots = root["files"].as_array().ok_or("Invalid Drive response.")?;
            if roots.len() > 1 {
                return Err(
                    "Multiple Cirro folders exist in My Drive. Rename the duplicates first.".into(),
                );
            }
            let root_id = if let Some(root) = roots.first() {
                root["id"].as_str().ok_or("Missing root ID")?.to_string()
            } else {
                cloud(&window,&account,reqwest::Method::POST,"files",&[("fields","id".into())],Some(json!({"name":"Cirro","mimeType":"application/vnd.google-apps.folder","parents":["root"]}))).await?["id"].as_str().ok_or("Missing Cirro ID")?.to_string()
            };
            let name = local
                .file_name()
                .ok_or("Folder name missing")?
                .to_string_lossy()
                .into_owned();
            let siblings = cloud(
                &window,
                &account,
                reqwest::Method::GET,
                "files",
                &[
                    ("q", format!("'{root_id}' in parents and trashed=false")),
                    ("fields", "files(name),nextPageToken".into()),
                    ("pageSize", "1000".into()),
                ],
                None,
            )
            .await?;
            if siblings["nextPageToken"].is_string() {
                return Err(
                    "Cirro contains too many destinations. Clean up unused folders first.".into(),
                );
            }
            let mut destination = name.clone();
            let mut suffix = 2;
            while siblings["files"]
                .as_array()
                .is_some_and(|files| files.iter().any(|f| f["name"] == destination))
            {
                destination = format!("{name} ({suffix})");
                suffix += 1;
            }
            let remote=cloud(&window,&account,reqwest::Method::POST,"files",&[("fields","id".into())],Some(json!({"name":destination,"mimeType":"application/vnd.google-apps.folder","parents":[root_id]}))).await?;
            let id = format!(
                "{}-{}",
                now(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_nanos()
            );
            let pair = Pair {
                id,
                account,
                local: local.to_string_lossy().into_owned(),
                remote: remote["id"]
                    .as_str()
                    .ok_or("Missing destination ID")?
                    .into(),
                name: destination,
                initialized: false,
                paused: false,
                last: 0,
                error: String::new(),
                retry_at: 0,
                failures: 0,
            };
            let mut pair = pair;
            pair.paused = true;
            save(&window, &pair)?;
            use std::io::Write;
            let mut marker = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(local.join(".cirro-flow-check"))
                .map_err(|e| e.to_string())?;
            marker
                .write_all(pair.id.as_bytes())
                .map_err(|e| e.to_string())?;
            marker.sync_all().map_err(|e| e.to_string())?;
            pair.paused = false;
            save(&window, &pair)?;
            Ok(json!(pair))
        }
        "pause" | "resume" | "remove" | "open" | "recovery" => {
            let id = text("id")?;
            let mut pair = pairs(&window)?
                .into_iter()
                .find(|p| p.id == id)
                .ok_or("Flow folder not found")?;
            if action == "open" {
                open::that(&pair.local).map_err(|e| e.to_string())?;
            } else if action == "recovery" {
                let path = state_dir(&window, &pair)?.join("Recovery");
                std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
                open::that(path).map_err(|e| e.to_string())?;
            } else if action == "remove" {
                if window
                    .state::<FlowState>()
                    .1
                    .lock()
                    .map_err(|e| e.to_string())?
                    .as_deref()
                    == Some(&id)
                {
                    return Err("Pause Flow and wait for the current process to stop first.".into());
                }
                db(&window)?
                    .execute("DELETE FROM flow_pairs WHERE id=?", [id])
                    .map_err(|e| e.to_string())?;
                let marker = Path::new(&pair.local).join(".cirro-flow-check");
                if std::fs::read_to_string(&marker).ok().as_deref() == Some(&pair.id) {
                    let _ = std::fs::remove_file(marker);
                }
                let _ = window.emit("cirro-flow", ());
            } else {
                pair.paused = action == "pause";
                if !pair.paused {
                    pair.error.clear();
                    pair.retry_at = 0;
                    pair.failures = 0;
                }
                save(&window, &pair)?;
            }
            Ok(Value::Null)
        }
        _ => Err("Unknown Flow action".into()),
    }
}
fn recovery_files(root: &Path, conflicts: bool) -> Result<Vec<Value>, String> {
    let mut files = vec![];
    let mut queue = vec![root.to_path_buf()];
    while let Some(path) = queue.pop() {
        for entry in std::fs::read_dir(path).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let metadata = entry.path().symlink_metadata().map_err(|e| e.to_string())?;
            if metadata.file_type().is_symlink() {
                continue;
            }
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                if metadata.file_attributes() & 0x400 != 0 {
                    continue;
                }
            }
            if metadata.is_dir() {
                queue.push(entry.path());
            } else if !conflicts
                || entry
                    .file_name()
                    .to_string_lossy()
                    .contains("cirro-conflict")
            {
                files.push(json!({"path":entry.path().strip_prefix(root).map_err(|e|e.to_string())?.to_string_lossy(),"size":metadata.len(),"modified":metadata.modified().ok().and_then(|time|time.duration_since(UNIX_EPOCH).ok()).map(|time|time.as_secs())}));
                if files.len() >= 5000 {
                    return Ok(files);
                }
            }
        }
    }
    files.sort_by(|a, b| b["modified"].as_u64().cmp(&a["modified"].as_u64()));
    Ok(files)
}
pub fn start(app: &tauri::App) {
    if let Some(window) = app.get_webview_window("main") {
        let window = window.as_ref().window().clone();
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(60)).await;
                let _ = tick(&window).await;
            }
        });
    }
}

pub async fn shutdown(app: tauri::AppHandle) {
    let state = app.state::<FlowState>();
    state.2.store(true, std::sync::atomic::Ordering::SeqCst);
    let _guard = state.0.lock().await;
}

#[cfg(test)]
mod tests {
    use super::*;
    fn pair() -> Pair {
        Pair {
            id: "test".into(),
            account: "one".into(),
            local: "C:\\Test".into(),
            remote: "remote-id".into(),
            name: "Test".into(),
            initialized: true,
            paused: false,
            last: 0,
            error: String::new(),
            retry_at: 0,
            failures: 0,
        }
    }
    #[test]
    fn transient_errors_retry_but_safety_and_auth_failures_do_not() {
        for error in [
            "Drive is unreachable",
            "error sending request",
            "HTTP 429",
            "503 Service Unavailable",
            "connection reset",
        ] {
            assert!(retryable(error), "{error}");
        }
        for error in [
            "resync required after network timeout",
            "bisync critical error: network",
            "permission denied",
            "invalid_grant",
            "storageQuotaExceeded",
            "Filename collision",
            "exceeded --max-delete",
        ] {
            assert!(!retryable(error), "{error}");
        }
        assert_eq!(retry_delay(1), 60);
        assert_eq!(retry_delay(2), 120);
        assert_eq!(retry_delay(1000), 1800);
    }
    #[test]
    fn established_pair_never_automatically_resyncs_or_forces_deletes() {
        let args = arguments(&pair(), Path::new("C:\\AppData\\Flow\\test"));
        assert_eq!(args[0], "bisync");
        assert!(!args.iter().any(|arg| arg == "--resync"
            || arg == "--force"
            || arg == "--inplace"
            || arg == "--drive-use-trash=false"));
        for flag in [
            "--check-access",
            "--recover",
            "--backup-dir1",
            "--backup-dir2",
            "--max-delete",
        ] {
            assert!(args.iter().any(|arg| arg == flag));
        }
    }
    #[test]
    fn first_run_only_establishes_the_baseline() {
        let mut pair = pair();
        pair.initialized = false;
        assert!(arguments(&pair, Path::new("state"))
            .iter()
            .any(|arg| arg == "--resync"));
    }
    #[test]
    fn conflict_policy_keeps_both_and_compares_checksums() {
        let args = arguments(&pair(), Path::new("state"));
        assert!(args
            .windows(2)
            .any(|args| args == ["--conflict-resolve", "none"]));
        assert!(args
            .windows(2)
            .any(|args| args == ["--conflict-loser", "num"]));
        assert!(args
            .windows(2)
            .any(|args| args == ["--compare", "size,modtime,checksum"]));
    }
    #[test]
    fn overlap_respects_windows_case_and_directory_boundaries() {
        assert!(overlaps(
            Path::new("C:\\Work"),
            Path::new("c:\\work\\nested")
        ));
        assert!(!overlaps(Path::new("C:\\Work"), Path::new("C:\\Workspace")));
    }
    #[test]
    fn deletion_guard_allows_small_intentional_changes_but_limits_large_sets() {
        assert_eq!(deletion_limit(1), 100);
        assert_eq!(deletion_limit(5), 100);
        assert_eq!(deletion_limit(40), 13);
        assert_eq!(deletion_limit(1000), 10);
    }
}

async fn validate_remote(window: &Window, pair: &Pair) -> Result<usize, String> {
    let mut count = 0usize;
    let mut queue = vec![pair.remote.clone()];
    let mut seen = HashSet::new();
    while let Some(parent) = queue.pop() {
        if !seen.insert(parent.clone()) {
            return Err("Drive folder cycle detected. Flow paused.".into());
        }
        let mut page = String::new();
        let mut names = HashSet::new();
        loop {
            let listing = cloud(
                window,
                &pair.account,
                reqwest::Method::GET,
                "files",
                &[
                    ("q", format!("'{parent}' in parents and trashed=false")),
                    ("pageSize", "1000".into()),
                    ("pageToken", page),
                    (
                        "fields",
                        "files(id,name,mimeType),nextPageToken,incompleteSearch".into(),
                    ),
                ],
                None,
            )
            .await?;
            if listing["incompleteSearch"] == true {
                return Err("Incomplete Drive listing; no sync was started.".into());
            }
            for file in listing["files"].as_array().ok_or("Invalid Drive listing")? {
                let name = file["name"].as_str().ok_or("Missing filename")?;
                if parent == pair.remote && name == "Cirro Recovery" {
                    continue;
                }
                let mime = file["mimeType"].as_str().unwrap_or("");
                if mime.starts_with("application/vnd.google-apps.")
                    && mime != "application/vnd.google-apps.folder"
                {
                    continue;
                }
                let reserved = name.split('.').next().unwrap_or("").to_ascii_uppercase();
                if !names.insert(name.to_lowercase())
                    || name.ends_with([' ', '.'])
                    || name
                        .chars()
                        .any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
                    || [
                        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6",
                        "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6",
                        "LPT7", "LPT8", "LPT9",
                    ]
                    .contains(&reserved.as_str())
                {
                    return Err(format!("Drive filename collision or Windows-incompatible name: {name}. Rename it in Drive before resuming."));
                }
                if mime != "application/vnd.google-apps.folder" && name != ".cirro-flow-check" {
                    count += 1;
                }
                if mime == "application/vnd.google-apps.folder" {
                    queue.push(file["id"].as_str().ok_or("Missing folder ID")?.into());
                }
            }
            if let Some(next) = listing["nextPageToken"].as_str() {
                page = next.into();
            } else {
                break;
            }
        }
    }
    Ok(count)
}

fn deletion_limit(files: usize) -> usize {
    if files == 0 {
        100
    } else {
        (500usize.div_ceil(files)).clamp(10, 100)
    }
}
