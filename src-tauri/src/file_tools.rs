use crate::{auth, drive};
use serde_json::{json, Value};
use tauri::{Manager, Window};
pub fn valid_id(id: &str) -> Result<&str, String> {
    if !id.is_empty()
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        Ok(id)
    } else {
        Err("Invalid Drive identity".into())
    }
}
pub async fn request(
    window: &Window,
    account: &str,
    method: reqwest::Method,
    path: &str,
    query: &[(&str, String)],
    body: Option<Value>,
) -> Result<Value, String> {
    crate::security::require_unlocked()?;
    auth::account_scope(account.into(), async {
        let (_, token) = auth::drive_credentials(&window.state::<auth::AuthState>()).await?;
        drive::api(&drive::client()?, &token, method, path, query, body).await
    })
    .await
}
#[tauri::command]
pub async fn file_tools(
    window: Window,
    account: String,
    action: String,
    args: Value,
) -> Result<Value, String> {
    if window.label() != "main" {
        return Err("Main window required".into());
    }
    crate::security::require_unlocked()?;
    let id = valid_id(args["id"].as_str().unwrap_or("root"))?;
    use reqwest::Method;
    if action == "folders" {
        let mut folders=paged(&window,&account,"files",vec![("q",format!("'{id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false")),("fields","files(id,name,capabilities(canAddChildren)),nextPageToken,incompleteSearch".into()),("pageSize","1000".into()),("supportsAllDrives","true".into()),("includeItemsFromAllDrives","true".into())],"files").await?;
        folders.sort_by_key(|file| file["name"].as_str().unwrap_or("").to_lowercase());
        return Ok(json!(folders));
    }
    if action == "permissions" {
        let file = request(
            &window,
            &account,
            Method::GET,
            &format!("files/{id}"),
            &[
                (
                    "fields",
                    "id,name,webViewLink,capabilities(canShare)".into(),
                ),
                ("supportsAllDrives", "true".into()),
            ],
            None,
        )
        .await?;
        let permissions=paged(&window,&account,&format!("files/{id}/permissions"),vec![("fields","permissions(id,type,role,emailAddress,displayName,domain,allowFileDiscovery,permissionDetails),nextPageToken".into()),("pageSize","100".into()),("supportsAllDrives","true".into())],"permissions").await?;
        return Ok(json!({"file":file,"permissions":permissions}));
    }
    let guard = window.state::<drive::DriveLock>();
    let _guard = guard.0.lock().await;
    let file = request(
        &window,
        &account,
        Method::GET,
        &format!("files/{id}"),
        &[
            ("fields", "capabilities(canShare)".into()),
            ("supportsAllDrives", "true".into()),
        ],
        None,
    )
    .await?;
    if file["capabilities"]["canShare"] != true {
        return Err("This account cannot change access to this file".into());
    }
    let role = args["role"].as_str().unwrap_or("reader");
    if !["reader", "commenter", "writer"].contains(&role) {
        return Err("Ownership changes are not supported here".into());
    }
    match action.as_str() {
        "invite" => {
            let email = args["email"]
                .as_str()
                .ok_or("Enter an email address")?
                .trim();
            if email.len() > 254 || email.contains(char::is_whitespace) || !email.contains('@') {
                return Err("Enter a valid email address".into());
            }
            request(
                &window,
                &account,
                Method::POST,
                &format!("files/{id}/permissions"),
                &[
                    ("supportsAllDrives", "true".into()),
                    (
                        "sendNotificationEmail",
                        args["notify"].as_bool().unwrap_or(true).to_string(),
                    ),
                ],
                Some(json!({"type":"user","role":role,"emailAddress":email})),
            )
            .await
        }
        "public" => {
            request(
                &window,
                &account,
                Method::POST,
                &format!("files/{id}/permissions"),
                &[("supportsAllDrives", "true".into())],
                Some(json!({"type":"anyone","role":"reader","allowFileDiscovery":false})),
            )
            .await
        }
        "role" | "remove" => {
            let permission = valid_id(args["permission"].as_str().ok_or("Select a permission")?)?;
            let existing = request(
                &window,
                &account,
                Method::GET,
                &format!("files/{id}/permissions/{permission}"),
                &[
                    ("fields", "role,type,permissionDetails".into()),
                    ("supportsAllDrives", "true".into()),
                ],
                None,
            )
            .await?;
            if existing["role"] == "owner"
                || existing["permissionDetails"]
                    .as_array()
                    .is_some_and(|items| items.iter().any(|item| item["inherited"] == true))
            {
                return Err("Owners and inherited permissions cannot be changed here".into());
            }
            if action == "role" && existing["type"] == "anyone" && role != "reader" {
                return Err("Public links can only grant viewer access here".into());
            }
            request(
                &window,
                &account,
                if action == "remove" {
                    Method::DELETE
                } else {
                    Method::PATCH
                },
                &format!("files/{id}/permissions/{permission}"),
                &[("supportsAllDrives", "true".into())],
                if action == "remove" {
                    None
                } else {
                    Some(json!({"role":role}))
                },
            )
            .await
        }
        _ => Err("Unknown sharing action".into()),
    }
}

async fn paged(
    window: &Window,
    account: &str,
    path: &str,
    query: Vec<(&str, String)>,
    key: &str,
) -> Result<Vec<Value>, String> {
    collect_pages(
        |page: Option<String>| {
            let mut query = query.clone();
            if let Some(page) = page {
                query.push(("pageToken", page));
            }
            async move { request(window, account, reqwest::Method::GET, path, &query, None).await }
        },
        key,
    )
    .await
}
async fn collect_pages<F, Fut>(mut fetch: F, key: &str) -> Result<Vec<Value>, String>
where
    F: FnMut(Option<String>) -> Fut,
    Fut: std::future::Future<Output = Result<Value, String>>,
{
    let mut page = None;
    let mut result = vec![];
    let mut seen = std::collections::HashSet::new();
    let mut restarted = false;
    loop {
        let value = match fetch(page.clone()).await {
            Err(error)
                if !restarted
                    && (error.contains("pageTokenExpired")
                        || error.to_lowercase().contains("invalid page token")) =>
            {
                restarted = true;
                page = None;
                result.clear();
                seen.clear();
                continue;
            }
            value => value?,
        };
        if value["incompleteSearch"] == true {
            return Err("Drive returned an incomplete listing. Retry.".into());
        }
        result.extend(
            value[key]
                .as_array()
                .ok_or("Invalid Drive list response")?
                .iter()
                .cloned(),
        );
        if result.len() > 100000 {
            return Err("Drive listing is too large. Open a smaller folder.".into());
        }
        match value["nextPageToken"]
            .as_str()
            .filter(|token| !token.is_empty())
        {
            Some(token) => {
                if !seen.insert(token.to_owned()) {
                    return Err("Drive returned a repeated page token. Retry.".into());
                }
                page = Some(token.into());
            }
            None => return Ok(result),
        }
    }
}
#[cfg(test)]
mod pagination_tests {
    use super::*;
    #[tokio::test]
    async fn expired_page_restarts_without_partial_or_duplicate_permissions() {
        let mut calls = 0;
        let result = collect_pages(
            |page| {
                calls += 1;
                let value = match calls {
                    1 => {
                        assert!(page.is_none());
                        Ok(json!({"permissions":[{"id":"old"}],"nextPageToken":"expired"}))
                    }
                    2 => {
                        assert_eq!(page.as_deref(), Some("expired"));
                        Err("Drive 403: [pageTokenExpired] rejected".into())
                    }
                    3 => {
                        assert!(page.is_none());
                        Ok(json!({"permissions":[{"id":"fresh"}]}))
                    }
                    _ => panic!("unbounded retry"),
                };
                std::future::ready(value)
            },
            "permissions",
        )
        .await
        .unwrap();
        assert_eq!(result, json!([{"id":"fresh"}]).as_array().unwrap().clone());
    }
    #[tokio::test]
    async fn permanently_expired_tokens_stop_after_one_restart() {
        let mut calls = 0;
        assert!(collect_pages(
            |_| {
                calls += 1;
                std::future::ready(Err("pageTokenExpired".into()))
            },
            "permissions"
        )
        .await
        .is_err());
        assert_eq!(calls, 2);
    }
    #[tokio::test]
    async fn repeated_tokens_stop_instead_of_looping() {
        assert!(collect_pages(
            |_| std::future::ready(Ok(json!({"permissions":[],"nextPageToken":"same"}))),
            "permissions"
        )
        .await
        .is_err());
    }
}
