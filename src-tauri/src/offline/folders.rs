use crate::{
    auth::{self, AuthState},
    drive,
};
use reqwest::Client;
use serde_json::{json, Value};

use std::{
    collections::{HashSet, VecDeque},
    fs,
    io::Write,
    path::{Component, Path, PathBuf},
};
use tauri::{Emitter, Window};

pub(super) fn leaf(name: &str) -> String {
    let name: String = name
        .chars()
        .map(|c| {
            if c.is_control() || "<>:\"/\\|?*".contains(c) {
                '_'
            } else {
                c
            }
        })
        .take(100)
        .collect();
    let name = name.trim_end_matches([' ', '.']);
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    let reserved = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    if name.is_empty() {
        "Untitled".into()
    } else if reserved.contains(&stem.as_str()) {
        format!("_{name}")
    } else {
        name.into()
    }
}
fn unique(name: &str, used: &mut HashSet<String>) -> String {
    let base = leaf(name);
    if used.insert(base.to_lowercase()) {
        return base;
    }
    let (stem, extension) = base
        .rsplit_once('.')
        .map(|(stem, ext)| (stem, format!(".{ext}")))
        .unwrap_or((&base, String::new()));
    let mut index = 2;
    loop {
        let name = format!("{stem} ({index}){extension}");
        if used.insert(name.to_lowercase()) {
            return name;
        }
        index += 1;
    }
}
async fn token(state: &AuthState, account: &str) -> Result<String, String> {
    let (user, token) = auth::drive_credentials(state).await?;
    if user.id != account {
        return Err("Account changed during folder download.".into());
    }
    Ok(token)
}
fn export(mime: &str) -> Option<&'static str> {
    match mime {
        "application/vnd.google-apps.document"
        | "application/vnd.google-apps.spreadsheet"
        | "application/vnd.google-apps.presentation"
        | "application/vnd.google-apps.drawing" => Some("pdf"),
        _ => None,
    }
}

pub async fn save(
    window: &Window,
    state: &AuthState,
    account: &str,
    metadata: &Value,
    base: PathBuf,
) -> Result<Value, String> {
    let id = metadata["id"].as_str().ok_or("Folder ID missing.")?;
    let http = Client::builder()
        .timeout(std::time::Duration::from_secs(3600))
        .build()
        .map_err(|e| e.to_string())?;
    let user = auth::current_profile(state).await?;
    if user.id != account {
        return Err("Account changed during folder download.".into());
    }
    let parent = base.join(leaf(&user.email)).join("Folders");
    fs::create_dir_all(&parent).map_err(|e| e.to_string())?;
    let root = super::readable_target(&parent, metadata["name"].as_str().unwrap_or("Folder"));
    fs::create_dir(&root).map_err(|e| e.to_string())?;
    let mut items = vec![];
    let mut created_files = vec![];
    let mut directories = vec![root.clone()];
    let result:Result<Value,String>=async{
  let mut queue=VecDeque::from([(id.to_string(),root.clone())]);let mut visited=HashSet::new();let mut downloads=vec![];let mut links=0;
  while let Some((parent,destination))=queue.pop_front(){if !visited.insert(parent.clone()){return Err("A folder cycle was found. No offline folder was marked complete.".into());}let mut children=vec![];let mut page=String::new();loop{
   let response=http.get("https://www.googleapis.com/drive/v3/files").bearer_auth(token(state,account).await?).query(&[("q",format!("'{parent}' in parents and trashed = false")),("pageSize","1000".into()),("pageToken",page),("supportsAllDrives","true".into()),("includeItemsFromAllDrives","true".into()),("fields","nextPageToken,incompleteSearch,files(id,name,mimeType,modifiedTime,webViewLink,shortcutDetails)".into())]).send().await.map_err(|e|e.to_string())?.error_for_status().map_err(|e|e.to_string())?;
   let value:Value=response.json().await.map_err(|e|e.to_string())?;if value["incompleteSearch"]==true{return Err("Drive returned an incomplete folder listing. Retry the download.".into());}children.extend(value["files"].as_array().ok_or("Invalid folder listing.")?.iter().cloned());if let Some(next)=value["nextPageToken"].as_str(){page=next.into();}else{break;}
  }
  children.sort_by(|a,b|a["name"].as_str().cmp(&b["name"].as_str()).then(a["id"].as_str().cmp(&b["id"].as_str())));let mut used=HashSet::new();
  for file in children{let file_id=file["id"].as_str().ok_or("Child file ID missing.")?;if file_id.is_empty()||!file_id.chars().all(|c|c.is_ascii_alphanumeric()||c=='_'||c=='-'){return Err("Invalid child file ID.".into());}let mime=file["mimeType"].as_str().unwrap_or("");let folder=mime=="application/vnd.google-apps.folder";let cloud_link=!folder&&mime.starts_with("application/vnd.google-apps.")&&export(mime).is_none();let name=file["name"].as_str().unwrap_or("File");let name=if export(mime).is_some(){format!("{name}.pdf")}else if cloud_link{format!("{name}.url")}else{name.into()};let path=destination.join(unique(&name,&mut used));
   items.push(json!({"id":file_id,"path":path.to_string_lossy(),"kind":if folder{"folder"}else{"file"},"name":file["name"],"modified":file["modifiedTime"],"onlineLink":cloud_link}));
   if folder{fs::create_dir(&path).map_err(|e|e.to_string())?;directories.push(path.clone());queue.push_back((file_id.into(),path));}else{if cloud_link{links+=1;}downloads.push((file,path,cloud_link));}
  }
 }
 let total=downloads.len();for(index,(file,path,cloud_link))in downloads.into_iter().enumerate(){let file_id=file["id"].as_str().ok_or("File ID missing.")?;let _=window.emit("cirro-offline-progress",json!({"account":account,"id":id,"completed":index,"total":total,"name":file["name"]}));let mut output=fs::OpenOptions::new().write(true).create_new(true).open(&path).map_err(|e|e.to_string())?;created_files.push(path.clone());
  if cloud_link{let url=format!("https://drive.google.com/open?id={file_id}");output.write_all(format!("[InternetShortcut]\r\nURL={url}\r\n").as_bytes()).map_err(|e|e.to_string())?;}else{let mime=file["mimeType"].as_str().unwrap_or("");let exporting=export(mime).is_some();let url=format!("https://www.googleapis.com/drive/v3/files/{file_id}{}",if exporting{"/export"}else{""});let mut response=http.get(url).bearer_auth(token(state,account).await?).query(&[(if exporting{"mimeType"}else{"alt"},if exporting{"application/pdf"}else{"media"}),("supportsAllDrives","true")]).send().await.map_err(|e|e.to_string())?.error_for_status().map_err(|e|format!("Could not save {}: {e}",file["name"].as_str().unwrap_or("a file")))?;while let Some(chunk)=response.chunk().await.map_err(|e|e.to_string())?{crate::security::require_unlocked()?;output.write_all(&chunk).map_err(|e|e.to_string())?;}}
  output.sync_all().map_err(|e|e.to_string())?;let _=window.emit("cirro-offline-progress",json!({"account":account,"id":id,"completed":index+1,"total":total,"name":file["name"]}));
 }
 if auth::current_profile(state).await?.id!=account{return Err("Account changed during folder download.".into());}
 let value=json!({"path":root.to_string_lossy(),"kind":"folder","name":metadata["name"],"modified":metadata["modifiedTime"],"items":items,"complete":true,"onlineLinks":links,"files":total});drive::put(&drive::db(window)?,account,&format!("offline:{id}"),&value.to_string())?;Ok(value)
 }.await;
    if result.is_err() {
        // Only remove paths created by this operation; never recursively delete user files.
        for path in created_files.into_iter().rev() {
            if path.starts_with(&root) {
                let _ = fs::remove_file(path);
            }
        }
        for path in directories.into_iter().rev() {
            if path.starts_with(&root) {
                let _ = fs::remove_dir(path);
            }
        }
    }
    result
}

pub fn find(window: &Window, account: &str, id: &str) -> Result<Option<Value>, String> {
    let c = drive::db(window)?;
    let mut query = c
        .prepare("SELECT key,value FROM settings WHERE account=? AND key LIKE 'offline:%'")
        .map_err(|e| e.to_string())?;
    let rows = query
        .query_map([account], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;
    for row in rows {
        let (key, data) = row.map_err(|e| e.to_string())?;
        let value: Value = serde_json::from_str(&data).map_err(|e| e.to_string())?;
        if let Some(item) = value["items"]
            .as_array()
            .and_then(|items| items.iter().find(|item| item["id"] == id))
        {
            let mut item = item.clone();
            item["owner"] = json!(key.trim_start_matches("offline:"));
            return Ok(Some(item));
        }
    }
    Ok(None)
}
pub fn checked(root: &Path, path: &Path) -> Result<(), String> {
    if !root.is_absolute() || !path.starts_with(root) {
        return Err("Offline manifest contains a path outside its folder.".into());
    }
    let relative = path.strip_prefix(root).map_err(|e| e.to_string())?;
    if relative
        .components()
        .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err("Invalid offline manifest path.".into());
    }
    let mut current = root.to_path_buf();
    for segment in std::iter::once(None).chain(relative.components().map(Some)) {
        if let Some(segment) = segment {
            current.push(segment.as_os_str());
        }
        match fs::symlink_metadata(&current) {
            Ok(metadata) => {
                #[cfg(windows)]
                {
                    use std::os::windows::fs::MetadataExt;
                    if metadata.file_attributes() & 0x400 != 0 {
                        return Err("An offline folder was replaced by a link or junction. Remove the link manually before removing its saved copy.".into());
                    }
                }
                if metadata.file_type().is_symlink() {
                    return Err("Offline folder contains a link. It was left untouched.".into());
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(())
}
pub fn remove(window: &Window, account: &str, id: &str, value: &Value) -> Result<(), String> {
    let owner = value["owner"].as_str().unwrap_or(id);
    let c = drive::db(window)?;
    let raw = drive::get(&c, account, &format!("offline:{owner}"))
        .ok_or("Offline folder record missing.")?;
    let mut manifest: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let root = PathBuf::from(
        manifest["path"]
            .as_str()
            .ok_or("Offline folder path missing.")?,
    );
    let target = PathBuf::from(value["path"].as_str().ok_or("Offline path missing.")?);
    checked(&root, &target)?;
    let items = manifest["items"]
        .as_array()
        .ok_or("Offline folder manifest missing.")?;
    let mut selected: Vec<Value> = items
        .iter()
        .filter(|item| {
            item["path"]
                .as_str()
                .is_some_and(|path| Path::new(path).starts_with(&target))
        })
        .cloned()
        .collect();
    for item in &selected {
        checked(
            &root,
            Path::new(item["path"].as_str().ok_or("Offline item path missing.")?),
        )?;
    }
    selected.sort_by_key(|item| {
        std::cmp::Reverse(
            Path::new(item["path"].as_str().unwrap_or(""))
                .components()
                .count(),
        )
    });
    for item in &selected {
        let path = Path::new(item["path"].as_str().unwrap());
        if item["kind"] == "folder" {
            match fs::remove_dir(path) {
                Ok(()) => (),
                Err(e)
                    if matches!(
                        e.kind(),
                        std::io::ErrorKind::NotFound | std::io::ErrorKind::DirectoryNotEmpty
                    ) => {}
                Err(e) => return Err(e.to_string()),
            }
        } else {
            match fs::remove_file(path) {
                Ok(()) => (),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
                Err(e) => return Err(e.to_string()),
            }
        }
    }
    if owner == id {
        match fs::remove_dir(&root) {
            Ok(()) => (),
            Err(e)
                if matches!(
                    e.kind(),
                    std::io::ErrorKind::NotFound | std::io::ErrorKind::DirectoryNotEmpty
                ) => {}
            Err(e) => return Err(e.to_string()),
        }
        c.execute(
            "DELETE FROM settings WHERE account=? AND key=?",
            rusqlite::params![account, format!("offline:{id}")],
        )
        .map_err(|e| e.to_string())?;
    } else {
        manifest["items"] = json!(items
            .iter()
            .filter(|item| !selected.iter().any(|removed| removed["id"] == item["id"]))
            .cloned()
            .collect::<Vec<_>>());
        manifest["complete"] = json!(false);
        drive::put(
            &c,
            account,
            &format!("offline:{owner}"),
            &manifest.to_string(),
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn filenames_do_not_escape_or_use_reserved_windows_names() {
        assert_eq!(leaf("../CON.txt"), ".._CON.txt");
        assert_eq!(leaf("CON.txt"), "_CON.txt");
        assert_eq!(leaf(".."), "Untitled");
        assert!(!leaf("a/b\\c").contains(['/', '\\']));
    }
    #[test]
    fn duplicate_and_case_colliding_names_are_preserved() {
        let mut names = HashSet::new();
        assert_eq!(unique("Report.pdf", &mut names), "Report.pdf");
        assert_eq!(unique("report.pdf", &mut names), "report (2).pdf");
        assert_eq!(unique("Report.pdf", &mut names), "Report (3).pdf");
    }
    #[test]
    fn removal_rejects_outside_and_parent_traversal_paths() {
        let root = Path::new("C:\\Cirro\\saved");
        assert!(checked(root, Path::new("C:\\unrelated\\file")).is_err());
        assert!(checked(root, &root.join("..\\unrelated")).is_err());
    }
}
