use tauri::{Manager, Window};
fn escape(text: &str) -> String {
    text.chars()
        .filter(|c| !c.is_control() || *c == '\n')
        .take(400)
        .collect::<String>()
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn notification_text_cannot_inject_actions() {
        assert_eq!(
            escape("A&B <file> \"quote\""),
            "A&amp;B &lt;file&gt; &quot;quote&quot;"
        );
        assert!(!escape("file\0name").contains('\0'));
        assert!(escape(&"x".repeat(900)).len() <= 400);
    }
}
#[tauri::command]
pub async fn desktop_notification(
    window: Window,
    category: String,
    title: String,
    body: String,
) -> Result<String, String> {
    if window.label() != "main" {
        return Err("Main window required".into());
    }
    if !["uploads", "errors", "storage", "test"].contains(&category.as_str()) {
        return Err("Unknown notification category".into());
    }
    if crate::security::locked() {
        return Ok("muted".into());
    }
    let prefs = crate::device_preferences::device_preference(
        window.clone(),
        "notifications".into(),
        None,
        None,
    )?;
    if prefs["dnd"] == true || prefs["enabled"] == false || prefs[&category] == false {
        return Ok("muted".into());
    }
    // Debug builds never register or send under the installed application's identity.
    if cfg!(debug_assertions) {
        return Ok("development".into());
    }
    #[cfg(windows)]
    {
        let silent = prefs["sound"] != true;
        tauri::async_runtime::spawn_blocking(move || {
            send(&window, &category, &title, &body, silent)
        })
        .await
        .map_err(|e| e.to_string())??;
        Ok("sent".into())
    }
    #[cfg(not(windows))]
    {
        let _ = (title, body);
        Err("Desktop notifications currently require Windows".into())
    }
}
#[cfg(windows)]
fn send(
    window: &Window,
    category: &str,
    title: &str,
    body: &str,
    silent: bool,
) -> Result<(), String> {
    use windows::{
        core::HSTRING,
        Data::Xml::Dom::XmlDocument,
        Win32::System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED},
        UI::Notifications::{NotificationSetting, ToastNotification, ToastNotificationManager},
    };
    use windows_sys::Win32::System::Registry::*;
    let directory = window
        .app_handle()
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("Notifications");
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let image = directory.join("cirro.png");
    std::fs::write(
        &image,
        include_bytes!("../../public/branding/cirro-transparent-128.png"),
    )
    .map_err(|e| e.to_string())?;
    let identity = "com.drivedeck.desktop";
    let wide = |s: &str| s.encode_utf16().chain(Some(0)).collect::<Vec<_>>();
    unsafe {
        let identity_result =
            windows_sys::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID(
                wide(identity).as_ptr(),
            );
        if identity_result < 0 {
            return Err("Could not set the Cirro app identity".into());
        }
        let path = wide(&format!("Software\\Classes\\AppUserModelId\\{identity}"));
        let mut key = std::ptr::null_mut();
        let result = RegCreateKeyExW(
            HKEY_CURRENT_USER,
            path.as_ptr(),
            0,
            std::ptr::null(),
            0,
            KEY_SET_VALUE,
            std::ptr::null(),
            &mut key,
            std::ptr::null_mut(),
        );
        if result != 0 {
            return Err(format!(
                "Could not register Cirro notifications: Windows {result}"
            ));
        }
        let mut result = 0;
        for (name, value) in [
            ("DisplayName", "Cirro".to_string()),
            ("IconUri", image.to_string_lossy().into_owned()),
        ] {
            let value = wide(&value);
            result |= RegSetValueExW(
                key,
                wide(name).as_ptr(),
                0,
                REG_SZ,
                value.as_ptr().cast(),
                (value.len() * 2) as u32,
            );
        }
        RegCloseKey(key);
        if result != 0 {
            return Err("Could not save the Cirro notification identity".into());
        }
        RoInitialize(RO_INIT_MULTITHREADED).map_err(|e| e.to_string())?;
    }
    struct Apartment;
    impl Drop for Apartment {
        fn drop(&mut self) {
            unsafe {
                RoUninitialize();
            }
        }
    }
    let _apartment = Apartment;
    let notifier = ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(identity))
        .map_err(|e| e.to_string())?;
    if notifier.Setting().map_err(|e| e.to_string())? != NotificationSetting::Enabled {
        return Err("Windows has disabled Cirro notifications. Enable Cirro in Windows Settings → System → Notifications.".into());
    }
    let uri = url::Url::from_file_path(image).map_err(|_| "Invalid notification image path")?;
    let (label, target) = if category == "storage" {
        ("Manage storage", "https://one.google.com/storage")
    } else if category == "test" {
        ("Windows settings", "ms-settings:notifications")
    } else {
        (
            "Open Google Drive",
            "https://drive.google.com/drive/my-drive",
        )
    };
    let xml=format!("<toast><visual><binding template=\"ToastGeneric\"><image placement=\"appLogoOverride\" src=\"{}\"/><text>{}</text><text>{}</text></binding></visual><actions><action content=\"{}\" activationType=\"protocol\" arguments=\"{}\"/></actions>{}</toast>",escape(uri.as_str()),escape(title),escape(body),label,target,if silent{"<audio silent=\"true\"/>"}else{""});
    let document = XmlDocument::new().map_err(|e| e.to_string())?;
    document
        .LoadXml(&HSTRING::from(xml))
        .map_err(|e| e.to_string())?;
    let toast = ToastNotification::CreateToastNotification(&document).map_err(|e| e.to_string())?;
    toast
        .SetGroup(&HSTRING::from("cirro"))
        .map_err(|e| e.to_string())?;
    toast
        .SetTag(&HSTRING::from(category))
        .map_err(|e| e.to_string())?;
    notifier.Show(&toast).map_err(|e| e.to_string())
}
