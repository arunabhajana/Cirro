use crate::drive;
use serde_json::Value;
use tauri::Window;
fn database(window: &Window) -> Result<rusqlite::Connection, String> {
    let c = drive::db(window)?;
    c.execute_batch(
        "CREATE TABLE IF NOT EXISTS device_preferences(key TEXT PRIMARY KEY,value TEXT NOT NULL);",
    )
    .map_err(|e| e.to_string())?;
    Ok(c)
}
#[tauri::command]
pub fn device_preference(
    window: Window,
    key: String,
    migrate_key: Option<String>,
    migrate_account: Option<String>,
) -> Result<Value, String> {
    let c = database(&window)?;
    let existing = c
        .query_row(
            "SELECT value FROM device_preferences WHERE key=?",
            [&key],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some(value) = existing {
        return serde_json::from_str(&value).map_err(|e| e.to_string());
    }
    let Some(legacy) = migrate_key else {
        return Ok(Value::Null);
    };
    let owner = if let Some(account) = migrate_account {
        Some(account)
    } else {
        let saved = c
            .query_row(
                "SELECT value FROM device_preferences WHERE key='migration:home-owner'",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if let Some(saved) = saved {
            serde_json::from_str::<String>(&saved).ok()
        } else {
            let owner=c.query_row("SELECT account FROM settings WHERE key IN ('pins','widgets','widgetOrder') ORDER BY CASE WHEN key='pins' AND json_valid(value) THEN json_array_length(value) ELSE -1 END DESC,rowid ASC LIMIT 1",[],|row|row.get::<_,String>(0)).optional().map_err(|e|e.to_string())?;
            if let Some(owner) = &owner {
                c.execute(
                    "INSERT OR IGNORE INTO device_preferences VALUES('migration:home-owner',?)",
                    [serde_json::to_string(owner).map_err(|e| e.to_string())?],
                )
                .map_err(|e| e.to_string())?;
            }
            owner
        }
    };
    let Some(owner) = owner else {
        return Ok(Value::Null);
    };
    let Some(raw) = drive::get(&c, &owner, &legacy) else {
        return Ok(Value::Null);
    };
    let mut value: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    if matches!(legacy.as_str(), "pins" | "sidebarPins") {
        if let Some(ids) = value.as_array_mut() {
            for id in ids {
                if let Some(raw) = id.as_str() {
                    if !raw.contains("::") {
                        *id = Value::String(format!("{owner}::{raw}"));
                    }
                }
            }
        }
    }
    c.execute(
        "INSERT OR IGNORE INTO device_preferences VALUES(?,?)",
        rusqlite::params![key, value.to_string()],
    )
    .map_err(|e| e.to_string())?;
    Ok(value)
}
#[tauri::command]
pub fn device_setting(window: Window, key: String, value: Value) -> Result<(), String> {
    database(&window)?
        .execute(
            "INSERT OR REPLACE INTO device_preferences VALUES(?,?)",
            rusqlite::params![key, value.to_string()],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}
use rusqlite::OptionalExtension;
