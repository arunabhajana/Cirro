mod worker;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Manager, Window};
#[derive(Default)]
pub struct TransferState {
    pub gate: tokio::sync::Mutex<()>,
    pub stopping: AtomicBool,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Job {
    pub id: String,
    pub kind: String,
    pub account: String,
    pub target: String,
    pub parent: String,
    pub name: String,
    pub state: String,
    pub error: String,
    pub bytes: u64,
    pub total: u64,
    pub speed: f64,
    pub attempt: u32,
    pub retry: u64,
    pub data: Value,
}
pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn database(window: &Window) -> Result<rusqlite::Connection, String> {
    let c = crate::drive::db(window)?;
    c.execute_batch(
        "CREATE TABLE IF NOT EXISTS transfer_jobs(id TEXT PRIMARY KEY,data TEXT NOT NULL);",
    )
    .map_err(|e| e.to_string())?;
    Ok(c)
}
pub fn jobs(window: &Window) -> Result<Vec<Job>, String> {
    let c = database(window)?;
    let mut query = c
        .prepare("SELECT data FROM transfer_jobs ORDER BY id DESC")
        .map_err(|e| e.to_string())?;
    let rows = query
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    rows.map(|row| {
        serde_json::from_str(&row.map_err(|e| e.to_string())?).map_err(|e| e.to_string())
    })
    .collect()
}
pub fn save(window: &Window, job: &Job) -> Result<(), String> {
    database(window)?
        .execute(
            "INSERT OR REPLACE INTO transfer_jobs VALUES(?,?)",
            rusqlite::params![
                job.id,
                serde_json::to_string(job).map_err(|e| e.to_string())?
            ],
        )
        .map_err(|e| e.to_string())?;
    let _ = window.emit("cirro-transfers", ());
    Ok(())
}
fn journal_transition(
    c: &rusqlite::Connection,
    id: &str,
    data: &str,
    expected: &str,
) -> rusqlite::Result<usize> {
    c.execute(
        "UPDATE transfer_jobs SET data=? WHERE id=? AND json_extract(data,'$.state')=?",
        rusqlite::params![data, id, expected],
    )
}
fn compare_save(window: &Window, job: &Job, expected: &str) -> Result<bool, String> {
    let changed = journal_transition(
        &database(window)?,
        &job.id,
        &serde_json::to_string(job).map_err(|e| e.to_string())?,
        expected,
    )
    .map_err(|e| e.to_string())?;
    if changed > 0 {
        let _ = window.emit("cirro-transfers", ());
    }
    Ok(changed > 0)
}
pub fn checkpoint(window: &Window, job: &Job) -> Result<(), String> {
    check(window, &job.id)?;
    if !compare_save(window, job, "running")? {
        return Err("Transfer state changed. Review it in Transfers.".into());
    }
    Ok(())
}
pub fn check(window: &Window, id: &str) -> Result<(), String> {
    crate::security::require_unlocked()?;
    if window
        .state::<TransferState>()
        .stopping
        .load(Ordering::SeqCst)
    {
        return Err("Cirro is closing. Work will resume on the next launch.".into());
    }
    let status: String = database(window)?
        .query_row(
            "SELECT json_extract(data,'$.state') FROM transfer_jobs WHERE id=?",
            [id],
            |row| row.get(0),
        )
        .map_err(|_| "Transfer removed")?;
    if matches!(status.as_str(), "paused" | "cancelled") {
        return Err("Transfer paused or cancelled".into());
    }
    Ok(())
}
fn directory(window: &Window, id: &str) -> Result<PathBuf, String> {
    crate::file_tools::valid_id(id)?;
    Ok(window
        .app_handle()
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("Transfers")
        .join(id)
        .join("Source"))
}
fn relative(value: &str) -> Result<PathBuf, String> {
    let path = Path::new(value);
    if value.is_empty()
        || value.contains(':')
        || value.contains('\\')
        || path
            .components()
            .any(|part| !matches!(part, std::path::Component::Normal(_)))
        || path.is_absolute()
    {
        return Err("Invalid upload path".into());
    }
    for part in value.split('/') {
        let stem = part
            .split('.')
            .next()
            .unwrap_or("")
            .trim_end()
            .to_ascii_uppercase();
        if ["CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$"].contains(&stem.as_str())
            || ["COM", "LPT"].iter().any(|prefix| {
                stem.strip_prefix(prefix).is_some_and(|number| {
                    ["1", "2", "3", "4", "5", "6", "7", "8", "9", "¹", "²", "³"].contains(&number)
                })
            })
        {
            return Err("Windows-reserved upload filename".into());
        }
        if part.ends_with([' ', '.'])
            || part
                .chars()
                .any(|c| c.is_control() || "<>\"|?*".contains(c))
            || part.encode_utf16().count() > 255
        {
            return Err("Windows-incompatible upload name".into());
        }
    }
    Ok(path.into())
}
#[tauri::command]
pub async fn transfer_command(
    window: Window,
    action: String,
    args: Value,
) -> Result<Value, String> {
    if window.label() != "main" {
        return Err("Main window required".into());
    }
    crate::security::require_unlocked()?;
    let text = |key: &str| {
        args[key]
            .as_str()
            .map(str::to_owned)
            .ok_or_else(|| format!("Missing {key}"))
    };
    if action == "list" {
        let values=jobs(&window)?.into_iter().map(|job|{let mut value=serde_json::to_value(&job).unwrap_or(Value::Null);value["data"]=json!({"items":job.data["files"].as_array().or(job.data["nodes"].as_array()).map(Vec::len),"completedItems":job.data["done"].as_object().map(serde_json::Map::len)});value}).collect::<Vec<_>>();
        return Ok(json!(values));
    }
    if action == "wake" {
        for mut job in jobs(&window)?
            .into_iter()
            .filter(|job| job.state == "waiting")
        {
            job.retry = 0;
            save(&window, &job)?;
        }
        wake(window);
        return Ok(Value::Null);
    }
    if action == "begin-upload" {
        let account = text("account")?;
        crate::auth::flow_credentials(&account)?;
        let parent = text("parent")?;
        crate::file_tools::valid_id(&parent)?;
        let files = args["files"].as_array().ok_or("Choose files")?;
        if files.is_empty() || files.len() > 10000 {
            return Err("Choose between 1 and 10,000 files per upload".into());
        }
        let mut names = std::collections::HashSet::new();
        let mut total = 0u64;
        for file in files {
            let path = file["path"].as_str().ok_or("File path missing")?;
            relative(path)?;
            if !names.insert(path.to_lowercase()) {
                return Err("Upload contains duplicate file paths".into());
            }
            total = total
                .checked_add(file["size"].as_u64().ok_or("File size missing")?)
                .ok_or("Upload is too large")?;
        }
        let id = format!(
            "{}-{}",
            now(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        );
        let path = directory(&window, &id)?;
        std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
        let job = Job {
            id,
            kind: "upload".into(),
            target: account.clone(),
            account,
            parent,
            name: args["name"].as_str().unwrap_or("Upload").into(),
            state: "staging".into(),
            error: String::new(),
            bytes: 0,
            total,
            speed: 0.,
            attempt: 0,
            retry: 0,
            data: json!({"files":files,"ready":[],"choice":args["choice"].as_str().unwrap_or("keep")}),
        };
        save(&window, &job)?;
        return Ok(json!(job.id));
    }
    if action == "stage" {
        use base64::Engine;
        use std::io::Write;
        let id = text("id")?;
        let mut job = jobs(&window)?
            .into_iter()
            .find(|job| job.id == id)
            .ok_or("Transfer missing")?;
        if job.state != "staging" {
            return Err("Upload is no longer being prepared".into());
        }
        let path = text("path")?;
        let relative = relative(&path)?;
        let size = job.data["files"]
            .as_array()
            .and_then(|files| files.iter().find(|file| file["path"] == path))
            .and_then(|file| file["size"].as_u64())
            .ok_or("File is not in this upload")?;
        let offset = args["offset"].as_u64().ok_or("Offset missing")?;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(text("data")?)
            .map_err(|_| "Invalid upload chunk")?;
        if bytes.len() > 4 * 1024 * 1024
            || offset
                .checked_add(bytes.len() as u64)
                .is_none_or(|end| end > size)
        {
            return Err("Upload preparation size mismatch".into());
        }
        let target = directory(&window, &id)?.join(relative);
        std::fs::create_dir_all(target.parent().ok_or("Invalid file path")?)
            .map_err(|e| e.to_string())?;
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .append(true)
            .open(&target)
            .map_err(|e| e.to_string())?;
        if file.metadata().map_err(|e| e.to_string())?.len() != offset {
            return Err("Upload preparation offset changed. Choose the files again.".into());
        }
        file.write_all(&bytes).map_err(|e| e.to_string())?;
        if offset + bytes.len() as u64 == size {
            file.sync_all().map_err(|e| e.to_string())?;
            let ready = job.data["ready"]
                .as_array_mut()
                .ok_or("Invalid upload journal")?;
            if !ready.iter().any(|value| value == &path) {
                ready.push(json!(path));
            }
        }
        job.bytes = job.bytes.saturating_add(bytes.len() as u64);
        save(&window, &job)?;
        return Ok(Value::Null);
    }
    if action == "commit-upload" {
        let id = text("id")?;
        let mut job = jobs(&window)?
            .into_iter()
            .find(|job| job.id == id)
            .ok_or("Transfer missing")?;
        if job.state != "staging"
            || job.data["ready"].as_array().map(Vec::len)
                != job.data["files"].as_array().map(Vec::len)
        {
            return Err("Upload preparation was interrupted. Choose the files again.".into());
        }
        job.state = "queued".into();
        job.bytes = 0;
        save(&window, &job)?;
        wake(window.clone());
        return Ok(Value::Null);
    }
    if action == "download" {
        let account = text("account")?;
        crate::auth::flow_credentials(&account)?;
        let source = text("source")?;
        crate::file_tools::valid_id(&source)?;
        let id = format!(
            "{}-{}",
            now(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        );
        let directory = crate::storage_policy::settings(&window)?["downloads"].clone();
        let job = Job {
            id,
            kind: action,
            account: account.clone(),
            target: account,
            parent: "root".into(),
            name: text("name")?,
            state: "queued".into(),
            error: String::new(),
            bytes: 0,
            total: 0,
            speed: 0.,
            attempt: 0,
            retry: 0,
            data: json!({"source":source,"downloadDirectory":directory}),
        };
        save(&window, &job)?;
        wake(window);
        return Ok(json!(job.id));
    }
    if action == "copy" || action == "move" {
        let account = text("account")?;
        let target = text("target")?;
        crate::auth::flow_credentials(&account)?;
        crate::auth::flow_credentials(&target)?;
        let source = text("source")?;
        let parent = text("parent")?;
        crate::file_tools::valid_id(&source)?;
        crate::file_tools::valid_id(&parent)?;
        let id = format!(
            "{}-{}",
            now(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        );
        let job = Job {
            id,
            kind: action.clone(),
            account,
            target,
            parent,
            name: text("name")?,
            state: "queued".into(),
            error: String::new(),
            bytes: 0,
            total: 0,
            speed: 0.,
            attempt: 0,
            retry: 0,
            data: json!({"source":source,"nodes":null}),
        };
        save(&window, &job)?;
        wake(window.clone());
        return Ok(json!(job.id));
    }
    let id = text("id")?;
    let mut job = jobs(&window)?
        .into_iter()
        .find(|job| job.id == id)
        .ok_or("Transfer missing")?;
    if matches!(job.state.as_str(), "completed" | "cancelled") {
        return Err("This transfer has finished. Create a new transfer instead.".into());
    }
    let previous_state = job.state.clone();
    match action.as_str() {
        "pause" => {
            if job.state == "staging" {
                job.state = "attention".into();
                job.error="Upload preparation was interrupted. Cancel this entry and select the files again.".into();
            } else {
                job.state = "paused".into();
            }
        }
        "cancel" => job.state = "cancelled".into(),
        "retry" | "resume" => {
            if job.state == "staging"
                || job.data["ready"].is_array()
                    && job.data["ready"].as_array().map(Vec::len)
                        != job.data["files"].as_array().map(Vec::len)
            {
                return Err("Choose the files again to finish upload preparation".into());
            }
            if job.state == "completed" {
                return Err("This transfer is already complete".into());
            }
            job.state = "queued".into();
            job.retry = 0;
            job.error.clear();
        }
        _ => return Err("Unknown transfer action".into()),
    };
    if !compare_save(&window, &job, &previous_state)? {
        return Err("Transfer state changed. Try the action again.".into());
    }
    wake(window);
    Ok(Value::Null)
}
pub fn wake(window: Window) {
    tauri::async_runtime::spawn(async move {
        let _ = tick(&window).await;
    });
}
async fn tick(window: &Window) -> Result<(), String> {
    let state = window.state::<TransferState>();
    let Ok(_guard) = state.gate.try_lock() else {
        return Ok(());
    };
    if !crate::storage_policy::background_allowed(window) || state.stopping.load(Ordering::SeqCst) {
        return Ok(());
    }
    let mut list = jobs(window)?;
    for job in &list {
        if job.kind == "upload" && matches!(job.state.as_str(), "completed" | "cancelled") {
            let _ = cleanup(window, &job.id);
        }
        if job.kind == "download" && job.state == "cancelled" {
            if let Some(directory) = job.data["downloadDirectory"].as_str() {
                let directory = Path::new(directory);
                let part = directory.join(format!(".cirro-transfer-{}.part", job.id));
                if directory.is_dir() && crate::file_tools::valid_id(&job.id).is_ok() {
                    let _ = std::fs::remove_file(part);
                }
            }
        }
    }
    list.reverse();
    for mut job in list
        .into_iter()
        .filter(|job| matches!(job.state.as_str(), "queued" | "waiting") && job.retry <= now())
    {
        if state.stopping.load(Ordering::SeqCst) || crate::security::locked() {
            break;
        }
        let expected = job.state.clone();
        job.state = "running".into();
        job.error.clear();
        job.attempt += 1;
        if !compare_save(window, &job, &expected)? {
            continue;
        }
        let result = worker::run(window, &mut job).await;
        let current = jobs(window)?
            .into_iter()
            .find(|current| current.id == job.id)
            .ok_or("Transfer disappeared")?;
        if matches!(current.state.as_str(), "paused" | "cancelled") {
            continue;
        }
        match result {
            Ok(()) => {
                job.state = "completed".into();
                job.bytes = job.total;
                job.error.clear();
                let _ = window.emit("cirro-offline", ());
                if job.kind == "upload" {
                    if let Err(error) = cleanup(window, &job.id) {
                        job.error = format!(
                            "Uploaded, but temporary files could not be cleaned up: {error}"
                        );
                    }
                }
            }
            Err(error) => {
                job.error = error;
                let lower = job.error.to_lowercase();
                let retry = crate::security::locked()
                    || state.stopping.load(Ordering::SeqCst)
                    || [
                        "network",
                        "no such host",
                        "dns",
                        "unexpected eof",
                        "504",
                        "offline",
                        "unreachable",
                        "timed out",
                        "timeout",
                        "connection",
                        "503",
                        "502",
                        "429",
                        "temporar",
                        "rate limit",
                        "locked",
                        "closing",
                    ]
                    .iter()
                    .any(|word| lower.contains(word));
                job.state = if retry { "waiting" } else { "attention" }.into();
                job.retry = now() + (30u64 * 2u64.pow(job.attempt.min(5))).min(900);
            }
        }
        let _ = compare_save(window, &job, "running")?;
    }
    Ok(())
}
pub fn start(app: &tauri::App) {
    if let Some(window) = app.get_webview_window("main") {
        let window = window.as_ref().window().clone();
        if let Ok(list) = jobs(&window) {
            for mut job in list {
                if job.state == "staging" {
                    if job.data["ready"].as_array().map(Vec::len)
                        == job.data["files"].as_array().map(Vec::len)
                    {
                        job.state = "queued".into();
                    } else {
                        job.state = "attention".into();
                        job.error="Upload preparation was interrupted. Cancel this entry and choose the files again.".into();
                    }
                    let _ = save(&window, &job);
                }
                if job.state == "running" {
                    job.state = "waiting".into();
                    job.retry = 0;
                    job.error="Cirro closed during this transfer. Completed files will be checked before retrying.".into();
                    let _ = save(&window, &job);
                }
            }
        }
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::time::sleep(std::time::Duration::from_secs(10)).await;
                let _ = tick(&window).await;
            }
        });
    }
}
pub(crate) fn cleanup(window: &Window, id: &str) -> Result<(), String> {
    let path = directory(window, id)?;
    if !path.exists() {
        return Ok(());
    }
    let expected_base = window
        .app_handle()
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("Transfers");
    let base = std::fs::canonicalize(expected_base).map_err(|e| e.to_string())?;
    let resolved = std::fs::canonicalize(&path).map_err(|e| e.to_string())?;
    let expected = base.join(id).join("Source");
    if resolved != expected {
        return Err("Temporary upload directory was redirected. Cleanup stopped.".into());
    }
    std::fs::remove_dir_all(resolved).map_err(|e| e.to_string())
}
pub async fn shutdown(app: &tauri::AppHandle) {
    let state = app.state::<TransferState>();
    state.stopping.store(true, Ordering::SeqCst);
    let _guard = state.gate.lock().await;
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn staged_paths_stay_relative_and_windows_safe() {
        for path in [
            "../escape",
            "/absolute",
            "C:/escape",
            "folder/../../escape",
            "folder\\escape",
            "CON.txt",
            "folder/LPT1",
            "bad?.txt",
            "trailing.",
            "folder/name ",
        ] {
            assert!(relative(path).is_err(), "{path}");
        }
        assert!(relative("Photos/Beach.jpg").is_ok());
    }
    #[test]
    fn paused_or_cancelled_journal_cannot_be_overwritten_by_worker() {
        let c = rusqlite::Connection::open_in_memory().unwrap();
        c.execute_batch("CREATE TABLE transfer_jobs(id TEXT PRIMARY KEY,data TEXT NOT NULL);")
            .unwrap();
        for state in ["paused", "cancelled", "completed"] {
            c.execute(
                "INSERT OR REPLACE INTO transfer_jobs VALUES('job',?)",
                [json!({"state":state}).to_string()],
            )
            .unwrap();
            let changed = journal_transition(
                &c,
                "job",
                &json!({"state":"running"}).to_string(),
                "running",
            )
            .unwrap();
            assert_eq!(changed, 0);
        }
    }
}
