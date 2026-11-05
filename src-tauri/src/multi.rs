use crate::{auth, drive, folder_picker, offline};
use serde_json::{json, Value};
use tauri::{Manager, Window};
#[tauri::command]
pub async fn account_call(
    window: Window,
    account: String,
    command: String,
    args: Value,
) -> Result<Value, String> {
    auth::account_scope(account, async {
        let state = window.state::<auth::AuthState>();
        auth::current_profile(&state).await?;
        let text = |key: &str| {
            args[key]
                .as_str()
                .map(str::to_owned)
                .ok_or_else(|| format!("Missing {key}"))
        };
        match command.as_str() {
            "offline_content" => Ok(json!(
                offline::offline_content(window.clone(), window.state(), text("id")?).await?
            )),
            "drive_cache" => drive::drive_cache(window.clone(), window.state()).await,
            "drive_sync" => drive::drive_sync(window.clone(), window.state()).await,
            "drive_preference" => {
                drive::drive_preference(window.clone(), window.state(), text("key")?).await
            }
            "drive_setting" => {
                drive::drive_setting(
                    window.clone(),
                    window.state(),
                    text("key")?,
                    args["value"].clone(),
                )
                .await?;
                Ok(Value::Null)
            }
            "drive_content" => {
                drive::drive_content(
                    window.clone(),
                    window.state(),
                    text("id")?,
                    args["thumbnail"].as_bool().unwrap_or(false),
                )
                .await
            }
            "drive_open" => {
                drive::drive_open(window.clone(), window.state(), text("id")?).await?;
                Ok(Value::Null)
            }
            "drive_mutate" => {
                drive::drive_mutate(
                    window.clone(),
                    window.state(),
                    text("operation")?,
                    args["id"].as_str().map(str::to_owned),
                    args["body"].clone(),
                )
                .await
            }
            "drive_upload_start" => Ok(json!(
                drive::drive_upload_start(
                    window.clone(),
                    window.state(),
                    window.state(),
                    args["body"].clone(),
                    text("mime")?,
                    args["size"].as_u64().ok_or("Missing size")?
                )
                .await?
            )),
            "drive_upload_chunk" => Ok(json!(
                drive::drive_upload_chunk(
                    window.clone(),
                    window.state(),
                    window.state(),
                    text("session")?,
                    text("data")?,
                    args["offset"].as_u64().ok_or("Missing offset")?,
                    args["total"].as_u64().ok_or("Missing total")?
                )
                .await?
            )),
            "offline_save" => {
                offline::offline_save(window.clone(), window.state(), text("id")?).await
            }
            "offline_remove" => {
                offline::offline_remove(window.clone(), window.state(), text("id")?).await?;
                Ok(Value::Null)
            }
            "offline_open" => {
                offline::offline_open(window.clone(), window.state(), text("id")?).await?;
                Ok(Value::Null)
            }
            "offline_directory" => Ok(json!(
                offline::offline_directory(
                    window.clone(),
                    window.state(),
                    args["path"].as_str().map(str::to_owned)
                )
                .await?
            )),
            "pick_offline_folder" => Ok(json!(
                folder_picker::pick_offline_folder(
                    window.clone(),
                    window.state(),
                    args["current"].as_str().map(str::to_owned)
                )
                .await?
            )),
            _ => Err("Unknown account operation.".into()),
        }
    })
    .await
}
