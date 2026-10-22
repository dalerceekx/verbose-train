import { AuditAction } from '../../src/audit/audit-actions.js';
import { GoogleIdTokenVerifier } from '../../src/auth/google/google-id-token.verifier.js';
import { UserRole, UserStatus } from '../../src/generated/prisma/enums.js';
import { createTestApp, type TestApp } from '../utils/app.js';
import { createUser, uniquePhone } from '../utils/factories.js';
import {
  TEST_GOOGLE_CLIENT_ID,
  testGoogleIssuer,
  type TestGoogleIssuer,
} from '../utils/google-id-token.js';
import { uniqueIp } from '../utils/ips.js';
import {
  AUTH,
  REFRESH_COOKIE,
  setCookies,
  STRONG_PASSWORD,
} from './helpers.js';

let counter = 0;
const uniqueGoogle = () => {
  counter += 1;
  return {
    sub: `10${Date.now()}${counter}`,
    email: `fermer.${Date.now()}.${counter}@gmail.com`,
  };
};

describe('Auth: Google sign-in (SMS off)', () => {
  let testApp: TestApp;
  let google: TestGoogleIssuer;

  const googleLogin = (credential: string) =>
    testApp
      .http()
      .post(`${AUTH}/google`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ credential });

  /** A phone account (as an admin creates it) that also carries `email`. */
  async function accountWithEmail(
    email: string,
    options: { role?: UserRole; status?: UserStatus } = {},
  ) {
    const { user } = await createUser(testApp.prisma, options);
    await testApp.prisma.user.update({
      where: { id: user.id },
      data: { email, emailVerifiedAt: new Date() },
    });
    return user;
  }

  beforeAll(async () => {
    google = await testGoogleIssuer();
    testApp = await createTestApp({
      features: ['auth'],
      env: { GOOGLE_CLIENT_ID: TEST_GOOGLE_CLIENT_ID, SMS_ENABLED: 'false' },
      configure: (builder) =>
        builder
          .overrideProvider(GoogleIdTokenVerifier)
          .useValue(google.verifier),
    });
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('GET /methods offers Google (with the public client ID) and no SMS', async () => {
    const res = await testApp.http().get(`${AUTH}/methods`).expect(200);
    expect(res.body).toEqual({
      google: { clientId: TEST_GOOGLE_CLIENT_ID },
      sms: false,
    });
  });

  it('first sign-in creates an ACTIVE farmer without a phone; later ones reuse it', async () => {
    const { sub, email } = uniqueGoogle();
    const first = await googleLogin(
      await google.sign({ sub, email, name: '  Yangi Fermer ' }),
    ).expect(200);

    expect(first.body).toMatchObject({
      status: 'AUTHENTICATED',
      accessToken: expect.any(String),
      user: {
        email,
        phone: null,
        role: UserRole.FARMER,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: expect.any(String),
      },
    });
    expect(first.body.user).not.toHaveProperty('googleSub');
    expect(first.body.user).not.toHaveProperty('passwordHash');
    expect(setCookies(first).map((cookie) => cookie.name)).toContain(
      REFRESH_COOKIE,
    );
    await testApp
      .http()
      .get(`${AUTH}/me`)
      .set('Authorization', `Bearer ${first.body.accessToken as string}`)
      .expect(200);

    const row = await testApp.prisma.user.findUniqueOrThrow({
      where: { email },
    });
    expect(row).toMatchObject({
      googleSub: sub,
      phone: null,
      isDemo: false,
      fullName: 'Yangi Fermer',
    });
    const audit = await testApp.prisma.auditLog.findFirst({
      where: { action: AuditAction.AUTH_REGISTER, resourceId: row.id },
    });
    expect(audit?.newValue).toMatchObject({ method: 'google' });
    expect(JSON.stringify(audit?.newValue)).not.toContain(email);

    // Matched by the Google account id, even when its address changed.
    const again = await googleLogin(
      await google.sign({ sub, email: `boshqa.${email}` }),
    ).expect(200);
    expect(again.body.user.id).toBe(row.id);
  });

  it('links an account an admin created for that email, keeping its role', async () => {
    const { sub, email } = uniqueGoogle();
    const user = await accountWithEmail(email, { role: UserRole.VET });

    const res = await googleLogin(
      await google.sign({ sub, email: email.toUpperCase() }),
    ).expect(200);

    expect(res.body.user).toMatchObject({ id: user.id, role: UserRole.VET });
    const row = await testApp.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(row.googleSub).toBe(sub);
    expect(
      await testApp.prisma.auditLog.count({
        where: { action: AuditAction.AUTH_GOOGLE_LINKED, resourceId: user.id },
      }),
    ).toBe(1);
  });

  it('refuses an email already linked to another Google account', async () => {
    const { sub, email } = uniqueGoogle();
    await accountWithEmail(email);
    await googleLogin(await google.sign({ sub, email })).expect(200);

    const res = await googleLogin(
      await google.sign({ sub: `${sub}9`, email }),
    ).expect(401);
    expect(res.body.code).toBe('GOOGLE_ACCOUNT_MISMATCH');
  });

  it('admin roles still pass TOTP after Google (no session yet)', async () => {
    const { sub, email } = uniqueGoogle();
    await accountWithEmail(email, { role: UserRole.SUPER_ADMIN });

    const res = await googleLogin(await google.sign({ sub, email })).expect(
      200,
    );

    expect(res.body).toMatchObject({
      status: 'MFA_SETUP_REQUIRED',
      mfaToken: expect.any(String),
    });
    expect(res.body).not.toHaveProperty('accessToken');
    expect(setCookies(res)).toEqual([]);
  });

  it.each([
    [UserStatus.BLOCKED, 403, 'ACCOUNT_BLOCKED'],
    [UserStatus.ARCHIVED, 401, 'GOOGLE_TOKEN_INVALID'],
  ])('%s account → %i %s', async (status, httpStatus, code) => {
    const { sub, email } = uniqueGoogle();
    await accountWithEmail(email, { status });

    const res = await googleLogin(await google.sign({ sub, email })).expect(
      httpStatus,
    );
    expect(res.body.code).toBe(code);
  });

  it('rejects an unverified Google email without creating an account', async () => {
    const { sub, email } = uniqueGoogle();
    const res = await googleLogin(
      await google.sign({ sub, email, email_verified: false }),
    ).expect(401);
    expect(res.body.code).toBe('GOOGLE_EMAIL_UNVERIFIED');
    expect(
      await testApp.prisma.user.findUnique({ where: { email } }),
    ).toBeNull();
  });

  it('rejects foreign or malformed tokens', async () => {
    const other = await testGoogleIssuer('other.apps.googleusercontent.com');
    const foreign = await googleLogin(await other.sign()).expect(401);
    expect(foreign.body.code).toBe('GOOGLE_TOKEN_INVALID');

    await googleLogin('not-a-jwt').expect(400);
    await testApp
      .http()
      .post(`${AUTH}/google`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ credential: await google.sign(), role: 'SUPER_ADMIN' })
      .expect(400);
  });

  it.each([
    [
      '/register',
      async () => ({
        phone: await uniquePhone(),
        fullName: 'Ism Familiya',
        password: STRONG_PASSWORD,
      }),
    ],
    [
      '/otp/send',
      async () => ({
        phone: await uniquePhone(),
        fullName: 'Ism Familiya',
        password: STRONG_PASSWORD,
      }),
    ],
    ['/password/forgot', async () => ({ phone: await uniquePhone() })],
  ])('SMS flow %s answers 403 SMS_DISABLED', async (path, body) => {
    const res = await testApp
      .http()
      .post(`${AUTH}${path}`)
      .set('X-Forwarded-For', uniqueIp())
      .send(await body())
      .expect(403);
    expect(res.body.code).toBe('SMS_DISABLED');
  });
});

describe('Auth: Google sign-in while unconfigured', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp({ features: ['auth'] });
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('hides Google and answers 404', async () => {
    const methods = await testApp.http().get(`${AUTH}/methods`).expect(200);
    expect(methods.body).toEqual({ google: null, sms: true });

    const issuer = await testGoogleIssuer();
    await testApp
      .http()
      .post(`${AUTH}/google`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ credential: await issuer.sign() })
      .expect(404);
  });
});
