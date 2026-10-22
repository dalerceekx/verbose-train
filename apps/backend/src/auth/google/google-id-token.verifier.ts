import { Logger } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

const GOOGLE_JWKS_URL = new URL('https://www.googleapis.com/oauth2/v3/certs');
// Google issues ID tokens with either spelling.
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

/** The claims of a verified Google ID token that sign-in relies on. */
export interface GoogleIdentity {
  /** Stable Google account id. */
  sub: string;
  /** Lower-cased. */
  email: string;
  emailVerified: boolean;
  name: string | null;
}

/**
 * Verifies the ID token ("credential") returned by the Google Identity
 * Services button: RS256 signature against Google's published keys (cached,
 * refetched on an unknown `kid`), issuer, audience = our client ID, expiry.
 * Built in AuthModule; tests construct it with local keys.
 */
export class GoogleIdTokenVerifier {
  private readonly logger = new Logger(GoogleIdTokenVerifier.name);
  private readonly keys: JWTVerifyGetKey;

  constructor(
    /** Unset: Google sign-in is off. */
    readonly clientId: string | undefined,
    keys?: JWTVerifyGetKey,
  ) {
    this.keys =
      keys ?? createRemoteJWKSet(GOOGLE_JWKS_URL, { timeoutDuration: 5000 });
  }

  get enabled(): boolean {
    return Boolean(this.clientId);
  }

  /** Null for any invalid, expired or foreign token (never throws). */
  async verify(credential: string): Promise<GoogleIdentity | null> {
    if (!this.clientId) return null;
    try {
      const { payload } = await jwtVerify(credential, this.keys, {
        issuer: GOOGLE_ISSUERS,
        audience: this.clientId,
        algorithms: ['RS256'],
        clockTolerance: 30,
        requiredClaims: ['sub', 'email', 'exp', 'iat'],
      });
      const { sub, email } = payload;
      if (typeof sub !== 'string' || !sub || typeof email !== 'string') {
        return null;
      }
      return {
        sub,
        email: email.trim().toLowerCase(),
        // Google sends a boolean; very old tokens used the string "true".
        emailVerified:
          payload.email_verified === true || payload.email_verified === 'true',
        name: typeof payload.name === 'string' ? payload.name : null,
      };
    } catch (err) {
      // The token itself is a credential: log the failure class only.
      this.logger.warn(
        { error: err instanceof Error ? err.name : 'unknown' },
        'google id token rejected',
      );
      return null;
    }
  }
}
