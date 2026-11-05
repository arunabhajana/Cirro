use tauri::{Manager, PhysicalPosition, PhysicalSize, Window};

pub fn prepare(app: &tauri::App) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("main") {
        if cfg!(debug_assertions) {
            window.set_title("Cirro · Development")?;
        }
        // Clamp before the first visible frame; the configured 960px height can
        // exceed the usable monitor area, especially with a top taskbar or DPI scaling.
        if let Some(monitor) = window.current_monitor()?.or(window.primary_monitor()?) {
            let area = monitor.work_area();
            let scale = monitor.scale_factor();
            let margin = (16.0 * scale) as u32;
            let available = PhysicalSize::new(
                area.size.width.saturating_sub(margin * 2).max(1),
                area.size.height.saturating_sub(margin * 2).max(1),
            );
            window.set_min_size(Some(PhysicalSize::new(
                ((1000.0 * scale) as u32).min(available.width),
                ((600.0 * scale) as u32).min(available.height),
            )))?;
            let requested = window.outer_size()?;
            let size = PhysicalSize::new(
                requested.width.min(available.width),
                requested.height.min(available.height),
            );
            window.set_size(size)?;
            window.set_position(PhysicalPosition::new(
                area.position.x + ((area.size.width - size.width) / 2) as i32,
                area.position.y + ((area.size.height - size.height) / 2) as i32,
            ))?;
        }
        #[cfg(target_os = "windows")]
        unsafe {
            install_work_area_bounds(window.hwnd()?.0 as _);
        }
        set_brand_icon(window.as_ref().window().clone()).map_err(std::io::Error::other)?;
        if !crate::startup::hide_on_start(&window.as_ref().window()) {
            window.show()?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn set_brand_icon(window: Window) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Only the main window can change its icon.".into());
    }
    let bytes = include_bytes!("../../public/branding/cirro-transparent-128.png");
    let icon =
        tauri::image::Image::from_bytes(bytes).map_err(|_| "Could not load the Cirro icon.")?;
    window
        .set_icon(icon)
        .map_err(|_| "Could not update the window icon.".into())
}

#[cfg(target_os = "windows")]
unsafe fn install_work_area_bounds(hwnd: windows_sys::Win32::Foundation::HWND) {
    use windows_sys::Win32::{
        Foundation::*,
        Graphics::Gdi::*,
        UI::{Shell::*, WindowsAndMessaging::*},
    };
    unsafe extern "system" fn bounds(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        id: usize,
        _: usize,
    ) -> LRESULT {
        let result = DefSubclassProc(hwnd, message, wparam, lparam);
        if message == WM_GETMINMAXINFO && lparam != 0 {
            let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
            let mut info: MONITORINFO = std::mem::zeroed();
            info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
            if GetMonitorInfoW(monitor, &mut info) != 0 {
                let limits = &mut *(lparam as *mut MINMAXINFO);
                limits.ptMaxPosition.x = info.rcWork.left - info.rcMonitor.left;
                limits.ptMaxPosition.y = info.rcWork.top - info.rcMonitor.top;
                limits.ptMaxSize.x = info.rcWork.right - info.rcWork.left;
                limits.ptMaxSize.y = info.rcWork.bottom - info.rcWork.top;
                limits.ptMaxTrackSize = limits.ptMaxSize;
                limits.ptMinTrackSize.x = limits.ptMinTrackSize.x.min(limits.ptMaxSize.x);
                limits.ptMinTrackSize.y = limits.ptMinTrackSize.y.min(limits.ptMaxSize.y);
            }
            return 0;
        }
        if message == 0x02B1 && wparam == 7 {
            crate::security::lock();
        }
        if message == 0x0218 && wparam == 4 {
            crate::security::lock();
        }
        if message == WM_NCDESTROY {
            RemoveWindowSubclass(hwnd, Some(bounds), id);
        }
        result
    }
    crate::security::SESSION_NOTIFICATIONS_READY.store(
        windows_sys::Win32::System::RemoteDesktop::WTSRegisterSessionNotification(hwnd, 0) != 0,
        std::sync::atomic::Ordering::SeqCst,
    );
    SetWindowSubclass(hwnd, Some(bounds), 0x43495252, 0);
}
