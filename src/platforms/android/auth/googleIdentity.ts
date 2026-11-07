import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export type MobileUser = { id: string; name: string; email: string; picture: string | null };
const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'), { timeoutDuration: 10000 });

// This app currently has no remote application session or account-linking server.
// Verify Google's identity before using it locally. Any future backend must also
// verify the ID token itself, rather than trusting a profile sent by this client.
export async function verifyGoogleIdentity(token: string, clientId: string, nonce?: string, keys: JWTVerifyGetKey = googleKeys): Promise<MobileUser> {
  const { payload } = await jwtVerify(token, keys, {
    algorithms: ['RS256'], issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience: clientId, requiredClaims: ['sub', 'exp', 'iat', 'email'], maxTokenAge: '1h', clockTolerance: 30,
  });
  if (nonce && payload.nonce !== nonce) throw new Error('Google sign-in could not be verified. Please try again.');
  if (payload.email_verified !== true || typeof payload.email !== 'string' || !payload.sub) throw new Error('Google did not return a verified email address.');
  let picture: string | null = null;
  try { const url = new URL(String(payload.picture)); if (url.protocol === 'https:' && url.hostname.endsWith('.googleusercontent.com')) picture = url.href; } catch { /* Initials are used without a valid picture. */ }
  return { id: payload.sub, email: payload.email, name: typeof payload.name === 'string' && payload.name.trim() ? payload.name : payload.email, picture };
}
