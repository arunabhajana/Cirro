import { Capacitor } from '@capacitor/core';
import { SocialLogin } from '@capgo/capacitor-social-login';
import { verifyGoogleIdentity, type MobileUser } from './googleIdentity';
import { silentAccountToken } from './accountProfiles';

const clientId = (import.meta.env.VITE_ANDROID_GOOGLE_WEB_CLIENT_ID || '').trim();
export const nativeAndroid = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
export const googleConfigured = /^\d+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId);
let initialization: Promise<void> | undefined;
let sdkQueue:Promise<unknown>=Promise.resolve();
function sdk<T>(operation:()=>Promise<T>):Promise<T>{const next=sdkQueue.catch(()=>{}).then(operation);sdkQueue=next.catch(()=>{});return next;}
const driveTokens = new Map<string, { token: string; until: number }>();
export class DriveConsentRequired extends Error {}
export function forgetDriveToken(accountId: string) { driveTokens.delete(accountId); }
async function initialize() {
  if (!nativeAndroid) throw new Error('Google sign-in is available in the Android APK. The browser is a UI preview.');
  if (!googleConfigured) throw new Error('Google sign-in needs the Web OAuth client ID. Set VITE_ANDROID_GOOGLE_WEB_CLIENT_ID and rebuild the APK.');
  initialization ??= SocialLogin.initialize({ google: { webClientId: clientId, mode: 'online', skipAuthOnlyAuthorizationAfterSignIn: true } }).catch(reason => { initialization = undefined; throw reason; });
  await initialization;
}

async function signInGoogleNative(): Promise<MobileUser> {
  await initialize();
  const nonce = crypto.randomUUID();
  const response = await SocialLogin.login({ provider: 'google', options: { scopes: ['openid', 'email', 'profile'], nonce, style: 'standard' } });
  if (response.result.responseType !== 'online' || !response.result.idToken) throw new Error('Google did not return an identity token. Please try again.');
  try { return await verifyGoogleIdentity(response.result.idToken, clientId, nonce); }
  catch { await SocialLogin.logout({ provider: 'google' }).catch(() => {}); throw new Error('Unable to verify your Google account. Check your connection and try again.'); }
}

async function restoreGoogleNative(): Promise<MobileUser | null> {
  if (!nativeAndroid || !googleConfigured) return null;
  await initialize();
  try {
    // No interactive picker during startup. Expired sessions return to sign-in.
    const saved = await SocialLogin.getAuthorizationCode({ provider: 'google' });
    if (!('jwt' in saved) || typeof saved.jwt !== 'string') return null;
    return await verifyGoogleIdentity(saved.jwt, clientId);
  } catch { return null; }
}

async function signOutGoogleNative() {
  await initialize();
  await SocialLogin.logout({ provider: 'google' });
  driveTokens.clear();
}

// Tokens are scoped by Google's verified subject, never by the selected UI tab.
// Background sync may reuse a native credential but never opens a consent UI.
async function driveAccessTokenNative(accountId: string, interactive = false): Promise<string> {
  await initialize();
  const cached = driveTokens.get(accountId);
  if (!interactive && cached && cached.until > Date.now()) return cached.token;
  if (interactive) {
    const nonce = crypto.randomUUID();
    const response = await SocialLogin.login({ provider: 'google', options: { scopes: ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/drive'], nonce, style: 'standard' } });
    if (response.result.responseType !== 'online' || !response.result.idToken) throw new Error('Google did not return an identity token.');
    let profile: MobileUser;
    try { profile = await verifyGoogleIdentity(response.result.idToken, clientId, nonce); }
    catch { await SocialLogin.logout({ provider: 'google' }).catch(() => {}); throw new Error('Unable to verify Drive authorization. Please try again.'); }
    if (profile.id !== accountId) {
      await SocialLogin.logout({ provider: 'google' }).catch(() => {});
      throw new Error('A different Google account was selected. Connect Drive again and choose the account shown in Cirro.');
    }
    const token = response.result.accessToken?.token;
    if (!token) throw new DriveConsentRequired('Google did not grant Drive access. Try Connect Drive again.');
    driveTokens.set(accountId, { token, until: Date.now() + 45 * 60 * 1000 });
    return token;
  }
  try {
    const renewed=await silentAccountToken(accountId).catch(()=>null);
    if(renewed){driveTokens.set(accountId,{token:renewed,until:Date.now()+45*60*1000});return renewed;}
    const saved = await SocialLogin.getAuthorizationCode({ provider: 'google' });
    if ('jwt' in saved && typeof saved.jwt === 'string' && 'accessToken' in saved && typeof saved.accessToken === 'string') {
      const profile = await verifyGoogleIdentity(saved.jwt, clientId);
      if (profile.id === accountId && saved.accessToken) {
        driveTokens.set(accountId, { token: saved.accessToken, until: Date.now() + 45 * 60 * 1000 });
        return saved.accessToken;
      }
    }
  } catch { /* Missing or expired native grants need explicit consent. */ }
  throw new DriveConsentRequired('Connect Drive for this account to sync its files.');
}

export function authError(reason: unknown): string {
  const code = typeof reason === 'object' && reason ? String((reason as { code?: unknown }).code || '') : '';
  const message = reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : '';
  if (/cancel|dismiss|12501/i.test(code + message)) return 'Sign-in cancelled. You can try again.';
  if (/developer|DEVELOPER_ERROR|\b10\b|28444/i.test(code + message)) return 'Google configuration does not match this APK. Check the package, signing SHA-1 and Web OAuth client ID.';
  return message || 'Google sign-in failed. Check your connection and try again.';
}

export const signInGoogle=()=>sdk(signInGoogleNative);
export const restoreGoogle=()=>sdk(restoreGoogleNative);
export const signOutGoogle=()=>sdk(signOutGoogleNative);
export const driveAccessToken=(account:string,interactive=false)=>sdk(()=>driveAccessTokenNative(account,interactive));
