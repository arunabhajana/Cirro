use sha2::{Digest, Sha256};
use std::path::Path;
use windows::{
    core::HSTRING,
    Storage::{Provider::*, StorageFolder},
    Win32::System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED},
};
use windows_sys::Win32::{
    Foundation::{CloseHandle, LocalFree},
    Security::{
        Authorization::ConvertSidToStringSidW, GetTokenInformation, TokenUser, TOKEN_QUERY,
        TOKEN_USER,
    },
    System::Threading::{GetCurrentProcess, OpenProcessToken},
};

// Match Explorer's provider!Windows-user-SID!account identifier convention.
fn sid() -> Result<String, String> {
    unsafe {
        let mut token = std::ptr::null_mut();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
            return Err("Cannot identify Windows account for cloud registration".into());
        }
        let result = (|| {
            let mut size = 0;
            GetTokenInformation(token, TokenUser, std::ptr::null_mut(), 0, &mut size);
            let mut buffer = vec![0u64; (size as usize).div_ceil(8)];
            if GetTokenInformation(
                token,
                TokenUser,
                buffer.as_mut_ptr().cast(),
                size,
                &mut size,
            ) == 0
            {
                return Err("Cannot read Windows account identity".into());
            }
            let user = &*(buffer.as_ptr() as *const TOKEN_USER);
            let mut text = std::ptr::null_mut();
            if ConvertSidToStringSidW(user.User.Sid, &mut text) == 0 {
                return Err("Cannot format Windows account identity".into());
            }
            let mut length = 0;
            while *text.add(length) != 0 {
                length += 1;
            }
            let sid = String::from_utf16_lossy(std::slice::from_raw_parts(text, length));
            LocalFree(text.cast());
            Ok(sid)
        })();
        CloseHandle(token);
        result
    }
}
fn root_id(path: &Path, account: &str) -> windows::core::Result<HSTRING> {
    let hash = format!("{:x}", Sha256::digest(path.to_string_lossy().as_bytes()));
    let sid = sid().map_err(|_| {
        windows::core::Error::from_hresult(windows::core::HRESULT(0x80070005u32 as i32))
    })?;
    Ok(HSTRING::from(format!(
        "Cirro!{sid}!{account}-{}",
        &hash[..16]
    )))
}
pub fn unregister(path: &Path, account: &str) -> Result<(), String> {
    let path = path.to_path_buf();
    let account = account.to_owned();
    std::thread::spawn(move||unsafe{
        RoInitialize(RO_INIT_MULTITHREADED).map_err(|error|format!("Windows Runtime unavailable: {error}"))?;
        let result=root_id(&path,&account).and_then(|id|StorageProviderSyncRootManager::Unregister(&id));
        RoUninitialize();
        match result{Ok(())=>Ok(()),Err(error) if matches!(error.code().0 as u32,0x80070490|0x80070002|0x80070186)=>Ok(()),Err(error)=>Err(format!("Could not remove the Explorer cloud registration: {error}. Close files in this view and try again."))}
    }).join().map_err(|_|"Explorer removal worker failed".to_string())?
}
pub fn register(path: &Path, account: &str) -> Result<(), String> {
    let path = path.to_path_buf();
    let account = account.to_owned();
    std::thread::spawn(move || unsafe {
        RoInitialize(RO_INIT_MULTITHREADED)
            .map_err(|error| format!("Windows Runtime unavailable: {error}"))?;
        struct Apartment;
        impl Drop for Apartment {
            fn drop(&mut self) {
                unsafe {
                    RoUninitialize();
                }
            }
        }
        let _apartment = Apartment;
        let result = (|| -> windows::core::Result<()> {
            let info = StorageProviderSyncRootInfo::new()?;
            info.SetId(&root_id(&path, &account)?)?;
            let folder = StorageFolder::GetFolderFromPathAsync(&HSTRING::from(
                path.to_string_lossy().as_ref(),
            ))?
            .join()?;
            info.SetPath(&folder)?;
            info.SetDisplayNameResource(&HSTRING::from(format!(
                "Cirro Cloud — {}",
                path.file_name().unwrap_or_default().to_string_lossy()
            )))?;
            let executable = std::env::current_exe().map_err(|_| {
                windows::core::Error::from_hresult(windows::core::HRESULT(0x80004005u32 as i32))
            })?;
            info.SetIconResource(&HSTRING::from(format!("{},0", executable.display())))?;
            info.SetHydrationPolicy(StorageProviderHydrationPolicy::Full)?;
            info.SetHydrationPolicyModifier(
                StorageProviderHydrationPolicyModifier::ValidationRequired,
            )?;
            info.SetPopulationPolicy(StorageProviderPopulationPolicy::AlwaysFull)?;
            info.SetVersion(&HSTRING::from("0.1.0"))?;
            info.SetShowSiblingsAsGroup(false)?;
            StorageProviderSyncRootManager::Register(&info)
        })();
        result.map_err(|error| format!("Explorer cloud registration failed: {error}"))
    })
    .join()
    .map_err(|_| "Explorer registration worker failed".to_string())?
}
