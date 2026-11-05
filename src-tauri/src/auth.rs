//! Google Desktop OAuth: system browser, ephemeral loopback, PKCE, state and OIDC nonce.
//! Only the profile crosses IPC. Refresh credentials live in the OS credential store.
use openidconnect::{
    core::{CoreAuthenticationFlow, CoreClient, CoreProviderMetadata},
    reqwest, AccessTokenHash, AuthorizationCode, ClientId, ClientSecret, CsrfToken, IssuerUrl,
    Nonce, OAuth2TokenResponse, PkceCodeChallenge, RedirectUrl, Scope, TokenResponse,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    sync::atomic::{AtomicBool, AtomicU64, Ordering},
    time::Duration,
};
use tauri::{State, Window};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::Mutex,
};

const CLIENT_ID: &str = env!("GOOGLE_CLIENT_ID");
const CLIENT_SECRET: &str = env!("GOOGLE_CLIENT_SECRET");
const STORE: &str = "com.drivedeck.desktop.google";
const CANCELLED: &str = "Sign-in cancelled.";

#[derive(Clone, Serialize, Deserialize)]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub email: String,
    pub picture: Option<String>,
}
#[derive(Clone, Serialize, Deserialize)]
struct SavedSession {
    client_id: String,
    refresh_token: String,
    profile: Profile,
}
#[derive(Default)]
struct Session {
    checked: bool,
    profile: Option<Profile>,
}
#[derive(Default)]
pub struct AuthState {
    session: Mutex<Session>,
    running: AtomicBool,
    generation: AtomicU64,
    access: Mutex<std::collections::HashMap<String, (u64, String, std::time::Instant)>>,
}
#[derive(Serialize)]
pub struct Status {
    configured: bool,
    user: Option<Profile>,
}

fn configured() -> bool {
    !CLIENT_ID.trim().is_empty() && !CLIENT_SECRET.trim().is_empty()
}
fn credential() -> Result<keyring::Entry, String> {
    keyring::Entry::new(
        STORE,
        &ACCOUNT
            .try_with(|id| format!("account-{id}"))
            .unwrap_or("single-account".into()),
    )
    .map_err(|_| "Your system credential store is unavailable.".into())
}
fn clear_saved() -> Result<(), String> {
    match credential()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("Could not remove the saved session from your system credential store. Please try signing out again.".into()),
    }
}
fn http() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|_| "Could not initialize Google sign-in.".into())
}
fn trusted_picture(value: Option<String>) -> Option<String> {
    value.filter(|value| {
        url::Url::parse(value).ok().is_some_and(|u| {
            u.scheme() == "https"
                && u.host_str()
                    .is_some_and(|h| h.ends_with(".googleusercontent.com"))
        })
    })
}
// Keep commands restricted to the application's main window.
fn main_window(window: &Window) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("Sign-in is only available in the main window.".into())
    }
}

#[tauri::command]
pub async fn auth_status(window: Window, state: State<'_, AuthState>) -> Result<Status, String> {
    main_window(&window)?;
    let mut session = state.session.lock().await;
    if !configured() {
        return Ok(Status {
            configured: false,
            user: None,
        });
    }
    if !session.checked {
        let saved = match credential()?.get_password() {
            Ok(value) => Some(value),
            Err(keyring::Error::NoEntry) => None,
            Err(_) => return Err(
                "Could not read your saved session. Check your system credential store and retry."
                    .into(),
            ),
        };
        if let Some(value) = saved {
            let saved: SavedSession = match serde_json::from_str(&value) {
                Ok(saved) => saved,
                Err(_) => {
                    clear_saved()?;
                    return Err("Your saved session could not be read. Sign in again.".into());
                }
            };
            if saved.client_id != CLIENT_ID {
                clear_saved()?;
            } else {
                // A refresh proves the saved grant is still valid; userinfo binds it to the saved subject.
                let client = http()?;
                let response = client.post("https://oauth2.googleapis.com/token").form(&[
                    ("client_id", CLIENT_ID), ("client_secret", CLIENT_SECRET),
                    ("refresh_token", saved.refresh_token.as_str()), ("grant_type", "refresh_token")
                ]).send().await.map_err(|_| "Could not restore your session. Check your connection and retry, or sign in again.".to_string())?;
                let status = response.status();
                let tokens: serde_json::Value = response.json().await.map_err(|_| {
                    "Google returned an unreadable session response. Please retry.".to_string()
                })?;
                if !status.is_success() {
                    if tokens["error"] == "invalid_grant" {
                        clear_saved()?;
                        session.checked = true;
                        return Ok(Status {
                            configured: true,
                            user: None,
                        });
                    }
                    return Err("Google could not restore your session. Check your OAuth configuration and retry.".into());
                }
                let access = tokens["access_token"]
                    .as_str()
                    .ok_or("Google did not return a session token.")?;
                let response = client
                    .get("https://openidconnect.googleapis.com/v1/userinfo")
                    .bearer_auth(access)
                    .send()
                    .await
                    .map_err(|_| {
                        "Could not verify your saved Google account. Please retry.".to_string()
                    })?;
                if !response.status().is_success() {
                    return Err("Could not verify your Google account. Sign in again.".into());
                }
                let info: serde_json::Value = response
                    .json()
                    .await
                    .map_err(|_| "Google returned an unreadable profile.".to_string())?;
                if info["sub"].as_str() != Some(saved.profile.id.as_str()) {
                    clear_saved()?;
                    return Err("Your saved account has changed. Sign in again.".into());
                }
                let profile = Profile {
                    id: saved.profile.id,
                    name: info["name"]
                        .as_str()
                        .unwrap_or(&saved.profile.name)
                        .to_string(),
                    email: info["email"]
                        .as_str()
                        .unwrap_or(&saved.profile.email)
                        .to_string(),
                    picture: trusted_picture(info["picture"].as_str().map(str::to_string)),
                };
                // Google can rotate refresh tokens; replace the stored token before exposing the session.
                let refreshed = SavedSession {
                    client_id: CLIENT_ID.into(),
                    profile: profile.clone(),
                    refresh_token: tokens["refresh_token"]
                        .as_str()
                        .unwrap_or(&saved.refresh_token)
                        .into(),
                };
                credential()?
                    .set_password(
                        &serde_json::to_string(&refreshed)
                            .map_err(|_| "Could not save your session.")?,
                    )
                    .map_err(|_| {
                        "Could not save your session in the system credential store.".to_string()
                    })?;
                session.profile = Some(profile);
            }
        }
        session.checked = true;
    }
    Ok(Status {
        configured: true,
        user: session.profile.clone(),
    })
}

struct Running<'a>(&'a AtomicBool);
pub async fn drive_credentials(state: &AuthState) -> Result<(Profile, String), String> {
    crate::security::require_unlocked()?;
    let session = state.session.lock().await;
    let profile = if let Ok(id) = ACCOUNT.try_with(Clone::clone) {
        saved_account(&id)?.profile
    } else {
        session.profile.clone().ok_or("Sign in to Google first.")?
    };
    let generation = state.generation.load(Ordering::SeqCst);
    let mut cached = state.access.lock().await;
    if let Some((saved_generation, token, expires)) = cached.get(&profile.id) {
        if *saved_generation == generation && *expires > std::time::Instant::now() {
            return Ok((profile, token.clone()));
        }
    }
    let value = credential()?
        .get_password()
        .map_err(|_| "Saved Google session unavailable.")?;
    let saved: SavedSession = serde_json::from_str(&value).map_err(|_| "Invalid saved session.")?;
    if saved.profile.id != profile.id {
        return Err("Account changed. Sign in again.".into());
    }
    let response = http()?
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("client_id", CLIENT_ID),
            ("client_secret", CLIENT_SECRET),
            ("refresh_token", saved.refresh_token.as_str()),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .await
        .map_err(|_| "Could not connect to Google. Your cached metadata is still available.")?;
    if !response.status().is_success() {
        if response.status().as_u16() == 429 || response.status().is_server_error() {
            return Err(format!(
                "Google authentication is temporarily unavailable (HTTP {}). Please retry.",
                response.status().as_u16()
            ));
        }
        return Err("Google session expired. Sign out and sign in again.".into());
    }
    let data: serde_json::Value = response
        .json()
        .await
        .map_err(|_| "Invalid Google token response.")?;
    let token = data["access_token"]
        .as_str()
        .ok_or("No Google access token returned.")?
        .to_string();
    cached.insert(
        profile.id.clone(),
        (
            generation,
            token.clone(),
            std::time::Instant::now()
                + Duration::from_secs(
                    data["expires_in"]
                        .as_u64()
                        .unwrap_or(3600)
                        .saturating_sub(120),
                ),
        ),
    );
    Ok((profile, token))
}
pub async fn current_profile(state: &AuthState) -> Result<Profile, String> {
    crate::security::require_unlocked()?;
    if let Ok(id) = ACCOUNT.try_with(Clone::clone) {
        return Ok(saved_account(&id)?.profile);
    }
    state
        .session
        .lock()
        .await
        .profile
        .clone()
        .ok_or("Sign in first.".into())
}
impl Drop for Running<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

#[tauri::command]
pub async fn auth_sign_in(window: Window, state: State<'_, AuthState>) -> Result<Profile, String> {
    main_window(&window)?;
    if !configured() {
        return Err(
            "Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env, then restart the desktop app."
                .into(),
        );
    }
    if state.running.swap(true, Ordering::SeqCst) {
        return Err("A Google sign-in is already in progress.".into());
    }
    let _running = Running(&state.running);
    let generation = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
    let task = async {
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .map_err(|_| "Could not open the local Google sign-in callback.".to_string())?;
        let port = listener
            .local_addr()
            .map_err(|_| "Could not open the sign-in callback.")?
            .port();
        let redirect = format!("http://127.0.0.1:{port}/oauth/google/callback");
        let http = http()?;
        let metadata = CoreProviderMetadata::discover_async(
            IssuerUrl::new("https://accounts.google.com".into()).unwrap(),
            &http,
        )
        .await
        .map_err(|_| "Could not reach Google. Check your connection and try again.".to_string())?;
        let client = CoreClient::from_provider_metadata(
            metadata,
            ClientId::new(CLIENT_ID.into()),
            Some(ClientSecret::new(CLIENT_SECRET.into())),
        )
        .set_auth_type(openidconnect::AuthType::RequestBody)
        .set_redirect_uri(
            RedirectUrl::new(redirect).map_err(|_| "Could not prepare Google sign-in.")?,
        );
        let (challenge, verifier) = PkceCodeChallenge::new_random_sha256();
        let (url, csrf, nonce) = client
            .authorize_url(
                CoreAuthenticationFlow::AuthorizationCode,
                CsrfToken::new_random,
                Nonce::new_random,
            )
            .add_scope(Scope::new("email".into()))
            .add_scope(Scope::new("profile".into()))
            .add_scope(Scope::new("https://www.googleapis.com/auth/drive".into()))
            .set_pkce_challenge(challenge)
            .add_extra_param("access_type", "offline")
            .add_extra_param("prompt", "consent select_account")
            .url();
        open::that_detached(url.as_str()).map_err(|_| {
            "Could not open your browser. Check your default browser and try again.".to_string()
        })?;
        let (code, mut socket) = callback(&listener, port, csrf.secret()).await?;
        // Hold the accepted socket until identity verification and secure persistence finish.
        let result: Result<Profile, String> = async {
            let tokens = client.exchange_code(AuthorizationCode::new(code)).map_err(|_| "Could not prepare the Google token exchange.")?
                .set_pkce_verifier(verifier).request_async(&http).await
                .map_err(|_| "Google could not complete sign-in. Check your OAuth client configuration and try again.".to_string())?;
            let id_token = tokens.id_token().ok_or("Google did not return an identity token.")?;
            let verifier = client.id_token_verifier();
            let claims = id_token.claims(&verifier, &nonce).map_err(|_| "Google's identity response could not be verified. Try signing in again.".to_string())?;
            if let Some(expected) = claims.access_token_hash() {
                let actual = AccessTokenHash::from_token(tokens.access_token(), id_token.signing_alg().map_err(|_| "Invalid Google identity signature.")?, id_token.signing_key(&verifier).map_err(|_| "Invalid Google identity key.")?)
                    .map_err(|_| "Could not verify Google's session token.")?;
                if actual != *expected { return Err("Google's session token could not be verified.".into()); }
            }
            let email = claims.email().ok_or("Google did not share your email address.")?.as_str().to_string();
            let profile = Profile { id: claims.subject().as_str().into(),
                name: claims.name().and_then(|v| v.get(None)).map(|v| v.as_str()).unwrap_or(&email).into(), email,
                picture: trusted_picture(claims.picture().and_then(|v| v.get(None)).map(|v| v.as_str().to_string())) };
            let refresh = tokens.refresh_token().ok_or("Google did not return a persistent session. Please sign in again and allow the requested access.")?;
            let saved = SavedSession { client_id: CLIENT_ID.into(), refresh_token: refresh.secret().into(), profile: profile.clone() };
            let mut session = state.session.lock().await;
            if state.generation.load(Ordering::SeqCst) != generation { return Err(CANCELLED.into()); }
            ensure_account_slot(&profiles()?,&profile.id)?;
            credential()?.set_password(&serde_json::to_string(&saved).map_err(|_| "Could not save your account.")?)
                .map_err(|_| "Could not save your session in the system credential store. No account was connected.".to_string())?;
            remember(&saved)?;
            session.profile = Some(profile.clone()); session.checked = true;
            Ok(profile)
        }.await;
        let success = result.is_ok();
        let return_url = format!("http://127.0.0.1:{port}/return/{}", csrf.secret());
        let return_path = format!("/return/{}", csrf.secret());
        let return_window = window.clone();
        // Do not yield after committing the session: cancellation must never leave a
        // saved account behind while reporting a cancelled sign-in to the renderer.
        tauri::async_runtime::spawn(async move {
            let _ = tokio::time::timeout(
                Duration::from_secs(2),
                browser_reply_with_return(
                    &mut socket,
                    if success {
                        "Sign-in complete"
                    } else {
                        "Sign-in could not finish"
                    },
                    if success {
                        "Return to Cirro. You can close this tab."
                    } else {
                        "Return to Cirro for details and try again."
                    },
                    if success {
                        Some(return_url.as_str())
                    } else {
                        None
                    },
                ),
            )
            .await;
            if success {
                let _=tokio::time::timeout(Duration::from_secs(300),async {
                    loop {let (mut connection,_)=listener.accept().await?;let mut bytes=[0u8;4096];let count=tokio::time::timeout(Duration::from_secs(2),connection.read(&mut bytes)).await.ok().and_then(Result::ok).unwrap_or(0);let expected=format!("GET {return_path} HTTP/1.1");if std::str::from_utf8(&bytes[..count]).unwrap_or("").starts_with(&expected){let _=return_window.unminimize();let _=return_window.set_focus();browser_reply(&mut connection,"Cirro is ready","You can return to the app and close this tab.").await?;break;}else{connection.write_all(b"HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n").await?;}}Ok::<(),std::io::Error>(())
                }).await;
            }
        });
        if success {
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
        result
    };
    tokio::select! {
        result = tokio::time::timeout(Duration::from_secs(300), task) => result.unwrap_or_else(|_| Err("Sign-in timed out. Please try again.".into())),
        _ = async { loop { tokio::time::sleep(Duration::from_millis(150)).await; if state.generation.load(Ordering::SeqCst) != generation { break; } } } => Err(CANCELLED.into()),
    }
}

#[tauri::command]
pub async fn auth_cancel(window: Window, state: State<'_, AuthState>) -> Result<(), String> {
    main_window(&window)?;
    state.generation.fetch_add(1, Ordering::SeqCst);
    Ok(())
}
#[tauri::command]
pub async fn auth_sign_out(window: Window, state: State<'_, AuthState>) -> Result<(), String> {
    main_window(&window)?;
    state.generation.fetch_add(1, Ordering::SeqCst);
    let mut session = state.session.lock().await;
    clear_saved()?;
    session.profile = None;
    session.checked = true;
    // Local sign-out only: don't sign out Google's browser session or revoke other apps.
    Ok(())
}

fn callback_code(request: &str, port: u16, state: &str) -> Option<Result<String, String>> {
    let mut lines = request.split("\r\n");
    let mut first = lines.next()?.split_whitespace();
    if first.next()? != "GET" {
        return None;
    }
    let target = first.next()?;
    if !target.starts_with("/oauth/google/callback?") || target.len() > 8000 {
        return None;
    }
    let host = format!("127.0.0.1:{port}");
    if !lines.any(|line| {
        line.split_once(':')
            .is_some_and(|(key, value)| key.eq_ignore_ascii_case("host") && value.trim() == host)
    }) {
        return None;
    }
    let url = url::Url::parse(&format!("http://{host}{target}")).ok()?;
    let pairs: Vec<_> = url.query_pairs().collect();
    let one = |key: &str| {
        let values: Vec<_> = pairs
            .iter()
            .filter(|(k, _)| k == key)
            .map(|(_, v)| v.to_string())
            .collect();
        if values.len() == 1 {
            values.into_iter().next()
        } else {
            None
        }
    };
    if Sha256::digest(one("state")?.as_bytes()) != Sha256::digest(state.as_bytes()) {
        return None;
    }
    if one("error").is_some() {
        return Some(Err(
            "Google sign-in was declined or cancelled. You can try again.".into(),
        ));
    }
    Some(
        one("code")
            .filter(|code| !code.is_empty())
            .ok_or_else(|| "Google did not return a sign-in code. Please retry.".into()),
    )
}
async fn callback(
    listener: &TcpListener,
    port: u16,
    state: &str,
) -> Result<(String, TcpStream), String> {
    loop {
        let (mut socket, _) = listener
            .accept()
            .await
            .map_err(|_| "The sign-in callback closed. Please retry.")?;
        let read = async {
            let mut bytes = Vec::new();
            loop {
                let mut part = [0u8; 1024];
                let count = socket.read(&mut part).await.ok()?;
                if count == 0 || bytes.len() + count > 8192 {
                    return None;
                }
                bytes.extend_from_slice(&part[..count]);
                if bytes.ends_with(b"\r\n\r\n") {
                    break;
                }
            }
            callback_code(std::str::from_utf8(&bytes).ok()?, port, state)
        };
        match tokio::time::timeout(Duration::from_secs(3), read).await {
            Ok(Some(Ok(code))) => return Ok((code, socket)),
            Ok(Some(Err(error))) => {
                let _ = browser_reply(
                    &mut socket,
                    "Sign-in cancelled",
                    "Return to Cirro to try again.",
                )
                .await;
                return Err(error);
            }
            _ => {
                let _ = tokio::time::timeout(Duration::from_secs(1), socket.write_all(b"HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n")).await;
            }
        }
    }
}
async fn browser_reply(socket: &mut TcpStream, title: &str, message: &str) -> std::io::Result<()> {
    browser_reply_with_return(socket, title, message, None).await
}
async fn browser_reply_with_return(
    socket: &mut TcpStream,
    title: &str,
    message: &str,
    return_url: Option<&str>,
) -> std::io::Result<()> {
    use base64::Engine;
    let logo = base64::engine::general_purpose::STANDARD.encode(include_bytes!(
        "../../public/branding/cirro-transparent-128.png"
    ));
    let button=return_url.map(|url|format!("<a style=\"display:inline-block;padding:12px 22px;background:#1677ef;color:white;border-radius:10px;text-decoration:none;margin-top:20px\" href=\"{url}\">Go back to Cirro</a>")).unwrap_or_default();
    let html = format!(
        r#"<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Cirro · {title}</title><style>:root{{color-scheme:light dark;font-family:system-ui,sans-serif}}body{{margin:0;min-height:100vh;display:grid;place-items:center;background:light-dark(#f5f8fd,#151c27);color:light-dark(#26384f,#e7efff)}}main{{text-align:center;padding:40px 24px;max-width:420px}}img{{width:104px;height:104px;object-fit:contain}}.brand{{font-size:16px;font-weight:600;color:#548ce0;margin:12px 0 32px}}h1{{font-size:25px;letter-spacing:-.7px;margin:0 0 14px}}p{{font-size:14px;line-height:1.8;opacity:.75}}</style><main><img src="data:image/png;base64,{logo}" alt=""><div class="brand">Cirro</div><h1>{title}</h1><p>{message}</p>{button}</main></html>"#
    );
    let response = format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'none'; img-src data:; style-src 'unsafe-inline'; frame-ancestors 'none'\r\nConnection: close\r\n\r\n{html}", html.len());
    socket.write_all(response.as_bytes()).await?;
    socket.shutdown().await
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request(query: &str) -> String {
        format!("GET /oauth/google/callback?{query} HTTP/1.1\r\nHost: 127.0.0.1:4321\r\n\r\n")
    }
    #[test]
    fn accepts_only_bound_state_and_host() {
        assert_eq!(
            callback_code(&request("state=expected&code=abc"), 4321, "expected")
                .unwrap()
                .unwrap(),
            "abc"
        );
        assert!(callback_code(&request("state=wrong&code=abc"), 4321, "expected").is_none());
        assert!(callback_code(&request("state=expected&code=abc"), 1234, "expected").is_none());
        assert!(callback_code(
            &request("state=expected&state=expected&code=abc"),
            4321,
            "expected"
        )
        .is_none());
        assert!(callback_code(&request("code=abc"), 4321, "expected").is_none());
    }
    #[test]
    fn handles_denial_and_malformed_callbacks() {
        assert!(callback_code(
            &request("state=expected&error=access_denied"),
            4321,
            "expected"
        )
        .unwrap()
        .is_err());
        assert!(
            callback_code(&request("state=expected&code="), 4321, "expected")
                .unwrap()
                .is_err()
        );
        assert!(
            callback_code(&request("state=expected&code=a&code=b"), 4321, "expected")
                .unwrap()
                .is_err()
        );
        assert!(callback_code(
            &request("state=expected&code=a").replace("GET", "POST"),
            4321,
            "expected"
        )
        .is_none());
        assert!(callback_code(
            &request("state=expected&code=a").replace("/oauth/google/callback?", "/?"),
            4321,
            "expected"
        )
        .is_none());
    }
    #[test]
    fn restricts_profile_images() {
        assert!(trusted_picture(Some("https://lh3.googleusercontent.com/photo".into())).is_some());
        for url in [
            "http://lh3.googleusercontent.com/photo",
            "https://googleusercontent.com.evil.test/photo",
            "javascript:alert(1)",
        ] {
            assert!(trusted_picture(Some(url.into())).is_none());
        }
    }
    #[test]
    fn every_attempt_has_fresh_pkce_state_and_nonce() {
        let (challenge_a, verifier_a) = PkceCodeChallenge::new_random_sha256();
        let (challenge_b, verifier_b) = PkceCodeChallenge::new_random_sha256();
        assert_eq!(
            challenge_a.as_str(),
            PkceCodeChallenge::from_code_verifier_sha256(&verifier_a).as_str()
        );
        assert_eq!(challenge_a.method().as_str(), "S256");
        assert_ne!(challenge_a.as_str(), challenge_b.as_str());
        assert_ne!(verifier_a.secret(), verifier_b.secret());
        assert_ne!(
            CsrfToken::new_random().secret(),
            CsrfToken::new_random().secret()
        );
        assert_ne!(Nonce::new_random().secret(), Nonce::new_random().secret());
    }
    #[tokio::test]
    async fn loopback_ignores_invalid_callback_then_accepts_valid_callback() {
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = async {
            let (code, mut socket) = callback(&listener, port, "bound-state").await.unwrap();
            assert_eq!(code, "valid-code");
            browser_reply(&mut socket, "Sign-in complete", "Return to Cirro.")
                .await
                .unwrap();
        };
        let client = async {
            for (state, expected) in [
                ("wrong-state", "400 Bad Request"),
                ("bound-state", "200 OK"),
            ] {
                let mut socket = TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, port))
                    .await
                    .unwrap();
                socket.write_all(format!("GET /oauth/google/callback?state={state}&code=valid-code HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\r\n").as_bytes()).await.unwrap();
                let mut response = String::new();
                socket.read_to_string(&mut response).await.unwrap();
                assert!(response.contains(expected));
                assert!(!response.contains("valid-code"));
                if state == "bound-state" {
                    assert!(response.contains("Cache-Control: no-store"));
                }
            }
        };
        tokio::time::timeout(Duration::from_secs(5), async {
            tokio::join!(server, client);
        })
        .await
        .unwrap();
    }
}

tokio::task_local! {static ACCOUNT:String;}
pub async fn account_scope<F: std::future::Future>(id: String, future: F) -> F::Output {
    ACCOUNT.scope(id, future).await
}
fn registry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(STORE, "connected-accounts").map_err(|e| e.to_string())
}
fn profiles() -> Result<Vec<Profile>, String> {
    match registry()?.get_password() {
        Ok(value) => serde_json::from_str(&value).map_err(|e| e.to_string()),
        Err(keyring::Error::NoEntry) => Ok(vec![]),
        Err(e) => Err(e.to_string()),
    }
}
fn saved_account(id: &str) -> Result<SavedSession, String> {
    if !profiles()?.iter().any(|p| p.id == id) {
        return Err("Account is no longer connected.".into());
    }
    let entry = keyring::Entry::new(STORE, &format!("account-{id}")).map_err(|e| e.to_string())?;
    let saved: SavedSession =
        serde_json::from_str(&entry.get_password().map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    if saved.client_id != CLIENT_ID || saved.profile.id != id {
        return Err("Account credentials do not match.".into());
    }
    Ok(saved)
}
fn ensure_account_slot(list: &[Profile], id: &str) -> Result<(), String> {
    if list.len() >= 5 && !list.iter().any(|profile| profile.id == id) {
        return Err("Cirro supports up to 5 connected Google accounts. Disconnect an account before adding another.".into());
    }
    Ok(())
}
fn remember(saved: &SavedSession) -> Result<(), String> {
    let mut list = profiles()?;
    ensure_account_slot(&list, &saved.profile.id)?;
    list.retain(|p| p.id != saved.profile.id);
    list.push(saved.profile.clone());
    keyring::Entry::new(STORE, &format!("account-{}", saved.profile.id))
        .map_err(|e| e.to_string())?
        .set_password(&serde_json::to_string(saved).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    registry()?
        .set_password(&serde_json::to_string(&list).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn auth_accounts(window: Window) -> Result<Vec<Profile>, String> {
    main_window(&window)?;
    if let Ok(value) = credential()?.get_password() {
        if let Ok(saved) = serde_json::from_str::<SavedSession>(&value) {
            if saved.client_id == CLIENT_ID {
                remember(&saved)?;
            }
        }
    }
    profiles()
}
#[tauri::command]
pub async fn auth_activate(
    window: Window,
    state: State<'_, AuthState>,
    id: String,
) -> Result<Profile, String> {
    main_window(&window)?;
    let saved = saved_account(&id)?;
    let mut session = state.session.lock().await;
    credential()?
        .set_password(&serde_json::to_string(&saved).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    session.profile = Some(saved.profile.clone());
    session.checked = true;
    Ok(saved.profile)
}
#[tauri::command]
pub async fn auth_remove(
    window: Window,
    state: State<'_, AuthState>,
    id: String,
) -> Result<Option<Profile>, String> {
    main_window(&window)?;
    let mut list = profiles()?;
    list.retain(|p| p.id != id);
    registry()?
        .set_password(&serde_json::to_string(&list).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    let entry = keyring::Entry::new(STORE, &format!("account-{id}")).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => (),
        Err(e) => return Err(e.to_string()),
    };
    state.access.lock().await.remove(&id);
    let mut session = state.session.lock().await;
    if session.profile.as_ref().is_some_and(|p| p.id == id) {
        if let Some(next) = list.first() {
            let saved = saved_account(&next.id)?;
            credential()?
                .set_password(&serde_json::to_string(&saved).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
            session.profile = Some(next.clone());
        } else {
            clear_saved()?;
            session.profile = None;
        }
    }
    Ok(session.profile.clone())
}

pub(crate) fn flow_credentials(id: &str) -> Result<(String, String, String), String> {
    crate::security::require_unlocked()?;
    let saved = saved_account(id)?;
    Ok((CLIENT_ID.into(),CLIENT_SECRET.into(),serde_json::json!({"access_token":"refresh-required","refresh_token":saved.refresh_token,"token_type":"Bearer","expiry":"2000-01-01T00:00:00Z"}).to_string()))
}

#[cfg(test)]
mod account_limit_tests {
    use super::*;
    #[test]
    fn sixth_account_is_rejected_but_existing_accounts_can_reconnect() {
        let profiles = (0..5)
            .map(|id| Profile {
                id: id.to_string(),
                name: String::new(),
                email: String::new(),
                picture: None,
            })
            .collect::<Vec<_>>();
        assert!(ensure_account_slot(&profiles, "sixth").is_err());
        assert!(ensure_account_slot(&profiles, "2").is_ok());
        assert!(ensure_account_slot(&profiles[..4], "sixth").is_ok());
    }
}
