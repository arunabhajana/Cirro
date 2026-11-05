#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod auth;
mod cloud_files;
mod desktop;
mod device_preferences;
mod drive;
mod experience;
mod file_tools;
mod flow;
mod folder_picker;
mod maintenance;
mod multi;
mod notifications;
mod offline;
mod offline_inventory;
mod security;
mod startup;
mod storage_policy;
mod transfers;
mod updates;
fn main() {
    if !startup::claim_instance() {
        return;
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(updates::UpdateState::default())
        .manage(auth::AuthState::default())
        .manage(drive::Uploads::default())
        .manage(drive::DriveLock::default())
        .manage(flow::FlowState::default())
        .manage(transfers::TransferState::default())
        .manage(cloud_files::CloudState::default())
        .manage(startup::StartupState::default())
        .setup(|app| {
            security::start(app).map_err(std::io::Error::other)?;
            startup::prepare(app)?;
            desktop::prepare(app)?;
            if let Some(window) = tauri::Manager::get_webview_window(app, "main") {
                let _ = experience::bootstrap(&window.as_ref().window());
            }
            flow::start(app);
            transfers::start(app);
            cloud_files::start(app);
            Ok(())
        })
        .on_window_event(startup::window_event)
        .invoke_handler(|invoke| {
            if security::blocked(invoke.message.command()) {
                invoke
                    .resolver
                    .reject("Cirro is locked. Unlock with Windows Hello first.");
                return true;
            }
            let handler: fn(tauri::ipc::Invoke<tauri::Wry>) -> bool = tauri::generate_handler![
                security::security_command,
                updates::update_command,
                experience::experience_command,
                storage_policy::storage_settings,
                storage_policy::storage_download,
                auth::auth_status,
                flow::flow_command,
                transfers::transfer_command,
                file_tools::file_tools,
                maintenance::maintenance_command,
                startup::startup_settings,
                startup::startup_minimize,
                notifications::desktop_notification,
                cloud_files::cloud_files_command,
                device_preferences::device_preference,
                device_preferences::device_setting,
                auth::auth_accounts,
                auth::auth_activate,
                auth::auth_remove,
                multi::account_call,
                auth::auth_sign_in,
                auth::auth_sign_out,
                auth::auth_cancel,
                desktop::set_brand_icon,
                drive::drive_cache,
                drive::drive_setting,
                drive::drive_sync,
                drive::drive_mutate,
                drive::drive_content,
                drive::drive_upload_start,
                drive::drive_upload_chunk,
                drive::drive_preference,
                drive::drive_open,
                offline::offline_save,
                offline_inventory::saved_inventory,
                offline::offline_open,
                offline::offline_remove,
                offline::offline_directory,
                folder_picker::pick_offline_folder
            ];
            handler(invoke)
        })
        .build(tauri::generate_context!())
        .expect("Unable to start Cirro")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
                if code.is_none() {
                    api.prevent_exit();
                    startup::quit(app);
                }
            }
        });
}
