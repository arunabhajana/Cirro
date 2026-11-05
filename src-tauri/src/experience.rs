use serde_json::{json, Value};
use tauri::{Manager, Window};
const KEY: &str = "experience:state";
pub fn bootstrap(window: &Window) -> Result<Value, String> {
    let saved =
        crate::device_preferences::device_preference(window.clone(), KEY.into(), None, None)?;
    if !saved.is_null() {
        return Ok(saved);
    }
    let c = crate::drive::db(window)?;
    let existing:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM settings WHERE key IN ('about','root','accountLabel','pins')) OR EXISTS(SELECT 1 FROM files)",[],|row|row.get(0)).map_err(|e|e.to_string())?;
    let value = json!({"onboardingDone":existing,"step":0,"seenVersion":if existing{"0.1.0".to_string()}else{window.app_handle().package_info().version.to_string()}});
    crate::device_preferences::device_setting(window.clone(), KEY.into(), value.clone())?;
    Ok(value)
}
#[tauri::command]
pub fn experience_command(
    window: Window,
    action: String,
    step: Option<u64>,
) -> Result<Value, String> {
    crate::security::require_unlocked()?;
    if window.label() != "main" {
        return Err("Main window required".into());
    }
    let mut value = bootstrap(&window)?;
    match action.as_str() {
        "read" => return Ok(value),
        "progress" => value["step"] = json!(step.unwrap_or(0).min(3)),
        "finish" => {
            value["onboardingDone"] = json!(true);
            value["seenVersion"] = json!(window.app_handle().package_info().version.to_string());
            value["step"] = json!(0);
        }
        _ => return Err("Unknown introduction action".into()),
    }
    crate::device_preferences::device_setting(window, KEY.into(), value.clone())?;
    Ok(value)
}
