use crate::auth::{self, AuthState};
use tauri::{State, Window};

#[tauri::command]
pub async fn pick_offline_folder(
    window: Window,
    state: State<'_, AuthState>,
    current: Option<String>,
) -> Result<Option<String>, String> {
    if window.label() != "main" {
        return Err("Main window required.".into());
    }
    auth::current_profile(&state).await?;
    #[cfg(windows)]
    {
        let owner = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
        tauri::async_runtime::spawn_blocking(move || choose(owner, current))
            .await
            .map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = current;
        Err(
            "Folder browsing is currently available on Windows. Enter a folder path instead."
                .into(),
        )
    }
}

#[cfg(windows)]
fn choose(owner: isize, current: Option<String>) -> Result<Option<String>, String> {
    use windows_sys::Win32::{
        System::Com::{CoInitializeEx, CoTaskMemFree, CoUninitialize, COINIT_APARTMENTTHREADED},
        UI::{
            Shell::{
                SHBrowseForFolderW, SHGetPathFromIDListEx, BFFM_INITIALIZED, BFFM_SETSELECTIONW,
                BIF_NEWDIALOGSTYLE, BIF_RETURNONLYFSDIRS, BROWSEINFOW, GPFIDL_DEFAULT,
            },
            WindowsAndMessaging::SendMessageW,
        },
    };
    unsafe extern "system" fn initialized(
        hwnd: windows_sys::Win32::Foundation::HWND,
        message: u32,
        _parameter: isize,
        data: isize,
    ) -> i32 {
        if message == BFFM_INITIALIZED && data != 0 {
            SendMessageW(hwnd, BFFM_SETSELECTIONW, 1, data);
        }
        0
    }
    let title: Vec<u16> = "Choose a folder".encode_utf16().chain(Some(0)).collect();
    let current: Vec<u16> = current
        .unwrap_or_default()
        .encode_utf16()
        .chain(Some(0))
        .collect();
    let mut display = [0u16; 260];
    // The dialog runs on its own STA thread. All strings and buffers outlive the
    // synchronous shell call; its returned PIDL is released with the COM allocator.
    unsafe {
        let result = CoInitializeEx(std::ptr::null(), COINIT_APARTMENTTHREADED as u32);
        if result < 0 {
            return Err("Could not initialize the system folder picker.".into());
        }
        let options = BROWSEINFOW {
            hwndOwner: owner as _,
            pszDisplayName: display.as_mut_ptr(),
            lpszTitle: title.as_ptr(),
            ulFlags: BIF_NEWDIALOGSTYLE | BIF_RETURNONLYFSDIRS,
            lpfn: Some(initialized),
            lParam: current.as_ptr() as isize,
            ..Default::default()
        };
        let selection = SHBrowseForFolderW(&options);
        if selection.is_null() {
            CoUninitialize();
            return Ok(None);
        }
        let mut path = vec![0u16; 32768];
        let success = SHGetPathFromIDListEx(
            selection,
            path.as_mut_ptr(),
            path.len() as u32,
            GPFIDL_DEFAULT,
        );
        CoTaskMemFree(selection.cast());
        CoUninitialize();
        if success == 0 {
            return Err("Select a folder on this computer or a mounted drive.".into());
        }
        let length = path
            .iter()
            .position(|character| *character == 0)
            .unwrap_or(path.len());
        Ok(Some(String::from_utf16(&path[..length]).map_err(|_| {
            "The selected folder path could not be read."
        })?))
    }
}
