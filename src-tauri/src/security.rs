use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager, Window};
static LOCKED: AtomicBool = AtomicBool::new(true);
static POLICY: Mutex<Policy> = Mutex::new(Policy {
    enabled: false,
    minutes: 5,
    recent: true,
});
static UNFOCUSED: Mutex<Option<Instant>> = Mutex::new(None);
static VERIFYING: AtomicBool = AtomicBool::new(false);
pub static SESSION_NOTIFICATIONS_READY: AtomicBool = AtomicBool::new(false);
static GENERATION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
static LAST_UNLOCK: Mutex<Option<Instant>> = Mutex::new(None);
static WINDOW: std::sync::OnceLock<Window> = std::sync::OnceLock::new();
#[derive(Clone, Serialize, Deserialize)]
struct Policy {
    enabled: bool,
    minutes: u64,
    recent: bool,
}
fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new("com.drivedeck.desktop", "app-lock-policy").map_err(|e| e.to_string())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn a_locked_process_denies_direct_and_aggregated_data_commands() {
        let previous = LOCKED.swap(true, Ordering::SeqCst);
        for command in [
            "account_call",
            "auth_status",
            "auth_sign_in",
            "auth_remove",
            "device_preference",
            "device_setting",
            "drive_cache",
            "drive_content",
            "drive_upload_chunk",
            "offline_open",
            "cloud_files_command",
            "flow_command",
            "storage_download",
            "storage_settings",
            "maintenance_command",
            "file_tools",
            "transfer_command",
            "desktop_notification",
            "unknown_command",
        ] {
            assert!(blocked(command), "{command}");
        }
        assert!(require_unlocked().is_err());
        assert!(!blocked("security_command"));
        assert!(!blocked("startup_minimize"));
        assert!(!blocked("set_brand_icon"));
        LOCKED.store(previous, Ordering::SeqCst);
    }
}
pub fn locked() -> bool {
    LOCKED.load(Ordering::SeqCst)
}
pub fn require_unlocked() -> Result<(), String> {
    if locked() {
        Err("Cirro is locked. Unlock with Windows Hello first.".into())
    } else {
        Ok(())
    }
}
pub fn lock() {
    let Ok(policy) = POLICY.lock() else {
        LOCKED.store(true, Ordering::SeqCst);
        return;
    };
    if policy.enabled {
        GENERATION.fetch_add(1, Ordering::SeqCst);
        LOCKED.store(true, Ordering::SeqCst);
        if let Some(window) = WINDOW.get() {
            let _ = window.emit("cirro-lock", true);
        }
    }
}
pub fn history_enabled() -> bool {
    POLICY.lock().is_ok_and(|p| p.recent)
}
pub fn focus(focused: bool) {
    if let Ok(mut value) = UNFOCUSED.lock() {
        *value = if focused { None } else { Some(Instant::now()) };
    }
}
fn evaluate() {
    let Ok(policy) = POLICY.lock() else {
        LOCKED.store(true, Ordering::SeqCst);
        return;
    };
    if !policy.enabled {
        return;
    }
    let limit = Duration::from_secs(policy.minutes.saturating_mul(60));
    let background = UNFOCUSED
        .lock()
        .is_ok_and(|value| value.is_some_and(|time| time.elapsed() >= limit));
    #[cfg(windows)]
    let idle = unsafe {
        use windows_sys::Win32::{
            System::SystemInformation::GetTickCount,
            UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO},
        };
        let mut input = LASTINPUTINFO {
            cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
            dwTime: 0,
        };
        GetLastInputInfo(&mut input) != 0
            && Duration::from_millis(GetTickCount().wrapping_sub(input.dwTime) as u64) >= limit
    };
    #[cfg(not(windows))]
    let idle = false;
    let grace = LAST_UNLOCK
        .lock()
        .is_ok_and(|time| time.is_some_and(|time| time.elapsed() < limit));
    if !locked() && !grace && (background || idle) {
        GENERATION.fetch_add(1, Ordering::SeqCst);
        LOCKED.store(true, Ordering::SeqCst);
        if let Some(window) = WINDOW.get() {
            let _ = window.emit("cirro-lock", true);
        }
    }
}
pub fn blocked(command: &str) -> bool {
    evaluate();
    locked()
        && !matches!(
            command,
            "security_command" | "startup_minimize" | "set_brand_icon"
        )
}
pub fn start(app: &tauri::App) -> Result<(), String> {
    let policy = match entry()?.get_password() {
        Ok(raw) => serde_json::from_str::<Policy>(&raw)
            .map_err(|_| "Invalid lock policy in Windows credential store")?,
        Err(keyring::Error::NoEntry) => Policy {
            enabled: false,
            minutes: 5,
            recent: true,
        },
        Err(error) => return Err(format!("Cannot read lock policy: {error}")),
    };
    LOCKED.store(policy.enabled, Ordering::SeqCst);
    *POLICY.lock().map_err(|e| e.to_string())? = policy;
    if let Some(window) = app.get_webview_window("main") {
        let window = window.as_ref().window().clone();
        let _ = WINDOW.set(window.clone());
        tauri::async_runtime::spawn(async move {
            let mut previous = locked();
            loop {
                tokio::time::sleep(Duration::from_secs(1)).await;
                evaluate();
                let current = locked();
                if current != previous {
                    let _ = window.emit("cirro-lock", current);
                    previous = current;
                }
            }
        });
    }
    Ok(())
}
#[cfg(windows)]
async fn verify(window: &Window) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as usize;
    if !SESSION_NOTIFICATIONS_READY.load(Ordering::SeqCst) {
        let ready = unsafe {
            windows_sys::Win32::System::RemoteDesktop::WTSRegisterSessionNotification(
                hwnd as *mut _,
                0,
            ) != 0
        };
        SESSION_NOTIFICATIONS_READY.store(ready, Ordering::SeqCst);
        if !ready {
            return Err("Windows session-lock monitoring is unavailable. Try again after Windows finishes signing in.".into());
        }
    }
    tauri::async_runtime::spawn_blocking(move||unsafe{
 use windows::{core::{factory,HSTRING},Security::Credentials::UI::{UserConsentVerifier,UserConsentVerificationResult,UserConsentVerifierAvailability},Win32::{Foundation::HWND,System::WinRT::{IUserConsentVerifierInterop,RoInitialize,RoUninitialize,RO_INIT_MULTITHREADED}}};
 RoInitialize(RO_INIT_MULTITHREADED).map_err(|e|e.to_string())?;struct Apartment;impl Drop for Apartment{fn drop(&mut self){unsafe{RoUninitialize();}}}let _apartment=Apartment;
 if UserConsentVerifier::CheckAvailabilityAsync().map_err(|e|e.to_string())?.join().map_err(|e|e.to_string())?!=UserConsentVerifierAvailability::Available{return Err("Windows Hello is unavailable. Set up a Windows Hello PIN, fingerprint, or face in Windows Sign-in options.".into());}
 let interop=factory::<UserConsentVerifier,IUserConsentVerifierInterop>().map_err(|e|e.to_string())?;
 let operation:windows_future::IAsyncOperation<UserConsentVerificationResult>=interop.RequestVerificationForWindowAsync(HWND(hwnd as *mut _),&HSTRING::from("Unlock Cirro")).map_err(|e|e.to_string())?;
 if operation.join().map_err(|e|e.to_string())?!=UserConsentVerificationResult::Verified{return Err("Windows Hello did not verify your identity. Cirro remains protected.".into());}Ok(())
 }).await.map_err(|e|e.to_string())?
}
#[cfg(not(windows))]
async fn verify(_: &Window) -> Result<(), String> {
    Err("Windows Hello requires Windows".into())
}
#[tauri::command]
pub async fn security_command(
    window: Window,
    action: String,
    value: Option<Value>,
) -> Result<Value, String> {
    if window.label() != "main" {
        return Err("Main window required".into());
    }
    if action == "status" {
        return Ok(
            json!({"locked":locked(),"policy":POLICY.lock().map_err(|e|e.to_string())?.clone()}),
        );
    }
    if action == "lock" {
        require_unlocked()?;
        lock();
        return Ok(json!({"locked":locked()}));
    }
    if action == "unlock" || action == "save" {
        if action == "save" {
            require_unlocked()?;
        }
        if VERIFYING.swap(true, Ordering::SeqCst) {
            return Err("Windows Hello verification is already open".into());
        }
        struct Verifying;
        impl Drop for Verifying {
            fn drop(&mut self) {
                VERIFYING.store(false, Ordering::SeqCst);
            }
        }
        let _verifying = Verifying;
        let generation = GENERATION.load(Ordering::SeqCst);
        if action == "unlock"
            || value.as_ref().is_some_and(|v| v["enabled"] == true)
            || POLICY.lock().map_err(|e| e.to_string())?.enabled
        {
            verify(&window).await?;
        }
        let mut current_policy = POLICY.lock().map_err(|e| e.to_string())?;
        if generation != GENERATION.load(Ordering::SeqCst) {
            return Err("Cirro was locked again during verification. Unlock again.".into());
        }
        if action == "save" {
            let policy: Policy = serde_json::from_value(value.ok_or("Missing policy")?)
                .map_err(|e| e.to_string())?;
            if ![1, 5, 15, 30].contains(&policy.minutes) {
                return Err("Invalid inactivity duration".into());
            }
            if !policy.recent {
                let c = crate::drive::db(&window)?;
                c.execute("DELETE FROM settings WHERE key='recent'", [])
                    .map_err(|e| e.to_string())?;
                c.execute("DELETE FROM activity WHERE action='open'", [])
                    .map_err(|e| e.to_string())?;
            }
            entry()?
                .set_password(&serde_json::to_string(&policy).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
            *current_policy = policy;
        }
        *LAST_UNLOCK.lock().map_err(|e| e.to_string())? = Some(Instant::now());
        LOCKED.store(false, Ordering::SeqCst);
        let _ = window.emit("cirro-lock", false);
        focus(true);
        return Ok(json!({"locked":false,"policy":current_policy.clone()}));
    }
    require_unlocked()?;
    if action == "clear-previews" {
        crate::drive::db(&window)?
            .execute("DELETE FROM thumbnails", [])
            .map_err(|e| e.to_string())?;
        return Ok(Value::Null);
    }
    Err("Unknown security action".into())
}
