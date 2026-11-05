#[cfg(windows)]
mod native;
#[cfg(windows)]
mod shell;
use tauri::Window;
pub struct CloudState {
    pub gate: tokio::sync::Mutex<()>,
    #[cfg(windows)]
    pub connections: std::sync::Mutex<Vec<native::Connection>>,
    #[cfg(windows)]
    pub connection_errors: std::sync::Mutex<std::collections::HashMap<String, String>>,
    #[cfg(windows)]
    pub downloads: std::sync::Arc<tokio::sync::Semaphore>,
}
impl Default for CloudState {
    fn default() -> Self {
        Self {
            gate: Default::default(),
            #[cfg(windows)]
            connections: Default::default(),
            #[cfg(windows)]
            connection_errors: Default::default(),
            #[cfg(windows)]
            downloads: std::sync::Arc::new(tokio::sync::Semaphore::new(4)),
        }
    }
}
#[tauri::command]
pub async fn cloud_files_command(
    window: Window,
    action: String,
    id: Option<String>,
) -> Result<serde_json::Value, String> {
    if window.label() != "main" {
        return Err("Main window required.".into());
    }
    #[cfg(windows)]
    {
        native::command(window, action, id).await
    }
    #[cfg(not(windows))]
    {
        let _ = (action, id);
        Err("Cirro Cloud requires Windows.".into())
    }
}
pub fn start(app: &tauri::App) {
    #[cfg(windows)]
    {
        use tauri::Manager;
        if let Some(window) = app.get_webview_window("main") {
            let _ = native::reconnect(&window.as_ref().window().clone());
        }
    }
    #[cfg(not(windows))]
    let _ = app;
}
