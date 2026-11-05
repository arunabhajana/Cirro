use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Manager, Window};
#[derive(Default)]
pub struct StartupState {
    pub tray: AtomicBool,
    pub quitting: AtomicBool,
}
pub fn preferences(window: &Window) -> Result<Value, String> {
    let saved =
        crate::device_preferences::device_preference(window.clone(), "startup".into(), None, None)?;
    Ok(
        json!({"launch":saved["launch"]==true,"minimized":saved["minimized"]==true,"restore":saved["restore"]==true,"tray":saved["tray"]==true}),
    )
}
#[tauri::command]
pub fn startup_settings(window: Window, value: Option<Value>) -> Result<Value, String> {
    if window.label() != "main" {
        return Err("Main window required".into());
    }
    if let Some(value) = value {
        for key in ["launch", "minimized", "restore", "tray"] {
            if !value[key].is_boolean() {
                return Err("Invalid startup preference".into());
            }
        }
        let old = preferences(&window)?;
        if value["launch"] != old["launch"] {
            set_login(value["launch"] == true)?;
        }
        if let Err(error) =
            crate::device_preferences::device_setting(window.clone(), "startup".into(), value)
        {
            if old["launch"] != false {
                let _ = set_login(true);
            } else {
                let _ = set_login(false);
            }
            return Err(error);
        }
    }
    let mut result = preferences(&window)?;
    result["development"] = json!(cfg!(debug_assertions));
    result["trayReady"] = json!(window.state::<StartupState>().tray.load(Ordering::SeqCst));
    Ok(result)
}
#[cfg(windows)]
fn set_login(enabled: bool) -> Result<(), String> {
    if cfg!(debug_assertions) {
        return Err("Launch at login is available in release builds only. Development builds never register themselves for startup.".into());
    }
    use windows_sys::Win32::System::Registry::*;
    let wide = |s: &str| s.encode_utf16().chain(Some(0)).collect::<Vec<_>>();
    unsafe {
        let mut key = std::ptr::null_mut();
        let status = RegCreateKeyExW(
            HKEY_CURRENT_USER,
            wide(r"Software\Microsoft\Windows\CurrentVersion\Run").as_ptr(),
            0,
            std::ptr::null(),
            0,
            KEY_SET_VALUE,
            std::ptr::null(),
            &mut key,
            std::ptr::null_mut(),
        );
        if status != 0 {
            return Err(format!(
                "Windows could not update startup settings ({status})"
            ));
        }
        let result = if enabled {
            let exe = std::env::current_exe().map_err(|e| e.to_string())?;
            let command = wide(&format!("\"{}\" --autostart", exe.display()));
            RegSetValueExW(
                key,
                wide("Cirro").as_ptr(),
                0,
                REG_SZ,
                command.as_ptr().cast(),
                (command.len() * 2) as u32,
            )
        } else {
            RegDeleteValueW(key, wide("Cirro").as_ptr())
        };
        RegCloseKey(key);
        if result != 0 && !(result == 2 && !enabled) {
            return Err(format!(
                "Windows could not change launch at login ({result})"
            ));
        }
        Ok(())
    }
}
#[cfg(not(windows))]
fn set_login(_: bool) -> Result<(), String> {
    Err("Launch at login currently requires Windows".into())
}
pub fn show(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
pub fn quit(app: &tauri::AppHandle) {
    if app
        .state::<StartupState>()
        .quitting
        .swap(true, Ordering::SeqCst)
    {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        crate::transfers::shutdown(&app).await;
        crate::flow::shutdown(app.clone()).await;
        app.exit(0);
    });
}
pub fn prepare(app: &tauri::App) -> tauri::Result<()> {
    use tauri::{
        menu::{Menu, MenuItem},
        tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    };
    let open = MenuItem::with_id(app, "open", "Open Cirro", true, None::<&str>)?;
    let exit = MenuItem::with_id(app, "quit", "Quit Cirro", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &exit])?;
    let icon = tauri::image::Image::from_bytes(include_bytes!(
        "../../public/branding/cirro-transparent-128.png"
    ))?;
    match TrayIconBuilder::with_id("cirro")
        .icon(icon)
        .tooltip(if cfg!(debug_assertions) {
            "Cirro · Development"
        } else {
            "Cirro"
        })
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show(app),
            "quit" => quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                show(tray.app_handle());
            }
        })
        .build(app)
    {
        Ok(_) => app
            .state::<StartupState>()
            .tray
            .store(true, Ordering::SeqCst),
        Err(error) => eprintln!("Cirro tray unavailable: {error}"),
    };
    Ok(())
}
pub fn hide_on_start(window: &Window) -> bool {
    preferences(window).is_ok_and(|prefs| prefs["minimized"] == true)
        && window.state::<StartupState>().tray.load(Ordering::SeqCst)
}
#[tauri::command]
pub fn startup_minimize(window: Window) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Main window required".into());
    }
    if window.state::<StartupState>().tray.load(Ordering::SeqCst)
        && preferences(&window)?["tray"] == true
    {
        window.hide().map_err(|e| e.to_string())
    } else {
        window.minimize().map_err(|e| e.to_string())
    }
}
pub fn window_event(window: &Window, event: &tauri::WindowEvent) {
    if let tauri::WindowEvent::Focused(value) = event {
        crate::security::focus(*value);
    }

    if window.label() != "main" {
        return;
    }
    let state = window.state::<StartupState>();
    if state.quitting.load(Ordering::SeqCst) {
        return;
    }
    let keep = state.tray.load(Ordering::SeqCst)
        && preferences(window).is_ok_and(|prefs| prefs["tray"] == true);
    match event {
        tauri::WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            if keep {
                let _ = window.hide();
            } else {
                quit(window.app_handle());
            }
        }
        tauri::WindowEvent::Resized(_) if keep && window.is_minimized().unwrap_or(false) => {
            let _ = window.hide();
        }
        _ => {}
    }
}
pub fn claim_instance() -> bool {
    #[cfg(windows)]
    if !cfg!(debug_assertions) {
        unsafe {
            use windows_sys::Win32::{
                Foundation::*, System::Threading::CreateMutexW, UI::WindowsAndMessaging::*,
            };
            let wide = |s: &str| s.encode_utf16().chain(Some(0)).collect::<Vec<_>>();
            let handle = CreateMutexW(
                std::ptr::null(),
                0,
                wide(r"Local\Cirro.com.drivedeck.desktop").as_ptr(),
            );
            if !handle.is_null() && GetLastError() == ERROR_ALREADY_EXISTS {
                CloseHandle(handle);
                let hwnd = FindWindowW(std::ptr::null(), wide("Cirro").as_ptr());
                if !hwnd.is_null() {
                    ShowWindow(hwnd, SW_RESTORE);
                    SetForegroundWindow(hwnd);
                }
                return false;
            }
        }
    }
    true
}
