use serde_json::{json, Value};
use tauri::{Manager, Window};
pub fn settings(window: &Window) -> Result<Value, String> {
    let saved = crate::device_preferences::device_preference(
        window.clone(),
        "storagePolicy".into(),
        None,
        None,
    )?;
    Ok(
        json!({"automatic":saved["automatic"]!=false,"metered":saved["metered"]==true,"conflict":saved["conflict"].as_str().unwrap_or("keep"),"downloads":saved["downloads"].as_str().map(str::to_owned).unwrap_or(window.app_handle().path().download_dir().map_err(|e|e.to_string())?.to_string_lossy().into_owned())}),
    )
}
pub fn background_allowed(window: &Window) -> bool {
    if crate::security::locked() {
        return false;
    }
    let Ok(settings) = settings(window) else {
        return false;
    };
    if settings["metered"] != true {
        return true;
    }
    #[cfg(windows)]
    {
        std::thread::spawn(|| unsafe {
            use windows::{
                Networking::Connectivity::{NetworkCostType, NetworkInformation},
                Win32::System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED},
            };
            if RoInitialize(RO_INIT_MULTITHREADED).is_err() {
                return false;
            }
            let result = NetworkInformation::GetInternetConnectionProfile()
                .and_then(|profile| profile.GetConnectionCost())
                .and_then(|cost| cost.NetworkCostType())
                .is_ok_and(|kind| kind == NetworkCostType::Unrestricted);
            RoUninitialize();
            result
        })
        .join()
        .unwrap_or(false)
    }
    #[cfg(not(windows))]
    {
        false
    }
}
#[tauri::command]
pub fn storage_settings(window: Window, value: Option<Value>) -> Result<Value, String> {
    crate::security::require_unlocked()?;
    if window.label() != "main" {
        return Err("Main window required".into());
    }
    if let Some(value) = value {
        if !value["automatic"].is_boolean()
            || !value["metered"].is_boolean()
            || !matches!(value["conflict"].as_str(), Some("keep" | "replace" | "ask"))
        {
            return Err("Invalid storage policy".into());
        }
        let path = std::path::Path::new(
            value["downloads"]
                .as_str()
                .ok_or("Choose a download folder")?,
        );
        if !path.is_absolute() || !path.is_dir() {
            return Err("Choose an existing download folder".into());
        }
        crate::device_preferences::device_setting(window.clone(), "storagePolicy".into(), value)?;
    }
    let mut value = settings(&window)?;
    value["backgroundAllowed"] = json!(background_allowed(&window));
    Ok(value)
}
#[tauri::command]
pub async fn storage_download(
    window: Window,
    account: String,
    id: String,
) -> Result<String, String> {
    crate::auth::account_scope(account, async {
        let (_, token) =
            crate::auth::drive_credentials(&window.state::<crate::auth::AuthState>()).await?;
        if !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
            || id.is_empty()
        {
            return Err("Invalid Drive file".into());
        }
        let http = reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(20))
            .read_timeout(std::time::Duration::from_secs(45))
            .build()
            .map_err(|e| e.to_string())?;
        let file = crate::drive::api(
            &http,
            &token,
            reqwest::Method::GET,
            &format!("files/{id}"),
            &[
                ("fields", "name,mimeType,capabilities(canDownload)".into()),
                ("supportsAllDrives", "true".into()),
            ],
            None,
        )
        .await?;
        if file["capabilities"]["canDownload"] == false {
            return Err("The owner has disabled downloads".into());
        }
        let mut name = file["name"].as_str().ok_or("File name missing")?.to_owned();
        let google = file["mimeType"]
            .as_str()
            .is_some_and(|mime| mime.starts_with("application/vnd.google-apps."));
        let url = if google {
            if !matches!(
                file["mimeType"].as_str(),
                Some(
                    "application/vnd.google-apps.document"
                        | "application/vnd.google-apps.spreadsheet"
                        | "application/vnd.google-apps.presentation"
                        | "application/vnd.google-apps.drawing"
                )
            ) {
                return Err("This Google file must be opened in Drive to download".into());
            }
            name.push_str(".pdf");
            format!(
                "https://www.googleapis.com/drive/v3/files/{id}/export?mimeType=application/pdf"
            )
        } else {
            format!(
                "https://www.googleapis.com/drive/v3/files/{id}?alt=media&supportsAllDrives=true"
            )
        };
        let policy = settings(&window)?;
        let directory = std::path::Path::new(
            policy["downloads"]
                .as_str()
                .ok_or("Download folder missing")?,
        );
        let target = crate::offline::readable_target(directory, &name);
        let temporary = directory.join(format!(
            ".cirro-download-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|e| e.to_string())?
                .as_nanos()
        ));
        struct Partial(std::path::PathBuf);
        impl Drop for Partial {
            fn drop(&mut self) {
                let _ = std::fs::remove_file(&self.0);
            }
        }
        let _partial = Partial(temporary.clone());
        let mut output = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|e| e.to_string())?;
        let mut response = http
            .get(url)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|_| "Download interrupted. Check your connection.")?
            .error_for_status()
            .map_err(|e| e.to_string())?;
        let total = response.content_length();
        let mut received = 0;
        use std::io::Write;
        use tauri::Emitter;
        while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
            crate::security::require_unlocked()?;
            output.write_all(&chunk).map_err(|e| e.to_string())?;
            received += chunk.len() as u64;
            let _ = window.emit(
                "cirro-download-progress",
                json!({"id":id,"received":received,"total":total}),
            );
        }
        if total.is_some_and(|total| total != received) {
            return Err("Incomplete download. Try again.".into());
        }
        output.sync_all().map_err(|e| e.to_string())?;
        drop(output);
        crate::security::require_unlocked()?;
        if std::fs::hard_link(&temporary, &target).is_err() {
            let mut destination = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&target)
                .map_err(|e| {
                    format!("Could not create download without overwriting another file: {e}")
                })?;
            let cleanup = Partial(target.clone());
            let mut source = std::fs::File::open(&temporary).map_err(|e| e.to_string())?;
            std::io::copy(&mut source, &mut destination).map_err(|e| e.to_string())?;
            destination.sync_all().map_err(|e| e.to_string())?;
            drop(destination);
            std::mem::forget(cleanup);
        }
        Ok(target.to_string_lossy().into_owned())
    })
    .await
}
