use crate::{auth, drive, flow};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    mem::{offset_of, size_of},
    path::Path,
    sync::{Arc, Mutex},
};
use tauri::{Emitter, Manager, Window};
use windows_sys::Win32::{
    Foundation::{
        STATUS_CLOUD_FILE_ACCESS_DENIED, STATUS_CLOUD_FILE_NETWORK_UNAVAILABLE,
        STATUS_CLOUD_FILE_NOT_IN_SYNC, STATUS_CLOUD_FILE_UNSUCCESSFUL,
    },
    Storage::{CloudFilters::*, FileSystem::FILE_ATTRIBUTE_READONLY},
};
struct Context {
    window: Window,
    account: String,
    tasks: Tasks,
}
type Tasks = Arc<Mutex<HashMap<(i64, i64), tokio::task::AbortHandle>>>;
struct Download {
    window: Window,
    id: String,
    tasks: Tasks,
    key: (i64, i64),
}
impl Drop for Download {
    fn drop(&mut self) {
        if let Ok(mut tasks) = self.tasks.lock() {
            tasks.remove(&self.key);
        }
        let _ = self
            .window
            .emit("cirro-cloud-progress", json!({"id":self.id,"done":true}));
    }
}
pub struct Connection {
    key: CF_CONNECTION_KEY,
    path: String,
    _context: Box<Context>,
}
impl Connection {
    fn disconnect(&mut self) -> Result<(), String> {
        if self.key != 0 {
            unsafe {
                check(CfDisconnectSyncRoot(self.key), "Disconnecting cloud view")?;
            }
            self.key = 0;
        }
        if let Ok(mut tasks) = self._context.tasks.lock() {
            for (_, task) in tasks.drain() {
                task.abort();
            }
        }
        Ok(())
    }
}
impl Drop for Connection {
    fn drop(&mut self) {
        if self.key != 0 {
            unsafe {
                CfDisconnectSyncRoot(self.key);
            }
        }
        if let Ok(mut tasks) = self._context.tasks.lock() {
            for (_, task) in tasks.drain() {
                task.abort();
            }
        }
    }
}
fn error_status(error: &str) -> i32 {
    let error = error.to_lowercase();
    if error.contains("changed") {
        STATUS_CLOUD_FILE_NOT_IN_SYNC
    } else if error.contains("403")
        || error.contains("401")
        || error.contains("account")
        || error.contains("sign in")
    {
        STATUS_CLOUD_FILE_ACCESS_DENIED
    } else if error.contains("offline")
        || error.contains("network")
        || error.contains("unreachable")
        || error.contains("timed out")
        || error.contains("could not connect to google")
    {
        STATUS_CLOUD_FILE_NETWORK_UNAVAILABLE
    } else {
        STATUS_CLOUD_FILE_UNSUCCESSFUL
    }
}
unsafe extern "system" fn cancel(info: *const CF_CALLBACK_INFO, _: *const CF_CALLBACK_PARAMETERS) {
    if let Some(info) = info.as_ref() {
        if !info.CallbackContext.is_null() {
            let context = &*(info.CallbackContext as *const Context);
            if let Ok(mut tasks) = context.tasks.lock() {
                if let Some(task) = tasks.remove(&(info.TransferKey, info.RequestKey)) {
                    task.abort();
                }
            }
        }
    }
}
// This initial provider exposes read-only snapshots. Local rename/delete must not look like cloud mutations.
unsafe extern "system" fn deny(
    info: *const CF_CALLBACK_INFO,
    parameters: *const CF_CALLBACK_PARAMETERS,
) {
    if info.is_null() || parameters.is_null() {
        return;
    }
    let info = &*info;
    acknowledge(info, false);
}
unsafe extern "system" fn deny_rename(
    info: *const CF_CALLBACK_INFO,
    _: *const CF_CALLBACK_PARAMETERS,
) {
    if let Some(info) = info.as_ref() {
        acknowledge(info, true);
    }
}
unsafe fn acknowledge(info: &CF_CALLBACK_INFO, rename: bool) {
    let operation = CF_OPERATION_INFO {
        StructSize: size_of::<CF_OPERATION_INFO>() as u32,
        Type: if rename {
            CF_OPERATION_TYPE_ACK_RENAME
        } else {
            CF_OPERATION_TYPE_ACK_DELETE
        },
        ConnectionKey: info.ConnectionKey,
        TransferKey: info.TransferKey,
        RequestKey: info.RequestKey,
        ..Default::default()
    };
    let mut params = if rename {
        CF_OPERATION_PARAMETERS {
            ParamSize: (offset_of!(CF_OPERATION_PARAMETERS, Anonymous)
                + size_of::<CF_OPERATION_PARAMETERS_0_6>()) as u32,
            Anonymous: CF_OPERATION_PARAMETERS_0 {
                AckRename: CF_OPERATION_PARAMETERS_0_6 {
                    Flags: 0,
                    CompletionStatus: STATUS_CLOUD_FILE_ACCESS_DENIED,
                },
            },
        }
    } else {
        CF_OPERATION_PARAMETERS {
            ParamSize: (offset_of!(CF_OPERATION_PARAMETERS, Anonymous)
                + size_of::<CF_OPERATION_PARAMETERS_0_7>()) as u32,
            Anonymous: CF_OPERATION_PARAMETERS_0 {
                AckDelete: CF_OPERATION_PARAMETERS_0_7 {
                    Flags: 0,
                    CompletionStatus: STATUS_CLOUD_FILE_ACCESS_DENIED,
                },
            },
        }
    };
    CfExecute(&operation, &mut params);
}
fn wide(value: &std::ffi::OsStr) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    value.encode_wide().chain(Some(0)).collect()
}
fn check(code: i32, operation: &str) -> Result<(), String> {
    if code < 0 {
        let advice=match code as u32 {
            0x80070070|0x80070027 => "Not enough local disk space. Free space and open the file again.",
            0x80070005 => "Access denied. Check folder permissions and your connected account.",
            0x8007016A => "The cloud provider is not connected. Restart Cirro and try again.",
            _ => "Check the Windows cloud-files feature and use a local NTFS folder outside other cloud providers.",
        };
        Err(format!(
            "{operation} failed (Windows 0x{:08X}). {advice}",
            code as u32
        ))
    } else {
        Ok(())
    }
}
fn verified_checksum(expected: &str, hasher: Sha256) -> Result<(), String> {
    if expected.len() == 64
        && expected.chars().all(|c| c.is_ascii_hexdigit())
        && format!("{:x}", hasher.finalize()).eq_ignore_ascii_case(expected)
    {
        Ok(())
    } else {
        Err("The cloud content changed or could not be verified. Create a fresh cloud view.".into())
    }
}
fn validate_response(
    status: u16,
    range: Option<&str>,
    offset: i64,
    length: i64,
    size: i64,
) -> Result<(), String> {
    if status == 200 && offset == 0 && length == size {
        return Ok(());
    }
    let expected = format!("bytes {}-{}/{}", offset, offset + length - 1, size);
    if status == 206 && range == Some(expected.as_str()) {
        Ok(())
    } else {
        Err("Drive did not honour the requested byte range. No data was accepted.".into())
    }
}
fn records(window: &Window) -> Result<Vec<Value>, String> {
    let raw = drive::get(&drive::db(window)?, "device", "cloudRoots").unwrap_or("[]".into());
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}
fn store(window: &Window, roots: &[Value]) -> Result<(), String> {
    drive::put(
        &drive::db(window)?,
        "device",
        "cloudRoots",
        &json!(roots).to_string(),
    )
}
fn complete(
    key: CF_CONNECTION_KEY,
    transfer: i64,
    request: i64,
    offset: i64,
    data: Option<&[u8]>,
    length: i64,
    status: i32,
) -> Result<(), String> {
    unsafe {
        let info = CF_OPERATION_INFO {
            StructSize: size_of::<CF_OPERATION_INFO>() as u32,
            Type: CF_OPERATION_TYPE_TRANSFER_DATA,
            ConnectionKey: key,
            TransferKey: transfer,
            RequestKey: request,
            ..Default::default()
        };
        let mut params = CF_OPERATION_PARAMETERS {
            ParamSize: (offset_of!(CF_OPERATION_PARAMETERS, Anonymous)
                + size_of::<CF_OPERATION_PARAMETERS_0_0>()) as u32,
            Anonymous: CF_OPERATION_PARAMETERS_0 {
                TransferData: CF_OPERATION_PARAMETERS_0_0 {
                    Flags: 0,
                    CompletionStatus: status,
                    Buffer: data.map(|v| v.as_ptr().cast()).unwrap_or(std::ptr::null()),
                    Offset: offset,
                    Length: length,
                },
            },
        };
        check(CfExecute(&info, &mut params), "Hydration")
    }
}
fn acknowledge_data(
    key: CF_CONNECTION_KEY,
    transfer: i64,
    length: i64,
    status: i32,
) -> Result<(), String> {
    unsafe {
        let info = CF_OPERATION_INFO {
            StructSize: size_of::<CF_OPERATION_INFO>() as u32,
            Type: CF_OPERATION_TYPE_ACK_DATA,
            ConnectionKey: key,
            TransferKey: transfer,
            ..Default::default()
        };
        let mut params = CF_OPERATION_PARAMETERS {
            ParamSize: (offset_of!(CF_OPERATION_PARAMETERS, Anonymous)
                + size_of::<CF_OPERATION_PARAMETERS_0_2>()) as u32,
            Anonymous: CF_OPERATION_PARAMETERS_0 {
                AckData: CF_OPERATION_PARAMETERS_0_2 {
                    Flags: 0,
                    CompletionStatus: status,
                    Offset: 0,
                    Length: length,
                },
            },
        };
        check(CfExecute(&info, &mut params), "Verifying cloud data")
    }
}
unsafe extern "system" fn fetch(
    info: *const CF_CALLBACK_INFO,
    parameters: *const CF_CALLBACK_PARAMETERS,
) {
    if info.is_null() || parameters.is_null() {
        return;
    }
    let info = &*info;
    let key = info.ConnectionKey;
    let transfer = info.TransferKey;
    let request = info.RequestKey;
    // FULL hydration always verifies the entire file, including after interrupted downloads.
    // This handler also services VALIDATE_DATA without reading the callback-specific union.
    let offset = 0;
    let length = info.FileSize;
    if info.CallbackContext.is_null()
        || info.FileIdentity.is_null()
        || info.FileIdentityLength > 4096
    {
        let _ = complete(
            key,
            transfer,
            request,
            offset,
            None,
            length,
            STATUS_CLOUD_FILE_NETWORK_UNAVAILABLE,
        );
        return;
    }
    let context = &*(info.CallbackContext as *const Context);
    let window = context.window.clone();
    let account = context.account.clone();
    let tasks = context.tasks.clone();
    let mut task_guard = match tasks.lock() {
        Ok(guard) => guard,
        Err(_) => {
            let _ = complete(
                key,
                transfer,
                request,
                offset,
                None,
                length,
                STATUS_CLOUD_FILE_UNSUCCESSFUL,
            );
            return;
        }
    };
    if task_guard.keys().any(|(active, _)| *active == transfer) {
        return;
    }
    let identity: Result<Value, _> = serde_json::from_slice(std::slice::from_raw_parts(
        info.FileIdentity.cast(),
        info.FileIdentityLength as usize,
    ));
    let tasks_copy = tasks.clone();
    let task = tauri::async_runtime::spawn(async move {
        let progress_id = format!("{key}:{transfer}:{request}");
        let _download = Download {
            window: window.clone(),
            id: progress_id.clone(),
            tasks: tasks_copy,
            key: (transfer, request),
        };
        let outcome = async {
            let identity = identity.map_err(|_| "Invalid placeholder identity.")?;
            if identity["account"] != account {
                return Err("Placeholder account mismatch.".to_string());
            }
            let id = identity["id"].as_str().ok_or("Missing Drive identity")?;
            let size=identity["size"].as_str().and_then(|size|size.parse::<i64>().ok()).ok_or("Invalid cloud size")?;
            if length<0||size!=length{return Err("Cloud placeholder size changed. Create a fresh view.".into());}
            if length==0{return acknowledge_data(key,transfer,0,0);}
            let expected=identity["checksum"].as_str().filter(|hash|hash.len()==64&&hash.chars().all(|c|c.is_ascii_hexdigit())).ok_or("Drive did not provide a content checksum. This file cannot be hydrated safely.")?;
            let _=window.emit("cirro-cloud-progress",json!({"id":progress_id,"name":identity["name"],"bytes":0,"total":length}));
            let _permit=window.state::<super::CloudState>().downloads.clone().acquire_owned().await.map_err(|_|"Cloud provider is stopping")?;
            if !id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
                || id.is_empty()
            {
                return Err("Invalid hydration range".into());
            }
            auth::account_scope(account.clone(), async {
                let state = window.state::<auth::AuthState>();
                let (_, token) = auth::drive_credentials(&state).await?;
                let http = reqwest::Client::builder()
                    .connect_timeout(std::time::Duration::from_secs(20))
                    .read_timeout(std::time::Duration::from_secs(45))
                    .build()
                    .map_err(|e| e.to_string())?;
                let current = drive::api(
                    &http,
                    &token,
                    reqwest::Method::GET,
                    &format!("files/{id}"),
                    &[("fields", "size,modifiedTime,trashed".into())],
                    None,
                )
                .await?;
                if current["trashed"] == true
                    || current["modifiedTime"] != identity["modified"]
                    || current["size"] != identity["size"]
                {
                    return Err(
                        "The cloud file changed. Create a refreshed cloud view before opening it."
                            .into(),
                    );
                }
                let end = offset.checked_add(length - 1).ok_or("Invalid range")?;
                let mut response = http
                    .get(format!("https://www.googleapis.com/drive/v3/files/{id}"))
                    .bearer_auth(token)
                    .query(&[("alt", "media")])
                    .header("Range", format!("bytes={offset}-{end}"))
                    .send()
                    .await
                    .map_err(|_| "Offline: reconnect and open the file again.")?
                    .error_for_status()
                    .map_err(|e| e.to_string())?;
                validate_response(response.status().as_u16(),response.headers().get("content-range").and_then(|value|value.to_str().ok()),offset,length,size)?;
                let mut pending = Vec::new();
                let mut delivered = 0i64;
                let mut hasher=Sha256::new();
                let mut last_progress=std::time::Instant::now();
                while let Some(bytes) = response.chunk().await.map_err(|e| e.to_string())? {
                    crate::security::require_unlocked()?;
                    hasher.update(&bytes);
                    pending.extend_from_slice(&bytes);
                    while pending.len() >= 65536 {
                        if delivered + 65536 > length {
                            return Err("Invalid cloud response length".into());
                        }
                        complete(
                            key,
                            transfer,
                            request,
                            offset + delivered,
                            Some(&pending[..65536]),
                            65536,
                            0,
                        )?;
                        delivered += 65536;
                        if last_progress.elapsed()>=std::time::Duration::from_millis(200)||delivered==length{let _=window.emit("cirro-cloud-progress",json!({"id":progress_id,"name":identity["name"],"bytes":delivered,"total":length}));last_progress=std::time::Instant::now();}
                        pending.drain(..65536);
                    }
                }
                if !pending.is_empty() {
                    if delivered + pending.len() as i64 != length {
                        return Err("Incomplete cloud download".into());
                    }
                    complete(
                        key,
                        transfer,
                        request,
                        offset + delivered,
                        Some(&pending),
                        pending.len() as i64,
                        0,
                    )?;
                    delivered += pending.len() as i64;
                }
                if delivered != length {
                    return Err("Incomplete cloud download".into());
                }
                verified_checksum(expected,hasher)?;
                acknowledge_data(key,transfer,length,0)
            })
            .await
        }
        .await;
        if let Err(error) = outcome {
            let _ = acknowledge_data(key, transfer, length, error_status(&error));
            let _ = complete(
                key,
                transfer,
                request,
                offset,
                None,
                length,
                error_status(&error),
            );
            let _ = window.emit("cirro-cloud-error", error);
        }
    });
    task_guard.insert((transfer, request), task.inner().abort_handle());
}
fn connect(window: &Window, root: &Path, account: &str) -> Result<Connection, String> {
    super::shell::register(root, account)?;
    let path = wide(root.as_os_str());
    let name = wide(std::ffi::OsStr::new("Cirro Cloud (read-only)"));
    let version = wide(std::ffi::OsStr::new("0.1.0"));
    let registration = CF_SYNC_REGISTRATION {
        StructSize: size_of::<CF_SYNC_REGISTRATION>() as u32,
        ProviderName: name.as_ptr(),
        ProviderVersion: version.as_ptr(),
        SyncRootIdentity: account.as_ptr().cast(),
        SyncRootIdentityLength: account.len() as u32,
        ..Default::default()
    };
    let policies = CF_SYNC_POLICIES {
        StructSize: size_of::<CF_SYNC_POLICIES>() as u32,
        Hydration: CF_HYDRATION_POLICY {
            Primary: CF_HYDRATION_POLICY_FULL,
            Modifier: CF_HYDRATION_POLICY_MODIFIER_VALIDATION_REQUIRED,
        },
        Population: CF_POPULATION_POLICY {
            Primary: CF_POPULATION_POLICY_ALWAYS_FULL,
            Modifier: 0,
        },
        InSync: 0,
        HardLink: 0,
        PlaceholderManagement: 0,
    };
    unsafe {
        check(
            CfRegisterSyncRoot(
                path.as_ptr(),
                &registration,
                &policies,
                CF_REGISTER_FLAG_UPDATE,
            ),
            "Cloud root registration",
        )?;
    }
    let context = Box::new(Context {
        window: window.clone(),
        account: account.into(),
        tasks: Arc::new(Mutex::new(HashMap::new())),
    });
    let callbacks = [
        CF_CALLBACK_REGISTRATION {
            Type: CF_CALLBACK_TYPE_VALIDATE_DATA,
            Callback: Some(fetch),
        },
        CF_CALLBACK_REGISTRATION {
            Type: CF_CALLBACK_TYPE_CANCEL_FETCH_DATA,
            Callback: Some(cancel),
        },
        CF_CALLBACK_REGISTRATION {
            Type: CF_CALLBACK_TYPE_NOTIFY_DELETE,
            Callback: Some(deny),
        },
        CF_CALLBACK_REGISTRATION {
            Type: CF_CALLBACK_TYPE_NOTIFY_RENAME,
            Callback: Some(deny_rename),
        },
        CF_CALLBACK_REGISTRATION {
            Type: CF_CALLBACK_TYPE_FETCH_DATA,
            Callback: Some(fetch),
        },
        CF_CALLBACK_REGISTRATION {
            Type: CF_CALLBACK_TYPE_NONE,
            Callback: None,
        },
    ];
    let mut key = CF_CONNECTION_KEY::default();
    unsafe {
        check(
            CfConnectSyncRoot(
                path.as_ptr(),
                callbacks.as_ptr(),
                (&*context as *const Context).cast(),
                0,
                &mut key,
            ),
            "Connecting cloud provider",
        )?;
    }
    Ok(Connection {
        key,
        path: root.to_string_lossy().into_owned(),
        _context: context,
    })
}
pub fn reconnect(window: &Window) -> Result<(), String> {
    for root in records(window)? {
        if root["removing"] == true {
            continue;
        }
        let Some(path) = root["path"].as_str() else {
            continue;
        };
        let Some(account) = root["account"].as_str() else {
            continue;
        };
        if Path::new(path).is_dir() {
            match connect(window, Path::new(path), account) {
                Ok(connection) => window
                    .state::<super::CloudState>()
                    .connections
                    .lock()
                    .map_err(|e| e.to_string())?
                    .push(connection),
                Err(error) => {
                    window
                        .state::<super::CloudState>()
                        .connection_errors
                        .lock()
                        .map_err(|e| e.to_string())?
                        .insert(path.into(), error.clone());
                    let _ = window.emit("cirro-cloud-error", error);
                }
            }
        }
    }
    Ok(())
}
pub async fn command(window: Window, action: String, id: Option<String>) -> Result<Value, String> {
    if action == "list" {
        let mut roots = records(&window)?;
        let state = window.state::<super::CloudState>();
        let connections = state.connections.lock().map_err(|e| e.to_string())?;
        let errors = state.connection_errors.lock().map_err(|e| e.to_string())?;
        for root in &mut roots {
            if root["removing"] == true {
                root["status"] = json!("Removal incomplete — try Remove again");
                continue;
            }
            let path = root["path"].as_str().unwrap_or("").to_owned();
            if !connections.iter().any(|connection| connection.path == path) {
                root["status"] = json!("Provider disconnected");
                root["error"]=json!(errors.get(&path).cloned().unwrap_or("Cloud folder missing or unavailable. Restore the folder or create a fresh view.".into()));
            }
        }
        return Ok(json!(roots));
    }
    if action == "open" {
        let root = records(&window)?
            .into_iter()
            .find(|r| r["path"].as_str() == id.as_deref())
            .ok_or("Cloud view not found")?;
        open::that(root["path"].as_str().ok_or("Missing path")?).map_err(|e| e.to_string())?;
        return Ok(Value::Null);
    }
    if action == "remove" {
        let state = window.state::<super::CloudState>();
        let _gate = state
            .gate
            .try_lock()
            .map_err(|_| "Wait for the current cloud operation to finish.")?;
        let mut roots = records(&window)?;
        let path = id.ok_or("Select a cloud view to remove")?;
        let index = roots
            .iter()
            .position(|root| root["path"].as_str() == Some(&path))
            .ok_or("Cloud view not found")?;
        let account = roots[index]["account"]
            .as_str()
            .ok_or("Cloud account missing")?
            .to_owned();
        // Windows unregister traverses this tree. Only operate on a recorded root inside Cirro Cloud.
        let base = window
            .app_handle()
            .path()
            .home_dir()
            .map_err(|e| e.to_string())?
            .join("Cirro Cloud");
        let root = Path::new(&path);
        if !removal_path_allowed(&base, root) {
            return Err("Cloud view path is outside Cirro Cloud. Removal stopped.".into());
        }
        if root.exists() {
            let resolved = std::fs::canonicalize(root).map_err(|e| e.to_string())?;
            let resolved_base = std::fs::canonicalize(&base).map_err(|e| e.to_string())?;
            if !removal_path_allowed(&resolved_base, &resolved) {
                return Err("Cloud view resolves outside Cirro Cloud. Removal stopped.".into());
            }
            let expected = resolved_base.join(
                root.strip_prefix(&base)
                    .map_err(|_| "Invalid cloud view path")?,
            );
            if !resolved
                .to_string_lossy()
                .eq_ignore_ascii_case(&expected.to_string_lossy())
            {
                return Err("Cloud view was redirected to another folder. Removal stopped.".into());
            }
        }
        // Persist before disconnecting so a crash or partial failure never re-enables the view on launch.
        roots[index]["removing"] = json!(true);
        store(&window, &roots)?;
        let removed = (|| -> Result<(), String> {
            {
                let mut connections = state.connections.lock().map_err(|e| e.to_string())?;
                if let Some(index) = connections
                    .iter()
                    .position(|connection| connection.path == path)
                {
                    connections[index].disconnect()?;
                    connections.remove(index);
                }
            }
            let wide_path = wide(root.as_os_str());
            let result = unsafe { CfUnregisterSyncRoot(wide_path.as_ptr()) };
            if !matches!(
                result as u32,
                0x80070186 | 0xD000CF13 | 0x80070002 | 0x80070003
            ) {
                check(result, "Removing cloud view")?;
            }
            super::shell::unregister(root, &account)?;
            Ok(())
        })();
        if let Err(error) = removed {
            roots[index]["error"] = json!(error);
            store(&window, &roots)?;
            return Err(error);
        }
        roots.remove(index);
        store(&window, &roots)?;
        state
            .connection_errors
            .lock()
            .map_err(|e| e.to_string())?
            .remove(&path);
        return Ok(Value::Null);
    }
    if action != "create" {
        return Err("Unknown cloud action".into());
    }
    let state = window.state::<super::CloudState>();
    let _gate = state
        .gate
        .try_lock()
        .map_err(|_| "A cloud view is already being created. Wait for it to finish.")?;
    let pair_id = id.ok_or("Select a Flow folder")?;
    let (account, remote, name) = flow::cloud_source(&window, &pair_id)?;
    validate_name(&name)?;
    let user = auth::account_scope(account.clone(), async {
        auth::current_profile(&window.state::<auth::AuthState>()).await
    })
    .await?;
    validate_name(&user.email)?;
    let base = window
        .app_handle()
        .path()
        .home_dir()
        .map_err(|e| e.to_string())?
        .join("Cirro Cloud")
        .join(user.email);
    std::fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    // Do not register beneath symlinks, junctions, or a competing cloud provider.
    use std::os::windows::fs::MetadataExt;
    for ancestor in base.ancestors() {
        if std::fs::symlink_metadata(ancestor)
            .map_err(|e| e.to_string())?
            .file_attributes()
            & 0x400
            != 0
        {
            return Err(
                "Choose a local profile outside redirected or cloud-managed folders.".into(),
            );
        }
    }
    let root = crate::offline::readable_target(&base, &name);
    std::fs::create_dir(&root).map_err(|e| e.to_string())?;
    let mut roots = records(&window)?;
    roots.push(json!({"account":account,"path":root.to_string_lossy(),"pair":pair_id,"name":name,"status":"Incomplete — create a fresh view if setup is interrupted","readOnly":true}));
    store(&window, &roots)?;
    let connection = match connect(&window, &root, &account) {
        Ok(connection) => connection,
        Err(error) => {
            state
                .connection_errors
                .lock()
                .map_err(|e| e.to_string())?
                .insert(root.to_string_lossy().into_owned(), error.clone());
            if let Some(record) = roots.last_mut() {
                record["error"] = json!(error);
            }
            store(&window, &roots)?;
            return Err(error);
        }
    };
    window
        .state::<super::CloudState>()
        .connections
        .lock()
        .map_err(|e| e.to_string())?
        .push(connection);
    let populated:Result<(),String>=async {
    let mut queue = VecDeque::from([(remote, root.clone())]);
    let mut seen = HashSet::new();
    while let Some((parent, path)) = queue.pop_front() {
        if !seen.insert(parent.clone()) {
            return Err("Cloud folder cycle.".into());
        }
        let mut page = String::new();
        let mut names = HashSet::new();
        loop {
            let listing=auth::account_scope(account.clone(),async{let state=window.state::<auth::AuthState>();let(_,token)=auth::drive_credentials(&state).await?;drive::api(&drive::client()?,&token,reqwest::Method::GET,"files",&[("q",format!("'{parent}' in parents and trashed=false")),("pageSize","1000".into()),("pageToken",page),("fields","files(id,name,mimeType,size,modifiedTime,sha256Checksum),nextPageToken,incompleteSearch".into())],None).await}).await?;
            if listing["incompleteSearch"] == true {
                return Err("Incomplete cloud listing. Create a fresh view when connected.".into());
            }
            for file in listing["files"].as_array().ok_or("Invalid cloud listing")? {
                let name = file["name"].as_str().ok_or("Missing name")?;
                if name == ".cirro-flow-check" || name == "Cirro Recovery" {
                    continue;
                }
                validate_name(name)?;
                if name.is_empty()
                    || name == "."
                    || name == ".."
                    || name
                        .chars()
                        .any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
                    || name.ends_with([' ', '.'])
                    || !names.insert(name.to_lowercase())
                {
                    return Err(format!("Cloud filename collision: {name}"));
                }
                let folder = file["mimeType"] == "application/vnd.google-apps.folder";
                if folder {
                    let target = path.join(name);
                    std::fs::create_dir(&target).map_err(|e| e.to_string())?;
                    queue.push_back((file["id"].as_str().ok_or("Missing ID")?.into(), target));
                    continue;
                }
                if file["mimeType"]
                    .as_str()
                    .is_some_and(|mime| mime.starts_with("application/vnd.google-apps."))
                {
                    continue;
                }
                let size = file["size"]
                    .as_str()
                    .and_then(|s| s.parse::<i64>().ok())
                    .ok_or("Cloud file size unavailable")?;
                if size < 0{return Err("Invalid cloud file size".into());}
                let identity=json!({"account":account,"id":file["id"],"name":name,"checksum":file["sha256Checksum"],"modified":file["modifiedTime"],"size":file["size"]}).to_string();
                if identity.len()>4096{return Err("Cloud file identity exceeds Windows limits.".into());}
                let name = wide(std::ffi::OsStr::new(name));
                let mut placeholder = CF_PLACEHOLDER_CREATE_INFO {
                    RelativeFileName: name.as_ptr(),
                    FileIdentity: identity.as_ptr().cast(),
                    FileIdentityLength: identity.len() as u32,
                    Flags: CF_PLACEHOLDER_CREATE_FLAG_MARK_IN_SYNC,
                    ..Default::default()
                };
                placeholder.FsMetadata.FileSize = size;
                placeholder.FsMetadata.BasicInfo.FileAttributes = FILE_ATTRIBUTE_READONLY;
                let path = wide(path.as_os_str());
                let mut processed = 0;
                unsafe {
                    check(
                        CfCreatePlaceholders(
                            path.as_ptr(),
                            &mut placeholder,
                            1,
                            CF_CREATE_FLAG_STOP_ON_ERROR,
                            &mut processed,
                        ),
                        "Creating cloud file",
                    )?;
                    check(placeholder.Result, "Creating placeholder")?;
                }
            }
            if let Some(next) = listing["nextPageToken"].as_str() {
                page = next.into();
            } else {
                break;
            }
        }
    }
    Ok(()) }.await;
    if let Some(record) = roots.last_mut() {
        record["status"] = json!(if populated.is_ok() {
            "Ready — read-only snapshot"
        } else {
            "Incomplete — create a fresh view"
        });
        if let Err(error) = &populated {
            record["error"] = json!(error);
        }
    }
    store(&window, &roots)?;
    populated?;
    Ok(json!(root.to_string_lossy()))
}
fn removal_path_allowed(base: &Path, root: &Path) -> bool {
    root.is_absolute()
        && root.strip_prefix(base).is_ok_and(|tail| {
            tail.components().count() == 2
                && tail
                    .components()
                    .all(|part| matches!(part, std::path::Component::Normal(_)))
        })
}
fn validate_name(name: &str) -> Result<(), String> {
    let stem = name
        .split('.')
        .next()
        .unwrap_or("")
        .trim_end()
        .to_ascii_uppercase();
    let reserved = ["CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$"].contains(&stem.as_str())
        || ["COM", "LPT"].iter().any(|prefix| {
            stem.strip_prefix(prefix).is_some_and(|suffix| {
                ["1", "2", "3", "4", "5", "6", "7", "8", "9", "¹", "²", "³"].contains(&suffix)
            })
        });
    if reserved
        || name.is_empty()
        || name == "."
        || name == ".."
        || name.encode_utf16().count() > 255
        || name.ends_with([' ', '.'])
        || name
            .chars()
            .any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
    {
        Err(format!(
            "Windows cannot represent the cloud name {name}. Rename it in Drive first."
        ))
    } else {
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cloud_removal_is_confined_to_a_view_inside_its_account() {
        let base = Path::new(r"C:\Users\Example\Cirro Cloud");
        assert!(removal_path_allowed(
            base,
            &base.join("work@example.com").join("Projects")
        ));
        for root in [
            base.to_path_buf(),
            base.join("work@example.com"),
            base.join("work").join("..").join("elsewhere"),
            Path::new(r"C:\Users\Example\Documents").to_path_buf(),
        ] {
            assert!(!removal_path_allowed(base, &root));
        }
    }
    #[test]
    fn hydration_ranges_are_aligned_clamped_and_verified_before_transfer() {
        assert!(validate_response(206, Some("bytes 4096-8191/9000"), 4096, 4096, 9000).is_ok());
        assert!(validate_response(206, Some("bytes 0-4095/9000"), 4096, 4096, 9000).is_err());
        assert!(validate_response(200, None, 4096, 4904, 9000).is_err());
        assert!(validate_response(200, None, 0, 9000, 9000).is_ok());
    }
    #[test]
    fn changed_content_is_never_acknowledged_as_valid() {
        let original = Sha256::digest(b"original");
        let mut valid = Sha256::new();
        valid.update(b"original");
        assert!(verified_checksum(&format!("{original:x}"), valid).is_ok());
        let mut changed = Sha256::new();
        changed.update(b"modified");
        assert!(verified_checksum(&format!("{original:x}"), changed).is_err());
    }
    #[test]
    fn windows_names_cannot_escape_or_alias_devices() {
        for name in [
            "../escape",
            "CON.txt",
            "aux",
            "COM¹.txt",
            "NUL .txt",
            "photo:",
            "tail.",
            "..",
            "",
        ] {
            assert!(validate_name(name).is_err(), "{name}");
        }
        assert!(validate_name("Report — October.pdf").is_ok());
    }
    #[test]
    fn hydration_errors_distinguish_offline_permissions_and_stale_content() {
        assert_eq!(
            error_status("Drive is unreachable"),
            STATUS_CLOUD_FILE_NETWORK_UNAVAILABLE
        );
        assert_eq!(error_status("Drive 403"), STATUS_CLOUD_FILE_ACCESS_DENIED);
        assert_eq!(
            error_status("The cloud file changed"),
            STATUS_CLOUD_FILE_NOT_IN_SYNC
        );
    }
}
