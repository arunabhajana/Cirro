use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use tauri::Window;
#[tauri::command]
pub async fn saved_inventory(window: Window) -> Result<Value, String> {
    crate::security::require_unlocked()?;
    let profiles = crate::auth::auth_accounts(window.clone()).await?;
    let allowed: HashSet<_> = profiles.iter().map(|profile| profile.id.as_str()).collect();
    let c = crate::drive::db(&window)?;
    let mut query = c
        .prepare("SELECT account,id,data FROM files")
        .map_err(|e| e.to_string())?;
    let mut cached = HashMap::new();
    for row in query
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?
    {
        let (account, id, data) = row.map_err(|e| e.to_string())?;
        if allowed.contains(account.as_str()) {
            cached.insert(
                (account, id),
                serde_json::from_str::<Value>(&data).map_err(|e| e.to_string())?,
            );
        }
    }
    let mut query = c
        .prepare("SELECT account,key,value FROM settings WHERE key LIKE 'offline:%'")
        .map_err(|e| e.to_string())?;
    let mut result = vec![];
    for row in query
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?
    {
        let (account, key, value) = row.map_err(|e| e.to_string())?;
        if !allowed.contains(account.as_str()) {
            continue;
        }
        let value: Value = serde_json::from_str(&value).map_err(|e| e.to_string())?;
        let id = key.trim_start_matches("offline:");
        let remote = cached.get(&(account.clone(), id.into()));
        let exists = value["path"]
            .as_str()
            .is_some_and(|path| std::path::Path::new(path).exists());
        let mut stale = remote.is_none_or(|file| {
            file["trashed"] == true || file["modifiedTime"] != value["modified"]
        });
        let mut missing = 0;
        if value["kind"] == "folder" {
            let known: HashSet<&str> = value["items"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|item| item["id"].as_str())
                .chain(std::iter::once(id))
                .collect();
            if cached.iter().any(|((owner, child), file)| {
                owner == &account
                    && !known.contains(child.as_str())
                    && file["trashed"] != true
                    && file["parents"].as_array().is_some_and(|parents| {
                        parents.iter().any(|parent| {
                            parent.as_str().is_some_and(|parent| known.contains(parent))
                        })
                    })
            }) {
                stale = true;
            }
        }
        if let Some(items) = value["items"].as_array() {
            for item in items {
                if item["onlineLink"] != true
                    && item["path"]
                        .as_str()
                        .is_some_and(|path| !std::path::Path::new(path).exists())
                {
                    missing += 1;
                }
                if item["id"].as_str().is_some_and(|id| {
                    cached
                        .get(&(account.clone(), id.into()))
                        .is_none_or(|file| {
                            file["modifiedTime"] != item["modified"] || file["trashed"] == true
                        })
                }) {
                    stale = true;
                }
            }
        }
        result.push(json!({"id":format!("{account}::{id}"),"account":account,"name":value["name"],"kind":value["kind"],"path":value["path"],"modified":value["modified"],"exists":exists,"stale":stale,"partial":value["complete"]==false||value["onlineLinks"].as_u64().unwrap_or(0)>0||missing>0,"missing":missing,"onlineLinks":value["onlineLinks"],"files":value["files"],"remoteMissing":remote.is_none()}));
    }
    Ok(json!(result))
}
