mod folders;
use crate::{
    auth::{self, AuthState},
    drive,
};
use reqwest::Client;
use serde_json::{json, Value};
use std::{io::Write, path::PathBuf};
use tauri::{Manager, State, Window};
pub(crate) fn readable_target(parent: &std::path::Path, name: &str) -> PathBuf {
    let safe = folders::leaf(name);
    let initial = parent.join(&safe);
    if !initial.exists() {
        return initial;
    }
    let (stem, ext) = safe
        .rsplit_once('.')
        .map(|(s, e)| (s, format!(".{e}")))
        .unwrap_or((&safe, String::new()));
    let mut index = 2;
    loop {
        let path = parent.join(format!("{stem} ({index}){ext}"));
        if !path.exists() {
            return path;
        }
        index += 1;
    }
}
fn install_copy(temporary: &std::path::Path, target: &std::path::Path) -> Result<(), String> {
    if std::fs::hard_link(temporary, target).is_err() {
        let mut output = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(target)
            .map_err(|e| e.to_string())?;
        let result = (|| {
            let mut input = std::fs::File::open(temporary)?;
            std::io::copy(&mut input, &mut output)?;
            output.sync_all()
        })();
        drop(output);
        if let Err(error) = result {
            let _ = std::fs::remove_file(target);
            return Err(error.to_string());
        }
    }
    std::fs::remove_file(temporary).map_err(|e| e.to_string())
}
pub(crate) fn local_content(
    window: &Window,
    account: &str,
    id: &str,
    allow_stale: bool,
) -> Result<Option<Value>, String> {
    use base64::Engine;
    use std::io::Read;
    let saved = match record(window, account, id) {
        Ok(saved) => saved,
        Err(_) => return Ok(None),
    };
    if saved["kind"] == "folder" || saved["onlineLink"] == true {
        return Ok(None);
    }
    let c = drive::db(window)?;
    let raw: Option<String> = c
        .query_row(
            "SELECT data FROM files WHERE account=? AND id=?",
            rusqlite::params![account, id],
            |row| row.get(0),
        )
        .ok();
    let metadata: Value = raw
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or(Value::Null);
    if !allow_stale
        && (metadata["modifiedTime"].is_null() || saved["modified"] != metadata["modifiedTime"])
    {
        return Ok(None);
    }
    let Some(path) = saved["path"].as_str() else {
        return Ok(None);
    };
    let file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(_) => return Ok(None),
    };
    if file.metadata().map_err(|e| e.to_string())?.len() > 64_000_000 {
        return Ok(None);
    }
    let mut bytes = Vec::new();
    file.take(64_000_001)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 64_000_000 {
        return Ok(None);
    }
    let source = metadata["mimeType"]
        .as_str()
        .unwrap_or("application/octet-stream");
    let mime = if source.starts_with("application/vnd.google-apps.")
        || path.to_ascii_lowercase().ends_with(".pdf")
    {
        "application/pdf"
    } else {
        source
    };
    Ok(Some(
        serde_json::json!({"data":base64::engine::general_purpose::STANDARD.encode(bytes),"mime":mime,"offline":true,"stale":saved["modified"]!=metadata["modifiedTime"]}),
    ))
}
#[tauri::command]
pub async fn offline_content(
    window: Window,
    state: State<'_, AuthState>,
    id: String,
) -> Result<Option<Value>, String> {
    let user = auth::current_profile(&state).await?;
    local_content(&window, &user.id, &id, true)
}

fn default_directory(window: &Window) -> Result<PathBuf, String> {
    Ok(window
        .app_handle()
        .path()
        .document_dir()
        .map_err(|e| e.to_string())?
        .join("Cirro"))
}
#[tauri::command]
pub async fn offline_directory(
    window: Window,
    state: State<'_, AuthState>,
    path: Option<String>,
) -> Result<String, String> {
    let user = auth::current_profile(&state).await?;
    let c = drive::db(&window)?;
    let directory = if let Some(path) = path {
        let directory = PathBuf::from(path.trim());
        if !directory.is_absolute() {
            return Err("Enter an absolute folder path.".into());
        }
        std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        drive::put(
            &c,
            &user.id,
            "offlineDirectory",
            &directory.to_string_lossy(),
        )?;
        directory
    } else {
        drive::get(&c, &user.id, "offlineDirectory")
            .map(PathBuf::from)
            .unwrap_or(default_directory(&window)?)
    };
    Ok(directory.to_string_lossy().into_owned())
}
fn record(window: &Window, account: &str, id: &str) -> Result<Value, String> {
    let c = drive::db(window)?;
    if let Some(raw) = drive::get(&c, account, &format!("offline:{id}")) {
        return serde_json::from_str(&raw).map_err(|e| e.to_string());
    }
    folders::find(window, account, id)?.ok_or("This item is not available offline.".into())
}
#[tauri::command]
pub async fn offline_open(
    window: Window,
    state: State<'_, AuthState>,
    id: String,
) -> Result<(), String> {
    let user = auth::current_profile(&state).await?;
    let value = record(&window, &user.id, &id)?;
    open::that(value["path"].as_str().ok_or("Offline path missing.")?).map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn offline_remove(
    window: Window,
    state: State<'_, AuthState>,
    id: String,
) -> Result<(), String> {
    let user = auth::current_profile(&state).await?;
    let lock = window.state::<drive::DriveLock>();
    let _guard = lock.0.lock().await;
    let value = record(&window, &user.id, &id)?;
    if value["kind"] == "folder" || value["owner"].is_string() {
        return folders::remove(&window, &user.id, &id, &value);
    }
    let path = value["path"].as_str().ok_or("Offline path missing.")?;
    match std::fs::remove_file(path) {
        Ok(()) => (),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
        Err(e) => return Err(e.to_string()),
    };
    let c = drive::db(&window)?;
    c.execute(
        "DELETE FROM settings WHERE account=? AND key=?",
        rusqlite::params![user.id, format!("offline:{id}")],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
pub async fn offline_save(
    window: Window,
    state: State<'_, AuthState>,
    id: String,
) -> Result<Value, String> {
    if id.is_empty()
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err("Invalid file ID.".into());
    }
    let lock = window.state::<drive::DriveLock>();
    let _guard = lock.0.lock().await;
    let (user, token) = auth::drive_credentials(&state).await?;
    let c = drive::db(&window)?;
    let raw: String = c
        .query_row(
            "SELECT data FROM files WHERE account=? AND id=?",
            rusqlite::params![user.id, id],
            |row| row.get(0),
        )
        .map_err(|_| "Sync this file first.")?;
    let metadata: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let mime = metadata["mimeType"].as_str().unwrap_or("");
    if mime.ends_with(".folder") {
        let base = drive::get(&c, &user.id, "offlineDirectory")
            .map(PathBuf::from)
            .unwrap_or(default_directory(&window)?);
        drop(c);
        return folders::save(&window, &state, &user.id, &metadata, base).await;
    }
    if mime.ends_with(".shortcut") {
        return Err("Choose a regular file to keep offline.".into());
    }
    let export = mime.starts_with("application/vnd.google-apps.");
    let base = drive::get(&c, &user.id, "offlineDirectory")
        .map(PathBuf::from)
        .unwrap_or(default_directory(&window)?);
    drop(c);
    let folder = base.join(folders::leaf(&user.email)).join("Files");
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let name = metadata["name"].as_str().unwrap_or("File");
    let name = if export {
        format!("{name}.pdf")
    } else {
        name.to_string()
    };
    let target = readable_target(&folder, &name);
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let temporary = folder.join(format!(".cirro-download-{nonce}.part"));
    let url = format!(
        "https://www.googleapis.com/drive/v3/files/{id}{}",
        if export { "/export" } else { "" }
    );
    let http = Client::builder()
        .timeout(std::time::Duration::from_secs(3600))
        .build()
        .map_err(|e| e.to_string())?;
    let mut response = http
        .get(url)
        .bearer_auth(token)
        .query(&[(
            if export { "mimeType" } else { "alt" },
            if export { "application/pdf" } else { "media" },
        )])
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    let result:Result<Value,String>=async {let mut output=std::fs::OpenOptions::new().write(true).create_new(true).open(&temporary).map_err(|e|e.to_string())?;while let Some(chunk)=response.chunk().await.map_err(|e|e.to_string())?{crate::security::require_unlocked()?;output.write_all(&chunk).map_err(|e|e.to_string())?;}output.sync_all().map_err(|e|e.to_string())?;drop(output);if auth::current_profile(&state).await?.id!=user.id{return Err("Account changed during download.".into());}install_copy(&temporary,&target)?;let value=json!({"path":target.to_string_lossy(),"modified":metadata["modifiedTime"],"name":metadata["name"]});drive::put(&drive::db(&window)?,&user.id,&format!("offline:{id}"),&value.to_string())?;Ok(value)}.await;
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result
}
