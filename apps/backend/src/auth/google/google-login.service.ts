import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditAction } from '../../audit/audit-actions.js';
import { AuditService } from '../../audit/audit.service.js';
import { maskEmail } from '../../common/email.js';
import { Errors } from '../../common/errors/app.exception.js';
import { sanitizeText, truncate } from '../../common/strings.js';
import type { Env } from '../../config/env.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { UserRole, UserStatus } from '../../generated/prisma/enums.js';
import {
  isUniqueViolation,
  PrismaService,
} from '../../prisma/prisma.service.js';
import { randomToken } from '../../security/crypto.js';
import { PasswordService } from '../../security/password.service.js';
import { RateLimitService } from '../../security/rate-limit.service.js';
import type { SessionMeta } from '../../security/sessions/session.service.js';
import { AuthMessages, enforceIpLimit, IpLimits } from '../auth.constants.js';
import { LoginService, type LoginOutcome } from '../login.service.js';
import {
  GoogleIdTokenVerifier,
  type GoogleIdentity,
} from './google-id-token.verifier.js';

const ACCOUNT_SELECT = {
  id: true,
  role: true,
  status: true,
  isDemo: true,
  mfaEnabled: true,
} as const satisfies Prisma.UserSelect;

type Account = Prisma.UserGetPayload<{ select: typeof ACCOUNT_SELECT }>;

const FULL_NAME_MIN = 2;
const FULL_NAME_MAX = 100;

const googleInvalid = () =>
  Errors.unauthorized(AuthMessages.googleInvalid, 'GOOGLE_TOKEN_INVALID');

/**
 * "Sign in with Google": the verified ID token replaces phone + password as
 * the first factor. Accounts are matched by Google account id, then by the
 * verified email (an account an admin created for that address is linked on
 * its first Google sign-in); an unknown address gets a new FARMER account.
 * Admin roles still pass TOTP afterwards (LoginService.startSession).
 */
@Injectable()
export class GoogleLoginService {
  private readonly demoEnabled: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly rateLimit: RateLimitService,
    private readonly audit: AuditService,
    private readonly verifier: GoogleIdTokenVerifier,
    private readonly loginService: LoginService,
    config: ConfigService<Env, true>,
  ) {
    this.demoEnabled = config.get('DEMO_ACCOUNTS_ENABLED', { infer: true });
  }

  /** The public OAuth client ID the browser needs, or null while off. */
  get clientId(): string | null {
    return this.verifier.clientId ?? null;
  }

  async login(credential: string, meta: SessionMeta): Promise<LoginOutcome> {
    if (!this.verifier.enabled) {
      throw Errors.notFound(AuthMessages.googleDisabled);
    }
    await enforceIpLimit(this.rateLimit, IpLimits.google, meta.ip);

    const identity = await this.verifier.verify(credential);
    if (!identity) throw googleInvalid();
    if (!identity.emailVerified) {
      throw Errors.unauthorized(
        AuthMessages.googleEmailUnverified,
        'GOOGLE_EMAIL_UNVERIFIED',
      );
    }

    const account = await this.resolveAccount(identity);
    if (
      account.status === UserStatus.ARCHIVED ||
      account.status === UserStatus.PENDING_VERIFICATION ||
      (account.isDemo && !this.demoEnabled)
    ) {
      throw googleInvalid();
    }
    if (account.status === UserStatus.BLOCKED) {
      throw Errors.forbidden(AuthMessages.accountBlocked, 'ACCOUNT_BLOCKED');
    }
    return this.loginService.startSession(account, meta);
  }

  private async resolveAccount(identity: GoogleIdentity): Promise<Account> {
    const linked = await this.prisma.user.findUnique({
      where: { googleSub: identity.sub },
      select: ACCOUNT_SELECT,
    });
    if (linked) return linked;

    const byEmail = await this.prisma.user.findUnique({
      where: { email: identity.email },
      select: { ...ACCOUNT_SELECT, googleSub: true },
    });
    if (byEmail) return this.link(byEmail, identity);

    // Hashed outside the transaction. Nobody knows this password: a
    // Google-only account cannot be used with password login.
    const passwordHash = await this.passwords.hash(randomToken());
    try {
      return await this.create(identity, passwordHash);
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // A parallel first sign-in of the same Google account created it.
      const created = await this.prisma.user.findUnique({
        where: { googleSub: identity.sub },
        select: ACCOUNT_SELECT,
      });
      if (!created) throw googleInvalid();
      return created;
    }
  }

  private async link(
    account: Account & { googleSub: string | null },
    identity: GoogleIdentity,
  ): Promise<Account> {
    // The address is already tied to another Google account (e.g. the
    // original one was deleted and the address re-registered).
    if (account.googleSub && account.googleSub !== identity.sub) {
      throw Errors.unauthorized(
        AuthMessages.googleAccountMismatch,
        'GOOGLE_ACCOUNT_MISMATCH',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.user.updateMany({
        where: { id: account.id, googleSub: null },
        data: { googleSub: identity.sub, emailVerifiedAt: new Date() },
      });
      // A parallel sign-in of the same Google account linked it first.
      if (count !== 1) return;
      await this.audit.record(
        {
          action: AuditAction.AUTH_GOOGLE_LINKED,
          resourceType: 'user',
          resourceId: account.id,
          actorId: account.id,
          actorRole: account.role,
          newValue: { emailMasked: maskEmail(identity.email) },
        },
        tx,
      );
    });
    const { googleSub: _linkedSub, ...rest } = account;
    return rest;
  }

  private create(identity: GoogleIdentity, passwordHash: string) {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        // role/status are fixed here; nothing from the client decides them.
        data: {
          email: identity.email,
          emailVerifiedAt: new Date(),
          googleSub: identity.sub,
          fullName: displayName(identity),
          passwordHash,
          role: UserRole.FARMER,
          status: UserStatus.ACTIVE,
        },
        select: ACCOUNT_SELECT,
      });
      await this.audit.record(
        {
          action: AuditAction.AUTH_REGISTER,
          resourceType: 'user',
          resourceId: user.id,
          actorId: null,
          actorRole: null,
          newValue: {
            method: 'google',
            emailMasked: maskEmail(identity.email),
            status: user.status,
          },
        },
        tx,
      );
      return user;
    });
  }
}

/** Google profile name, or the address' local part when it is unusable. */
function displayName(identity: GoogleIdentity): string {
  const name = truncate(sanitizeText(identity.name ?? ''), FULL_NAME_MAX);
  if (name.length >= FULL_NAME_MIN) return name;
  const local = identity.email.slice(0, identity.email.indexOf('@'));
  return truncate(local.padEnd(FULL_NAME_MIN, '_'), FULL_NAME_MAX);
}
