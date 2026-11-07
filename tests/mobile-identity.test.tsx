import { beforeAll, expect, it } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { verifyGoogleIdentity } from '../src/platforms/android/auth/googleIdentity';

let pair: Awaited<ReturnType<typeof generateKeyPair>>;
let keys: ReturnType<typeof createLocalJWKSet>;
const audience = '123-test.apps.googleusercontent.com';
beforeAll(async () => {
  pair = await generateKeyPair('RS256');
  keys = createLocalJWKSet({ keys: [{ ...await exportJWK(pair.publicKey), kid: 'test', alg: 'RS256' }] });
});
async function token(extra: Record<string, unknown> = {}) {
  return new SignJWT({ email: 'test@example.com', email_verified: true, name: 'Test User', picture: 'https://lh3.googleusercontent.com/photo', nonce: 'nonce', ...extra })
    .setProtectedHeader({ alg: 'RS256', kid: 'test' }).setIssuer('https://accounts.google.com')
    .setAudience(audience).setSubject('google-id').setIssuedAt().setExpirationTime('1h').sign(pair.privateKey);
}
it('extracts a profile only from a verified, correctly bound Google token', async () => {
  expect(await verifyGoogleIdentity(await token(), audience, 'nonce', keys)).toEqual({ id: 'google-id', name: 'Test User', email: 'test@example.com', picture: 'https://lh3.googleusercontent.com/photo' });
});
it('rejects the wrong audience and a mismatched nonce', async () => {
  const jwt = await token();
  await expect(verifyGoogleIdentity(jwt, 'another-client', 'nonce', keys)).rejects.toThrow();
  await expect(verifyGoogleIdentity(jwt, audience, 'another-nonce', keys)).rejects.toThrow();
});
it('rejects unverified emails and uses initials instead of an unsafe photo URL', async () => {
  await expect(verifyGoogleIdentity(await token({ email_verified: false }), audience, 'nonce', keys)).rejects.toThrow();
  expect((await verifyGoogleIdentity(await token({ picture: 'https://googleusercontent.com.evil.example/photo' }), audience, 'nonce', keys)).picture).toBeNull();
});
it('rejects expired tokens and a token signed with another key', async () => {
  const expired = await new SignJWT({ email: 'test@example.com', email_verified: true }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setSubject('id').setIssuer('https://accounts.google.com').setAudience(audience).setIssuedAt(Math.floor(Date.now()/1000)-7200).setExpirationTime(Math.floor(Date.now()/1000)-3600).sign(pair.privateKey);
  await expect(verifyGoogleIdentity(expired, audience, undefined, keys)).rejects.toThrow();
  const wrong = await generateKeyPair('RS256');
  const wrongKeys = createLocalJWKSet({ keys: [{ ...await exportJWK(wrong.publicKey), kid: 'test', alg: 'RS256' }] });
  await expect(verifyGoogleIdentity(await token(), audience, 'nonce', wrongKeys)).rejects.toThrow();
});
