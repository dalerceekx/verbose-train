import { generateKeyPair } from 'jose';
import {
  TEST_GOOGLE_CLIENT_ID,
  testGoogleIssuer,
  type TestGoogleIssuer,
} from '../../../test/utils/google-id-token.js';
import { GoogleIdTokenVerifier } from './google-id-token.verifier.js';

describe('GoogleIdTokenVerifier', () => {
  let google: TestGoogleIssuer;

  beforeAll(async () => {
    google = await testGoogleIssuer();
  });

  it('accepts a Google ID token for our client and normalizes the email', async () => {
    const token = await google.sign({
      sub: '109876543210',
      email: ' Fermer.Bir@Gmail.com ',
      name: 'Fermer Bir',
    });
    await expect(google.verifier.verify(token)).resolves.toEqual({
      sub: '109876543210',
      email: 'fermer.bir@gmail.com',
      emailVerified: true,
      name: 'Fermer Bir',
    });
  });

  it('accepts the issuer spelled without https://', async () => {
    const token = await google.sign({ iss: 'accounts.google.com' });
    await expect(google.verifier.verify(token)).resolves.not.toBeNull();
  });

  it('reports an unverified email instead of trusting it', async () => {
    const token = await google.sign({ email_verified: false });
    expect((await google.verifier.verify(token))?.emailVerified).toBe(false);
  });

  it.each([
    ['another client (audience)', { aud: 'other.apps.googleusercontent.com' }],
    ['another issuer', { iss: 'https://evil.example.com' }],
    ['an expired token', { exp: Math.floor(Date.now() / 1000) - 3600 }],
    ['a token without email', { email: undefined }],
    ['a token without sub', { sub: undefined }],
  ])('rejects %s', async (_name, claims) => {
    const token = await google.sign(claims);
    await expect(google.verifier.verify(token)).resolves.toBeNull();
  });

  it('rejects a token signed with a key Google does not publish', async () => {
    const { privateKey } = await generateKeyPair('RS256');
    const token = await google.sign({}, { key: privateKey });
    await expect(google.verifier.verify(token)).resolves.toBeNull();
  });

  it('rejects other algorithms and garbage', async () => {
    const { privateKey } = await generateKeyPair('PS256');
    const ps256 = await google.sign({}, { key: privateKey, alg: 'PS256' });
    await expect(google.verifier.verify(ps256)).resolves.toBeNull();
    await expect(google.verifier.verify('not-a-jwt')).resolves.toBeNull();
  });

  it('is off without a client ID', async () => {
    const off = new GoogleIdTokenVerifier(undefined);
    expect(off.enabled).toBe(false);
    expect(google.verifier.enabled).toBe(true);
    expect(google.verifier.clientId).toBe(TEST_GOOGLE_CLIENT_ID);
    await expect(off.verify(await google.sign())).resolves.toBeNull();
  });
});
