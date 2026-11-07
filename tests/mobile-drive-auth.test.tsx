import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const sdk=vi.hoisted(()=>({initialize:vi.fn(),login:vi.fn(),logout:vi.fn(),getAuthorizationCode:vi.fn(),verify:vi.fn()}));
vi.mock('@capacitor/core',()=>({Capacitor:{isNativePlatform:()=>true,getPlatform:()=> 'android'}}));
vi.mock('../src/platforms/android/auth/accountProfiles',()=>({silentAccountToken:async()=>null}));
vi.mock('@capgo/capacitor-social-login',()=>({SocialLogin:sdk}));
vi.mock('../src/platforms/android/auth/googleIdentity',()=>({verifyGoogleIdentity:sdk.verify}));
let api:typeof import('../src/platforms/android/auth/nativeGoogle');
beforeEach(async()=>{
  vi.resetModules();vi.clearAllMocks();vi.stubEnv('VITE_ANDROID_GOOGLE_WEB_CLIENT_ID','123-public.apps.googleusercontent.com');
  sdk.initialize.mockResolvedValue(undefined);sdk.logout.mockResolvedValue(undefined);sdk.getAuthorizationCode.mockRejectedValue(new Error('No session'));
  sdk.verify.mockImplementation(async(jwt:string)=>({id:jwt,name:jwt,email:jwt+'@example.com',picture:null}));
  api=await import('../src/platforms/android/auth/nativeGoogle');
});
afterEach(()=>vi.unstubAllEnvs());
it('binds each consent result to its verified account and never routes another account’s token',async()=>{
  sdk.login.mockResolvedValue({provider:'google',result:{responseType:'online',idToken:'wrong-account',accessToken:{token:'wrong-token'}}});
  await expect(api.driveAccessToken('expected-account',true)).rejects.toThrow('different Google account');
  expect(sdk.logout).toHaveBeenCalledOnce();
  await expect(api.driveAccessToken('expected-account')).rejects.toBeInstanceOf(api.DriveConsentRequired);
});
it('keeps different users’ tokens separate and clears them on sign-out',async()=>{
  sdk.login.mockResolvedValueOnce({result:{responseType:'online',idToken:'a',accessToken:{token:'a-token'}}}).mockResolvedValueOnce({result:{responseType:'online',idToken:'b',accessToken:{token:'b-token'}}});
  expect(await api.driveAccessToken('a',true)).toBe('a-token');expect(await api.driveAccessToken('b',true)).toBe('b-token');
  expect(await api.driveAccessToken('a')).toBe('a-token');expect(await api.driveAccessToken('b')).toBe('b-token');
  expect(sdk.login).toHaveBeenCalledTimes(2);
  expect(sdk.login.mock.calls[0][0].options.scopes).toContain('https://www.googleapis.com/auth/drive');
  expect(sdk.verify.mock.calls[0][2]).toBeTruthy();
  await api.signOutGoogle();await expect(api.driveAccessToken('a')).rejects.toBeInstanceOf(api.DriveConsentRequired);
});
it('does not open consent in the background or reuse another native account',async()=>{
  sdk.getAuthorizationCode.mockResolvedValue({jwt:'b',accessToken:'b-token'});
  await expect(api.driveAccessToken('a')).rejects.toBeInstanceOf(api.DriveConsentRequired);
  expect(sdk.login).not.toHaveBeenCalled();
});
