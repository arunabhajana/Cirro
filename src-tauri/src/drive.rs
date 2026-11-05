use crate::auth::{self, AuthState};
use base64::Engine;
use reqwest::{Client, Method};
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use tauri::{Manager, State, Window};
#[derive(Default)]
pub struct DriveLock(pub(crate) tokio::sync::Mutex<()>);
#[tauri::command]
pub async fn drive_open(
    window: Window,
    state: State<'_, AuthState>,
    id: String,
) -> Result<(), String> {
    let user = auth::current_profile(&state).await?;
    let c = db(&window)?;
    let raw: String = c
        .query_row(
            "SELECT data FROM files WHERE account=? AND id=?",
            params![user.id, id],
            |row| row.get(0),
        )
        .map_err(|_| "File is not cached. Sync first.")?;
    let file: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let url = if let Some(link) = file["webViewLink"].as_str() {
        url::Url::parse(link).map_err(|_| "Invalid Drive link.")?
    } else {
        let mut link = url::Url::parse("https://drive.google.com/").unwrap();
        link.path_segments_mut().unwrap().extend(
            if file["mimeType"] == "application/vnd.google-apps.folder" {
                vec!["drive", "folders", id.as_str()]
            } else {
                vec!["file", "d", id.as_str(), "view"]
            },
        );
        link
    };
    if url.scheme() != "https"
        || !matches!(url.host_str(), Some("drive.google.com" | "docs.google.com"))
    {
        return Err("Untrusted Drive link.".into());
    }
    open::that_detached(url.as_str())
        .map_err(|_| "Could not open Google Drive in your browser.".into())
}
const FIELDS:&str="id,name,mimeType,size,quotaBytesUsed,parents,modifiedTime,viewedByMeTime,starred,trashed,explicitlyTrashed,shared,sharedWithMeTime,ownedByMe,thumbnailLink,webViewLink,capabilities,shortcutDetails,appProperties,driveId,resourceKey";
#[derive(Default)]
pub struct Uploads(tokio::sync::Mutex<std::collections::HashMap<String, (String, u64, u64)>>);
#[tauri::command]
pub async fn drive_upload_start(
    window: Window,
    state: State<'_, AuthState>,
    uploads: State<'_, Uploads>,
    body: Value,
    mime: String,
    size: u64,
) -> Result<String, String> {
    let (user, token) = auth::drive_credentials(&state).await?;
    let mut body = body;
    let choice = body
        .as_object_mut()
        .and_then(|body| body.remove("cirroConflict"))
        .and_then(|value| value.as_str().map(str::to_owned))
        .unwrap_or(
            crate::storage_policy::settings(&window)?["conflict"]
                .as_str()
                .unwrap_or("keep")
                .into(),
        );
    if !matches!(choice.as_str(), "keep" | "replace" | "ask") {
        return Err("Invalid upload conflict choice".into());
    }
    let original = body["name"]
        .as_str()
        .ok_or("Upload name missing")?
        .to_owned();
    let parent = body["parents"][0].as_str().unwrap_or("root").to_owned();
    let find = |name: String| {
        let token = token.clone();
        let parent = parent.clone();
        async move {
            api(
                &client()?,
                &token,
                reqwest::Method::GET,
                "files",
                &[
                    (
                        "q",
                        format!(
                            "'{}' in parents and name = '{}' and trashed = false",
                            parent.replace('\\', "\\\\").replace('\'', "\\'"),
                            name.replace('\\', "\\\\").replace('\'', "\\'")
                        ),
                    ),
                    (
                        "fields",
                        "files(id,mimeType,capabilities(canEdit)),nextPageToken".into(),
                    ),
                    ("supportsAllDrives", "true".into()),
                    ("includeItemsFromAllDrives", "true".into()),
                ],
                None,
            )
            .await
        }
    };
    let found = find(original.clone()).await?;
    let matches = found["files"].as_array().ok_or("Invalid Drive response")?;
    let mut replace = None;
    if !matches.is_empty() {
        match choice.as_str(){"ask"=>return Err("An upload name already exists. Refresh Drive, then choose Keep both or Replace before uploading.".into()),"replace"=>{if matches.len()!=1||found["nextPageToken"].is_string()||matches[0]["mimeType"].as_str().is_some_and(|mime|mime.starts_with("application/vnd.google-apps."))||matches[0]["capabilities"]["canEdit"]!=true{return Err("Cannot safely replace this item. Choose Keep both or resolve duplicate names in Drive.".into());}replace=Some(matches[0]["id"].as_str().ok_or("Missing file ID")?.to_owned());body.as_object_mut().ok_or("Invalid upload metadata")?.remove("parents");},_=>{let (stem,extension)=original.rsplit_once('.').map(|(stem,ext)|(stem.to_owned(),format!(".{ext}"))).unwrap_or((original.clone(),String::new()));let mut available=false;for index in 2..=100{let name=format!("{stem} ({index}){extension}");if find(name.clone()).await?["files"].as_array().is_some_and(|files|files.is_empty()){body["name"]=json!(name);available=true;break;}}if !available{return Err("Too many matching upload names. Rename the file before uploading.".into());}}}
    }
    let url = replace
        .as_ref()
        .map(|id| format!("https://www.googleapis.com/upload/drive/v3/files/{id}"))
        .unwrap_or("https://www.googleapis.com/upload/drive/v3/files".into());
    let response = client()?
        .request(
            if replace.is_some() {
                reqwest::Method::PATCH
            } else {
                reqwest::Method::POST
            },
            url,
        )
        .query(&[
            ("uploadType", "resumable"),
            ("supportsAllDrives", "true"),
            ("fields", FIELDS),
        ])
        .bearer_auth(token)
        .header("X-Upload-Content-Type", mime)
        .header("X-Upload-Content-Length", size)
        .json(&body)
        .send()
        .await
        .map_err(|_| "Could not start upload.")?;
    if !response.status().is_success() {
        return Err("Drive refused the upload. Check access and available storage.".into());
    }
    let location = response
        .headers()
        .get("location")
        .and_then(|v| v.to_str().ok())
        .ok_or("Google did not return an upload session.")?
        .to_string();
    let parsed = url::Url::parse(&location).map_err(|_| "Invalid upload session.")?;
    if parsed.scheme() != "https" || parsed.host_str() != Some("www.googleapis.com") {
        return Err("Invalid upload host.".into());
    }
    db(&window)?;
    uploads
        .0
        .lock()
        .await
        .insert(location.clone(), (user.id, 0, size));
    Ok(location)
}
#[tauri::command]
pub async fn drive_upload_chunk(
    window: Window,
    state: State<'_, AuthState>,
    uploads: State<'_, Uploads>,
    session: String,
    data: String,
    offset: u64,
    total: u64,
) -> Result<Option<Value>, String> {
    let serialization = window.state::<DriveLock>();
    let _operation_guard = serialization.0.lock().await;
    let _ = &_operation_guard;

    let (user, token) = auth::drive_credentials(&state).await?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|_| "Invalid upload data.")?;
    if bytes.len() > 4 * 1024 * 1024 {
        return Err("Upload chunk too large.".into());
    }
    let mut active = uploads.0.lock().await;
    let record = active
        .get_mut(&session)
        .ok_or("Upload session expired. Retry.")?;
    if record.0 != user.id
        || record.1 != offset
        || record.2 != total
        || offset + bytes.len() as u64 > total
    {
        return Err("Upload offset or account mismatch.".into());
    }
    let length = bytes.len() as u64;
    let range = if total == 0 {
        "bytes */0".into()
    } else {
        format!("bytes {}-{}/{}", offset, offset + length - 1, total)
    };
    let response = client()?
        .put(&session)
        .bearer_auth(token)
        .header("Content-Range", range)
        .body(bytes)
        .send()
        .await
        .map_err(|_| "Upload interrupted. Retry the upload.")?;
    let status = response.status();
    if status.as_u16() == 308 {
        record.1 += length;
        return Ok(None);
    }
    if !status.is_success() {
        return Err("Upload failed. Retry or check Drive storage.".into());
    }
    let file: Value = response
        .json()
        .await
        .map_err(|_| "Invalid upload response.")?;
    cache_file(&db(&window)?, &user.id, &file)?;
    active.remove(&session);
    Ok(Some(file))
}
#[tauri::command]
pub async fn drive_preference(
    window: Window,
    state: State<'_, AuthState>,
    key: String,
) -> Result<Value, String> {
    if key == "recent" && !crate::security::history_enabled() {
        return Ok(Value::Null);
    }
    let user = auth::current_profile(&state).await?;
    Ok(get(&db(&window)?, &user.id, &key)
        .and_then(|v| serde_json::from_str(&v).ok())
        .unwrap_or(Value::Null))
}
pub(crate) fn db(window: &Window) -> Result<Connection, String> {
    if window.label() != "main" {
        return Err("Main window required.".into());
    }
    let dir = window
        .app_handle()
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let c = Connection::open(dir.join("cirro.sqlite3")).map_err(|e| e.to_string())?;
    c.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    c.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA user_version=1; CREATE TABLE IF NOT EXISTS files(account TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(account,id)); CREATE TABLE IF NOT EXISTS settings(account TEXT NOT NULL,key TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(account,key)); CREATE TABLE IF NOT EXISTS activity(account TEXT NOT NULL,id INTEGER PRIMARY KEY AUTOINCREMENT,file_id TEXT,action TEXT,created TEXT DEFAULT CURRENT_TIMESTAMP); CREATE TABLE IF NOT EXISTS thumbnails(account TEXT NOT NULL,id TEXT NOT NULL,data BLOB NOT NULL,PRIMARY KEY(account,id));").map_err(|e|e.to_string())?;
    Ok(c)
}
pub(crate) fn get(c: &Connection, a: &str, k: &str) -> Option<String> {
    c.query_row(
        "SELECT value FROM settings WHERE account=? AND key=?",
        params![a, k],
        |r| r.get(0),
    )
    .ok()
}
pub(crate) fn put(c: &Connection, a: &str, k: &str, v: &str) -> Result<(), String> {
    c.execute(
        "INSERT OR REPLACE INTO settings VALUES(?,?,?)",
        params![a, k, v],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
pub(crate) fn client() -> Result<Client, String> {
    Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())
}
pub(crate) async fn api(
    client: &Client,
    token: &str,
    method: Method,
    path: &str,
    query: &[(&str, String)],
    body: Option<Value>,
) -> Result<Value, String> {
    let mut request = client
        .request(
            method,
            format!("https://www.googleapis.com/drive/v3/{path}"),
        )
        .bearer_auth(token)
        .query(
            &query
                .iter()
                .filter(|(key, value)| *key != "pageToken" || !value.is_empty())
                .collect::<Vec<_>>(),
        );
    if let Some(body) = body {
        request = request.json(&body)
    }
    let response = request
        .send()
        .await
        .map_err(|_| "Google Drive is unreachable. Please retry.".to_string())?;
    let status = response.status();
    if status == reqwest::StatusCode::NO_CONTENT {
        return Ok(Value::Null);
    }
    let value: Value = response
        .json()
        .await
        .map_err(|_| "Unreadable Drive response.".to_string())?;
    if !status.is_success() {
        let reason = value["error"]["errors"][0]["reason"]
            .as_str()
            .unwrap_or("requestFailed");
        return Err(format!(
            "Drive {}: [{}] {}",
            status.as_u16(),
            reason,
            value["error"]["message"]
                .as_str()
                .unwrap_or("Request failed. Check the file permissions and your connection.")
        ));
    }
    Ok(value)
}
fn cache_file(c: &Connection, a: &str, v: &Value) -> Result<(), String> {
    let id = v["id"].as_str().ok_or("File ID missing.")?;
    let previous: Option<String> = c
        .query_row(
            "SELECT json_extract(data,'$.modifiedTime') FROM files WHERE account=? AND id=?",
            params![a, id],
            |row| row.get(0),
        )
        .ok();
    c.execute(
        "INSERT OR REPLACE INTO files VALUES(?,?,?)",
        params![a, id, v.to_string()],
    )
    .map_err(|e| e.to_string())?;
    if previous.as_deref() != v["modifiedTime"].as_str() {
        c.execute(
            "DELETE FROM thumbnails WHERE account=? AND id=?",
            params![a, id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}
fn snapshot(c: &Connection, a: &str) -> Result<Value, String> {
    let mut stmt = c
        .prepare("SELECT data FROM files WHERE account=?")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([a], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    let mut files = vec![];
    for row in rows {
        files.push(
            serde_json::from_str::<Value>(&row.map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?,
        )
    }
    let mut stmt = c
        .prepare("SELECT key,value FROM settings WHERE account=?")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([a], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;
    let mut settings = serde_json::Map::new();
    for row in rows {
        let (k, v) = row.map_err(|e| e.to_string())?;
        settings.insert(k, serde_json::from_str(&v).unwrap_or(Value::String(v)));
    }
    Ok(json!({"files":files,"settings":settings}))
}
#[tauri::command]
pub async fn drive_cache(window: Window, state: State<'_, AuthState>) -> Result<Value, String> {
    let user = auth::current_profile(&state).await?;
    snapshot(&db(&window)?, &user.id)
}
#[tauri::command]
pub async fn drive_setting(
    window: Window,
    state: State<'_, AuthState>,
    key: String,
    value: Value,
) -> Result<(), String> {
    if key.len() > 100 || value.to_string().len() > 1_000_000 {
        return Err("Preference too large.".into());
    }
    let user = auth::current_profile(&state).await?;
    let c = db(&window)?;
    if key == "recent" && !crate::security::history_enabled() {
        return Ok(());
    }
    if key == "recent" && get(&c, &user.id, &key).as_deref() != Some(&value.to_string()) {
        if let Some(id) = value.get(0).and_then(Value::as_str) {
            c.execute(
                "INSERT INTO activity(account,file_id,action) VALUES(?,?,'open')",
                params![user.id, id],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    put(&c, &user.id, &key, &value.to_string())
}
#[tauri::command]
pub async fn drive_sync(window: Window, state: State<'_, AuthState>) -> Result<Value, String> {
    let serialization = window.state::<DriveLock>();
    let _operation_guard = serialization.0.lock().await;

    let (user, token) = auth::drive_credentials(&state).await?;
    let http = client()?;
    let c = db(&window)?;
    let cursor = get(&c, &user.id, "cursor");
    let full = cursor.is_none();
    let previous_shared: Value = get(&c, &user.id, "sharedDrives")
        .and_then(|v| serde_json::from_str(&v).ok())
        .unwrap_or(json!([]));
    let cached_about: Option<Value> =
        get(&c, &user.id, "about").and_then(|v| serde_json::from_str(&v).ok());
    let cached_root = get(&c, &user.id, "root");
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();
    let refreshed = get(&c, &user.id, "summaryRefreshed")
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(0);
    let refresh_summary = full || now.saturating_sub(refreshed) >= 300;
    drop(c);
    let mut updated = vec![];
    let mut removed = vec![];
    let next;
    if let Some(cursor) = cursor {
        let mut page = cursor;
        loop {
            let data=api(&http,&token,Method::GET,"changes",&[("pageToken",page),("pageSize","1000".into()),("supportsAllDrives","true".into()),("includeItemsFromAllDrives","true".into()),("fields",format!("nextPageToken,newStartPageToken,changes(fileId,removed,file({FIELDS}))"))],None).await;
            let data = match data {
                Ok(value) => value,
                Err(error)
                    if error.starts_with("Drive 410:") || error.contains("pageTokenExpired") =>
                {
                    let c = db(&window)?;
                    c.execute(
                        "DELETE FROM settings WHERE account=? AND key='cursor'",
                        [&user.id],
                    )
                    .map_err(|e| e.to_string())?;
                    drop(c);
                    drop(_operation_guard);
                    return Box::pin(drive_sync(window, state)).await;
                }
                Err(error) => return Err(error),
            };
            for change in data["changes"]
                .as_array()
                .ok_or("Invalid changes response.")?
            {
                if change["removed"] == true {
                    removed.push(change["fileId"].as_str().unwrap_or("").to_string())
                } else if change["file"].is_object() {
                    updated.push(change["file"].clone())
                }
            }
            if let Some(p) = data["nextPageToken"].as_str() {
                page = p.into()
            } else {
                next = data["newStartPageToken"]
                    .as_str()
                    .ok_or("Missing sync cursor.")?
                    .to_string();
                break;
            }
        }
    } else {
        let start = api(
            &http,
            &token,
            Method::GET,
            "changes/startPageToken",
            &[("supportsAllDrives", "true".into())],
            None,
        )
        .await?;
        next = start["startPageToken"]
            .as_str()
            .ok_or("Missing sync token.")?
            .into();
        let mut page = String::new();
        loop {
            let data = api(
                &http,
                &token,
                Method::GET,
                "files",
                &[
                    ("pageSize", "1000".into()),
                    ("pageToken", page),
                    ("spaces", "drive".into()),
                    ("corpora", "user".into()),
                    ("supportsAllDrives", "true".into()),
                    ("includeItemsFromAllDrives", "true".into()),
                    (
                        "fields",
                        format!("nextPageToken,incompleteSearch,files({FIELDS})"),
                    ),
                ],
                None,
            )
            .await?;
            if data["incompleteSearch"] == true {
                return Err("Drive returned an incomplete listing. Retry sync.".into());
            }
            updated.extend(
                data["files"]
                    .as_array()
                    .ok_or("Invalid file listing.")?
                    .clone(),
            );
            if let Some(p) = data["nextPageToken"].as_str() {
                page = p.into()
            } else {
                break;
            }
        }
    }
    let about = if !refresh_summary && cached_about.is_some() {
        cached_about.unwrap_or_default()
    } else {
        api(
            &http,
            &token,
            Method::GET,
            "about",
            &[("fields", "storageQuota,user".into())],
            None,
        )
        .await?
    };
    let root = if let Some(id) = cached_root {
        json!({"id":id})
    } else {
        api(
            &http,
            &token,
            Method::GET,
            "files/root",
            &[("fields", "id".into())],
            None,
        )
        .await?
    };
    let mut shared = if refresh_summary {
        vec![]
    } else {
        previous_shared.as_array().cloned().unwrap_or_default()
    };
    let mut shared_page = String::new();
    if refresh_summary {
        loop {
            let data = api(
                &http,
                &token,
                Method::GET,
                "drives",
                &[
                    ("pageSize", "100".into()),
                    ("pageToken", shared_page),
                    ("fields", "nextPageToken,drives(id,name)".into()),
                ],
                None,
            )
            .await?;
            shared.extend(data["drives"].as_array().cloned().unwrap_or_default());
            if let Some(page) = data["nextPageToken"].as_str() {
                shared_page = page.into()
            } else {
                break;
            }
        }
    }
    for drive in shared.iter().filter(|_| refresh_summary) {
        let drive_id = drive["id"].as_str().ok_or("Shared drive ID missing.")?;
        updated.push(json!({"id":drive_id,"name":drive["name"],"mimeType":"application/vnd.google-apps.folder","parents":[root["id"].as_str().unwrap_or("root")],"driveId":drive_id}));
        let mut page = String::new();
        loop {
            let data = api(
                &http,
                &token,
                Method::GET,
                "files",
                &[
                    ("pageSize", "1000".into()),
                    ("pageToken", page),
                    ("corpora", "drive".into()),
                    ("driveId", drive_id.into()),
                    ("supportsAllDrives", "true".into()),
                    ("includeItemsFromAllDrives", "true".into()),
                    (
                        "fields",
                        format!("nextPageToken,incompleteSearch,files({FIELDS})"),
                    ),
                ],
                None,
            )
            .await?;
            if data["incompleteSearch"] == true {
                return Err("Shared drive listing incomplete. Retry sync.".into());
            }
            updated.extend(
                data["files"]
                    .as_array()
                    .ok_or("Invalid shared drive listing.")?
                    .clone(),
            );
            if let Some(next) = data["nextPageToken"].as_str() {
                page = next.into()
            } else {
                break;
            }
        }
    }
    if auth::current_profile(&state).await?.id != user.id {
        return Err("Account changed during sync.".into());
    }
    let mut c = db(&window)?;
    let tx = c.transaction().map_err(|e| e.to_string())?;
    if full {
        tx.execute("DELETE FROM files WHERE account=?", [&user.id])
            .map_err(|e| e.to_string())?;
    }
    for drive in previous_shared
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|_| refresh_summary)
    {
        if let Some(id) = drive["id"].as_str() {
            tx.execute(
                "DELETE FROM files WHERE account=? AND json_extract(data,'$.driveId')=? AND id NOT IN (SELECT json_extract(value,'$.id') FROM json_each(?))",
                params![user.id, id, serde_json::to_string(&updated).map_err(|e| e.to_string())?],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    put(
        &tx,
        &user.id,
        "sharedDrives",
        &serde_json::to_string(&shared).map_err(|e| e.to_string())?,
    )?;
    for id in removed {
        tx.execute(
            "DELETE FROM files WHERE account=? AND id=?",
            params![user.id, id],
        )
        .map_err(|e| e.to_string())?;
    }
    for file in updated {
        cache_file(&tx, &user.id, &file)?
    }
    if refresh_summary {
        put(&tx, &user.id, "summaryRefreshed", &now.to_string())?;
    }
    put(&tx, &user.id, "cursor", &next)?;
    put(&tx, &user.id, "about", &about.to_string())?;
    put(&tx, &user.id, "root", root["id"].as_str().unwrap_or("root"))?;
    tx.execute(
        "INSERT INTO activity(account,action) VALUES(?, 'sync')",
        [&user.id],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    snapshot(&c, &user.id)
}
#[tauri::command]
pub async fn drive_mutate(
    window: Window,
    state: State<'_, AuthState>,
    operation: String,
    id: Option<String>,
    body: Value,
) -> Result<Value, String> {
    let serialization = window.state::<DriveLock>();
    let _operation_guard = serialization.0.lock().await;

    let (user, token) = auth::drive_credentials(&state).await?;
    let http = client()?;
    let mut query = vec![
        ("supportsAllDrives", "true".into()),
        ("fields", FIELDS.into()),
    ];
    let id = id.unwrap_or_default();
    if id.contains('/') {
        return Err("Invalid file ID.".into());
    }
    if operation == "update" {
        if let Some(trashed) = body["trashed"].as_bool() {
            let file = api(
                &http,
                &token,
                Method::GET,
                &format!("files/{id}"),
                &[
                    ("supportsAllDrives", "true".into()),
                    (
                        "fields",
                        "name,capabilities(canTrash,canUntrash),ownedByMe,driveId".into(),
                    ),
                ],
                None,
            )
            .await?;
            let capability = if trashed { "canTrash" } else { "canUntrash" };
            if file["capabilities"][capability] == false {
                let verb = if trashed { "move to Trash" } else { "restore" };
                return Err(format!("{} cannot {} “{}”. Google denies this account permission for this file. Use its owner account or ask the shared-drive manager; reconnecting does not change file permissions.",user.email,verb,file["name"].as_str().unwrap_or("this file")));
            }
        }
    }
    let (method, path, body) = match operation.as_str() {
        "create" => (Method::POST, "files".to_string(), body),
        "copy" => (Method::POST, format!("files/{id}/copy"), body),
        "update" => (Method::PATCH, format!("files/{id}"), body),
        "move" => {
            if let Some(p) = body["addParents"].as_str() {
                query.push(("addParents", p.into()))
            }
            if let Some(p) = body["removeParents"].as_str() {
                query.push(("removeParents", p.into()))
            }
            (Method::PATCH, format!("files/{id}"), json!({}))
        }
        _ => return Err("Unsupported Drive operation.".into()),
    };
    let file = api(&http, &token, method, &path, &query, Some(body)).await?;
    let c = db(&window)?;
    cache_file(&c, &user.id, &file)?;
    c.execute(
        "INSERT INTO activity(account,file_id,action) VALUES(?,?,?)",
        params![user.id, file["id"].as_str(), operation],
    )
    .map_err(|e| e.to_string())?;
    Ok(file)
}
#[tauri::command]
pub async fn drive_content(
    window: Window,
    state: State<'_, AuthState>,
    id: String,
    thumbnail: bool,
) -> Result<Value, String> {
    if id.contains('/') {
        return Err("Invalid file ID.".into());
    }
    let user = auth::current_profile(&state).await?;
    if !thumbnail {
        if let Ok(Some(content)) = crate::offline::local_content(&window, &user.id, &id, false) {
            return Ok(content);
        }
    }
    let c = db(&window)?;
    if thumbnail {
        if let Ok(data) = c.query_row(
            "SELECT data FROM thumbnails WHERE account=? AND id=?",
            params![user.id, id],
            |r| r.get::<_, Vec<u8>>(0),
        ) {
            return Ok(
                json!({"data":base64::engine::general_purpose::STANDARD.encode(data),"mime":"image/jpeg"}),
            );
        }
    }
    let raw: String = c
        .query_row(
            "SELECT data FROM files WHERE account=? AND id=?",
            params![user.id, id],
            |r| r.get(0),
        )
        .map_err(|_| "File is not in the cache. Sync first.")?;
    drop(c);
    let file: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let (current, token) = auth::drive_credentials(&state).await?;
    if current.id != user.id {
        return Err("Account changed during preview.".into());
    }
    let http = client()?;
    let mime = file["mimeType"]
        .as_str()
        .unwrap_or("application/octet-stream");
    let export = mime.starts_with("application/vnd.google-apps.");
    let out = if export { "application/pdf" } else { mime };
    let mut request = if thumbnail {
        let url = file["thumbnailLink"]
            .as_str()
            .ok_or("No thumbnail available.")?;
        let parsed = url::Url::parse(url).map_err(|_| "Invalid thumbnail URL.")?;
        if parsed.scheme() != "https"
            || !parsed
                .host_str()
                .is_some_and(|h| h.ends_with(".googleusercontent.com") || h == "drive.google.com")
        {
            return Err("Untrusted thumbnail URL.".into());
        }
        http.get(url)
    } else {
        http.get(format!(
            "https://www.googleapis.com/drive/v3/files/{id}{}",
            if export { "/export" } else { "" }
        ))
        .query(&[(
            if export { "mimeType" } else { "alt" },
            if export { out } else { "media" },
        )])
    };
    request = request.bearer_auth(token);
    let response = request
        .send()
        .await
        .map_err(|_| "Content request failed.")?;
    if !response.status().is_success() {
        return Err("Google could not provide this content. Check file permissions.".into());
    }
    let limit = if thumbnail { 2_000_000 } else { 64_000_000 };
    if response.content_length().unwrap_or(0) > limit {
        return Err(
            "File exceeds the in-memory preview limit (64 MB). Open it in Google Drive.".into(),
        );
    }
    let mut response = response;
    let mut data = vec![];
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Content transfer failed.")?
    {
        if data.len() + chunk.len() > limit as usize {
            return Err(
                "File exceeds the in-memory preview limit (64 MB). Open it in Google Drive.".into(),
            );
        }
        crate::security::require_unlocked()?;
        data.extend_from_slice(&chunk)
    }
    if thumbnail {
        let c = db(&window)?;
        c.execute(
            "INSERT OR REPLACE INTO thumbnails VALUES(?,?,?)",
            params![user.id, id, data],
        )
        .map_err(|e| e.to_string())?;
        c.execute("DELETE FROM thumbnails WHERE rowid NOT IN (SELECT rowid FROM thumbnails ORDER BY rowid DESC LIMIT 1000)",[]).map_err(|e|e.to_string())?;
    }
    crate::security::require_unlocked()?;
    Ok(json!({"data":base64::engine::general_purpose::STANDARD.encode(data),"mime":out}))
}
