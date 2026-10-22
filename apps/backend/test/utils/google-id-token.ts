import { randomUUID } from 'node:crypto';
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type CryptoKey,
  type JWTPayload,
} from 'jose';
import { GoogleIdTokenVerifier } from '../../src/auth/google/google-id-token.verifier.js';

export const TEST_GOOGLE_CLIENT_ID =
  '1234567890-meningfermam-test.apps.googleusercontent.com';

const KID = 'test-google-key';

export interface TestGoogleIssuer {
  /** Accepts tokens of this issuer only (local JWKS, no network). */
  verifier: GoogleIdTokenVerifier;
  /** A Google-shaped ID token; `claims` override the defaults. */
  sign(
    claims?: JWTPayload & Record<string, unknown>,
    options?: { key?: CryptoKey; alg?: string },
  ): Promise<string>;
}

/** Stands in for accounts.google.com: an RSA key pair and its JWKS. */
export async function testGoogleIssuer(
  clientId: string = TEST_GOOGLE_CLIENT_ID,
): Promise<TestGoogleIssuer> {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: KID, alg: 'RS256' };
  const keys = createLocalJWKSet({ keys: [jwk] });
  return {
    verifier: new GoogleIdTokenVerifier(clientId, keys),
    sign: (claims = {}, options = {}) => {
      const now = Math.floor(Date.now() / 1000);
      return new SignJWT({
        iss: 'https://accounts.google.com',
        aud: clientId,
        sub: `1${randomUUID().replace(/\D/g, '').slice(0, 20)}`,
        email: `fermer.${randomUUID().slice(0, 8)}@gmail.com`,
        email_verified: true,
        name: 'Google Fermer',
        iat: now,
        exp: now + 3600,
        ...claims,
      })
        .setProtectedHeader({ alg: options.alg ?? 'RS256', kid: KID })
        .sign(options.key ?? privateKey);
    },
  };
}
