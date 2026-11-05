use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
};
use tauri::{Manager, Window};

// Never follow junctions/symlinks while measuring user-selected folders.
fn redirected(metadata: &std::fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}
#[derive(Default)]
struct Usage {
    bytes: u64,
    files: u64,
    skipped: u64,
}
fn measure(roots: &[PathBuf]) -> Usage {
    let mut usage = Usage::default();
    let mut pending = roots.to_vec();
    let mut seen = HashSet::new();
    let mut visited = 0;
    while let Some(path) = pending.pop() {
        visited += 1;
        if visited > 100_000 {
            usage.skipped += 1;
            break;
        }
        let metadata = match std::fs::symlink_metadata(&path) {
            Ok(value) => value,
            Err(_) => {
                usage.skipped += 1;
                continue;
            }
        };
        if redirected(&metadata) {
            usage.skipped += 1;
            continue;
        }
        let canonical = match std::fs::canonicalize(&path) {
            Ok(path) => path,
            Err(_) => {
                usage.skipped += 1;
                continue;
            }
        };
        if !seen.insert(canonical) {
            continue;
        }
        if metadata.is_file() {
            usage.bytes = usage.bytes.saturating_add(metadata.len());
            usage.files += 1;
        } else if metadata.is_dir() {
            match std::fs::read_dir(path) {
                Ok(entries) => {
                    for entry in entries {
                        match entry {
                            Ok(entry) => pending.push(entry.path()),
                            Err(_) => usage.skipped += 1,
                        }
                    }
                }
                Err(_) => usage.skipped += 1,
            }
        }
    }
    usage
}
fn category(roots: &[PathBuf]) -> Value {
    let usage = measure(roots);
    json!({"bytes":usage.bytes,"files":usage.files,"skipped":usage.skipped})
}
fn base(window: &Window) -> Result<PathBuf, String> {
    window
        .app_handle()
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())
}
fn scalar(c: &rusqlite::Connection, sql: &str) -> Result<u64, String> {
    c.query_row(sql, [], |row| row.get(0))
        .map_err(|e| e.to_string())
}
fn table_exists(c: &rusqlite::Connection, name: &str) -> bool {
    c.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?)",
        [name],
        |row| row.get::<_, bool>(0),
    )
    .unwrap_or(false)
}
fn usage(window: &Window) -> Result<Value, String> {
    let c = crate::drive::db(window)?;
    let base = base(window)?;
    let mut query = c
        .prepare("SELECT value FROM settings WHERE key LIKE 'offline:%'")
        .map_err(|e| e.to_string())?;
    let mut roots = vec![];
    for row in query
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
    {
        let value: Value =
            serde_json::from_str(&row.map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        if value["owner"].is_null() {
            if let Some(path) = value["path"].as_str() {
                roots.push(PathBuf::from(path));
            }
        }
    }
    let db_paths = ["cirro.sqlite3", "cirro.sqlite3-wal", "cirro.sqlite3-shm"]
        .iter()
        .map(|name| base.join(name))
        .filter(|path| path.exists())
        .collect::<Vec<_>>();
    let mut recoveries = vec![];
    if let Ok(entries) = std::fs::read_dir(base.join("Flow")) {
        for entry in entries.flatten() {
            if let Ok(metadata) = std::fs::symlink_metadata(entry.path()) {
                if !redirected(&metadata) && metadata.is_dir() {
                    let path = entry.path().join("Recovery");
                    if path.exists() {
                        recoveries.push(path);
                    }
                }
            }
        }
    }
    let staging = base.join("Transfers");
    let database = category(&db_paths);
    let offline = category(&roots);
    let staged = if staging.exists() {
        category(&[staging])
    } else {
        category(&[])
    };
    let recovery = category(&recoveries);
    Ok(
        json!({"database":database,"offline":offline,"staging":staged,"recovery":recovery,"thumbnailBytes":scalar(&c,"SELECT COALESCE(SUM(length(data)),0) FROM thumbnails")?,"thumbnailCount":scalar(&c,"SELECT COUNT(*) FROM thumbnails")?,"metadataCount":scalar(&c,"SELECT COUNT(*) FROM files")?,"offlineRoots":roots.len(),"freeBytes":free_space(&base)}),
    )
}
fn free_space(path: &Path) -> Option<u64> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        let path: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        let mut available = 0;
        unsafe {
            if windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW(
                path.as_ptr(),
                &mut available,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            ) == 0
            {
                return None;
            }
        }
        Some(available)
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        None
    }
}
fn counts(c: &rusqlite::Connection, table: &str) -> Result<Value, String> {
    if !table_exists(c, table) {
        return Ok(json!({}));
    }
    // Callers supply only fixed table names. No record bodies or errors enter reports.
    let sql=match table {"transfer_jobs"=>"SELECT COALESCE(json_extract(data,'$.state'),'unknown'),COUNT(*) FROM transfer_jobs GROUP BY 1","flow_pairs"=>"SELECT CASE WHEN json_extract(data,'$.paused') THEN 'paused' WHEN json_extract(data,'$.error')<>'' THEN 'attention' ELSE 'ready' END,COUNT(*) FROM flow_pairs GROUP BY 1",_=>return Err("Unsupported diagnostic table".into())};
    let mut query = c.prepare(sql).map_err(|e| e.to_string())?;
    let mut values = HashMap::new();
    for row in query
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, u64>(1)?))
        })
        .map_err(|e| e.to_string())?
    {
        let (key, value) = row.map_err(|e| e.to_string())?;
        let safe = match key.as_str() {
            "queued" | "running" | "waiting" | "paused" | "attention" | "staging" | "completed"
            | "cancelled" | "ready" => key,
            _ => "unknown".into(),
        };
        *values.entry(safe).or_insert(0u64) += value;
    }
    Ok(json!(values))
}
fn diagnostics(window: &Window) -> Result<Value, String> {
    let c = crate::drive::db(window)?;
    let healthy = c
        .query_row("PRAGMA quick_check", [], |row| row.get::<_, String>(0))
        .is_ok_and(|value| value == "ok");
    Ok(
        json!({"reportVersion":1,"app":"Cirro","version":env!("CARGO_PKG_VERSION"),"build":if cfg!(debug_assertions){"development"}else{"release"},"platform":std::env::consts::OS,"architecture":std::env::consts::ARCH,"generatedAt":crate::transfers::now(),"checks":{"database":if healthy{"ok"}else{"needs_attention"},"syncEngine":if crate::flow::engine(window).is_ok(){"available"}else{"unavailable"}},"metadataFiles":scalar(&c,"SELECT COUNT(*) FROM files")?,"cachedThumbnails":scalar(&c,"SELECT COUNT(*) FROM thumbnails")?,"accountsWithMetadata":scalar(&c,"SELECT COUNT(DISTINCT account) FROM files")?,"transfers":counts(&c,"transfer_jobs")?,"flow":counts(&c,"flow_pairs")?,"freeBytes":free_space(&base(window)?),"privacy":"No account identities, tokens, file names, local paths, raw logs or file contents are included. Nothing is sent automatically."}),
    )
}
fn clear_metadata(c: &mut rusqlite::Connection) -> Result<(), String> {
    let tx = c.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM files", [])
        .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM thumbnails", [])
        .map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM settings WHERE key IN ('cursor','about','summaryRefreshed','sharedDrives')",
        [],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn maintenance_command(
    window: Window,
    action: String,
    args: Value,
) -> Result<Value, String> {
    if window.label() != "main" {
        return Err("Main window required".into());
    }
    crate::security::require_unlocked()?;
    if action == "usage" || action == "diagnostics" {
        return tauri::async_runtime::spawn_blocking(move || {
            crate::security::require_unlocked()?;
            if action == "usage" {
                usage(&window)
            } else {
                diagnostics(&window)
            }
        })
        .await
        .map_err(|e| e.to_string())?;
    }
    if action == "open-data" {
        open::that(base(&window)?).map_err(|e| e.to_string())?;
        return Ok(Value::Null);
    }
    if action == "export" {
        let report = diagnostics(&window)?;
        let directory = Path::new(args["directory"].as_str().ok_or("Choose a report folder")?);
        if !directory.is_absolute() || !directory.is_dir() {
            return Err("Choose an existing report folder".into());
        }
        let path = crate::offline::readable_target(
            directory,
            &format!("Cirro-diagnostics-{}.json", crate::transfers::now()),
        );
        use std::io::Write;
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|e| e.to_string())?;
        file.write_all(
            serde_json::to_string_pretty(&report)
                .map_err(|e| e.to_string())?
                .as_bytes(),
        )
        .and_then(|_| file.sync_all())
        .map_err(|e| e.to_string())?;
        return Ok(json!(path.to_string_lossy()));
    }
    let drive = window.state::<crate::drive::DriveLock>();
    let _drive = drive
        .0
        .try_lock()
        .map_err(|_| "Wait for the current Drive operation to finish")?;
    let transfers = window.state::<crate::transfers::TransferState>();
    let _transfers = transfers
        .gate
        .try_lock()
        .map_err(|_| "Pause transfers and wait for them to stop before maintenance")?;
    let flow = window.state::<crate::flow::FlowState>();
    let _flow = flow
        .0
        .try_lock()
        .map_err(|_| "Wait for Flow to finish before maintenance")?;
    crate::security::require_unlocked()?;
    let mut c = crate::drive::db(&window)?;
    match action.as_str() {
        "clear-thumbnails" => {
            c.execute("DELETE FROM thumbnails", [])
                .map_err(|e| e.to_string())?;
        }
        "rebuild-metadata" => clear_metadata(&mut c)?,
        "compact" => {
            c.execute_batch("PRAGMA wal_checkpoint(TRUNCATE); VACUUM; PRAGMA optimize;")
                .map_err(|e| e.to_string())?;
        }
        "clear-finished" => {
            for job in crate::transfers::jobs(&window)?
                .iter()
                .filter(|job| matches!(job.state.as_str(), "completed" | "cancelled"))
            {
                if job.kind == "upload" {
                    crate::transfers::cleanup(&window, &job.id)?;
                }
                c.execute("DELETE FROM transfer_jobs WHERE id=? AND json_extract(data,'$.state') IN ('completed','cancelled')",[&job.id]).map_err(|e|e.to_string())?;
            }
        }
        _ => return Err("Unknown maintenance action".into()),
    }
    Ok(Value::Null)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rebuilding_metadata_preserves_offline_records_and_preferences() {
        let mut c = rusqlite::Connection::open_in_memory().unwrap();
        c.execute_batch("CREATE TABLE files(account TEXT,id TEXT,data TEXT);CREATE TABLE thumbnails(data BLOB);CREATE TABLE settings(account TEXT,key TEXT,value TEXT);INSERT INTO files VALUES('a','f','{}');INSERT INTO settings VALUES('a','cursor','expired'),('a','offline:f','saved'),('a','pins','[\"f\"]'),('a','accountLabel','Work');").unwrap();
        clear_metadata(&mut c).unwrap();
        assert_eq!(scalar(&c, "SELECT COUNT(*) FROM files").unwrap(), 0);
        assert_eq!(scalar(&c, "SELECT COUNT(*) FROM settings").unwrap(), 3);
    }
    #[test]
    fn diagnostic_statuses_do_not_expose_names_or_errors() {
        let c = rusqlite::Connection::open_in_memory().unwrap();
        c.execute_batch("CREATE TABLE flow_pairs(data TEXT);INSERT INTO flow_pairs VALUES('{\"name\":\"private\",\"error\":\"secret-token\",\"paused\":false}');").unwrap();
        let report = counts(&c, "flow_pairs").unwrap();
        assert_eq!(report, json!({"attention":1}));
        assert!(!report.to_string().contains("secret"));
    }
}
