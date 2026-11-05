use serde_json::{json, Value};
use tauri::{Emitter, Manager, Window};
use tauri_plugin_updater::{Update, UpdaterExt};
#[derive(Default)]
pub struct UpdateState {
    gate: tokio::sync::Mutex<()>,
    pending: tokio::sync::Mutex<Option<Update>>,
    bytes: tokio::sync::Mutex<Option<Vec<u8>>>,
    status: std::sync::Mutex<Value>,
}
fn status(window: &Window, value: Value) {
    if let Ok(mut stored) = window.state::<UpdateState>().status.lock() {
        *stored = value.clone();
    }
    let _ = window.emit("cirro-update", value);
}
#[tauri::command]
pub async fn update_command(window: Window, action: String) -> Result<Value, String> {
    crate::security::require_unlocked()?;
    if window.label() != "main" {
        return Err("Main window required".into());
    }
    let state = window.state::<UpdateState>();
    if action == "status" {
        return Ok(state
            .status
            .lock()
            .map_err(|_| "Update state unavailable")?
            .clone());
    }
    if action == "check"
        && (cfg!(debug_assertions)
            || env!("CIRRO_UPDATE_ENDPOINT").is_empty()
            || env!("CIRRO_UPDATER_PUBLIC_KEY").is_empty())
    {
        return Err("Update checks are available in configured release builds.".into());
    }
    let _guard = state
        .gate
        .try_lock()
        .map_err(|_| "An update operation is already running")?;
    let result:Result<Value,String>=async {
 if action=="check" {
  if state.bytes.lock().await.is_some(){return Ok(state.status.lock().map_err(|_|"Update state unavailable")?.clone());}
  let endpoint=env!("CIRRO_UPDATE_ENDPOINT");let key=env!("CIRRO_UPDATER_PUBLIC_KEY");
  if cfg!(debug_assertions)||endpoint.is_empty()||key.is_empty(){return Err("Update checks are available in configured release builds.".into());}
  status(&window,json!({"phase":"checking"}));
  let update=window.app_handle().updater_builder().pubkey(key).endpoints(vec![url::Url::parse(endpoint).map_err(|_|"Invalid update endpoint")?]).map_err(|e|e.to_string())?.timeout(std::time::Duration::from_secs(30)).build().map_err(|e|e.to_string())?.check().await.map_err(|_|"Could not check for updates. Check your connection and try again.")?;
  let value=match &update {Some(update)=>json!({"phase":"available","version":update.version,"notes":update.body}),None=>json!({"phase":"current"})};
  *state.pending.lock().await=update;status(&window,value.clone());return Ok(value);
 }
 if action=="download" {
  let guard=state.pending.lock().await;let update=guard.as_ref().ok_or("Check for updates first")?;
  status(&window,json!({"phase":"downloading","version":update.version,"received":0}));let mut received=0u64;
  let data=update.download(|chunk,total|{received+=chunk as u64;status(&window,json!({"phase":"downloading","version":update.version,"received":received,"total":total}));},||{}).await.map_err(|_|"Update download or signature verification failed. Retry on a trusted connection.")?;
  crate::security::require_unlocked()?;*state.bytes.lock().await=Some(data);let value=json!({"phase":"ready","version":update.version});status(&window,value.clone());return Ok(value);
 }
 if action=="install" {
  let pending=state.pending.lock().await;let update=pending.as_ref().ok_or("Check for updates first")?;let bytes=state.bytes.lock().await;let bytes=bytes.as_ref().ok_or("Download the update first")?;
  if window.state::<crate::transfers::TransferState>().gate.try_lock().is_err()||window.state::<crate::flow::FlowState>().0.try_lock().is_err()||window.state::<crate::drive::DriveLock>().0.try_lock().is_err(){return Err("Pause transfers and sync, then retry Restart now.".into());}
  crate::security::require_unlocked()?;
  crate::transfers::shutdown(window.app_handle()).await;
  crate::flow::shutdown(window.app_handle().clone()).await;
  let installed=update.install(bytes);if installed.is_err(){window.state::<crate::flow::FlowState>().2.store(false,std::sync::atomic::Ordering::SeqCst);window.state::<crate::transfers::TransferState>().stopping.store(false,std::sync::atomic::Ordering::SeqCst);}
  installed.map_err(|_|"The installer could not start. Quit and reopen Cirro before retrying.")?;return Ok(Value::Null);
 }
 Err("Unknown update action".into())
 }.await;
    if let Err(error) = &result {
        status(
            &window,
            json!({"phase":"error","message":error,"ready":state.bytes.lock().await.is_some()}),
        );
    }
    result
}
