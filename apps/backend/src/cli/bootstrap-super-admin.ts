import { AuditAction } from '../audit/audit-actions.js';
import type { AuditService } from '../audit/audit.service.js';
import { maskEmail } from '../common/email.js';
import { isDemoPhone, maskPhone, normalizePhone } from '../common/phone.js';
import { sanitizeText } from '../common/strings.js';
import { UserRole, UserStatus } from '../generated/prisma/enums.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { randomToken } from '../security/crypto.js';
import type { PasswordService } from '../security/password.service.js';
import { passwordPolicyError } from '../users/password-policy.js';
import { lockSuperAdminChanges } from '../users/super-admin-lock.js';

/** A refusal whose message is safe to print as is. */
export class BootstrapError extends Error {
  override readonly name = 'BootstrapError';
}

export interface BootstrapTarget {
  phone: string | null;
  /** Google account email; the admin signs in with that account. */
  email: string | null;
  fullName: string;
}

export interface BootstrapInput extends BootstrapTarget {
  /** Required with a phone (phone + password login); null for Google-only. */
  password: string | null;
}

// Same shape as the users_email_normalized_chk constraint.
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Validates BOOTSTRAP_PHONE / BOOTSTRAP_EMAIL / BOOTSTRAP_FULL_NAME (before
 * asking for a password). At least one of phone and email is required.
 */
export function validateBootstrapTarget(
  rawPhone: string | undefined,
  rawFullName: string | undefined,
  rawEmail?: string | undefined,
): BootstrapTarget {
  const email = rawEmail?.trim().toLowerCase() || null;
  if (email && (email.length > 254 || !EMAIL_PATTERN.test(email))) {
    throw new BootstrapError('BOOTSTRAP_EMAIL noto‘g‘ri email manzili');
  }
  let phone: string | null = null;
  if (rawPhone || !email) {
    phone = normalizePhone(rawPhone);
    if (!phone || isDemoPhone(phone)) {
      throw new BootstrapError(
        'BOOTSTRAP_PHONE noto‘g‘ri: +998XXXXXXXXX formatida bo‘lishi kerak ' +
          '(yoki faqat BOOTSTRAP_EMAIL bering — Google orqali kirish uchun)',
      );
    }
  }
  const fullName = sanitizeText(rawFullName ?? '');
  if (fullName.length < 2 || fullName.length > 100) {
    throw new BootstrapError(
      'BOOTSTRAP_FULL_NAME 2–100 belgidan iborat bo‘lishi kerak',
    );
  }
  return { phone, email, fullName };
}

export function assertBootstrapPassword(password: string, phone: string): void {
  const error = passwordPolicyError(password, phone);
  if (error) throw new BootstrapError(error);
}

/**
 * Creates the first SUPER_ADMIN: ACTIVE, phone/email treated as verified,
 * MFA not enrolled yet (login forces TOTP setup). Refuses when a real
 * (non-demo) ACTIVE SUPER_ADMIN exists — later admins are created through
 * the API — or when the phone or email already belongs to any account.
 * Without a password (Google-only) nobody knows the stored secret.
 */
export async function bootstrapSuperAdmin(
  deps: {
    prisma: PrismaService;
    passwords: PasswordService;
    audit: AuditService;
  },
  input: BootstrapInput,
): Promise<{ id: string; contactMasked: string }> {
  const passwordHash = await deps.passwords.hash(
    input.password ?? randomToken(),
  );
  return deps.prisma.$transaction(async (tx) => {
    // Same lock as admin role changes: concurrent bootstraps (or a demotion
    // racing a bootstrap) are serialized before the count below.
    await lockSuperAdminChanges(tx);
    const existing = await tx.user.count({
      where: {
        role: UserRole.SUPER_ADMIN,
        status: UserStatus.ACTIVE,
        isDemo: false,
      },
    });
    if (existing > 0) {
      throw new BootstrapError(
        'Faol SUPER_ADMIN allaqachon mavjud. Yangi administratorlarni API orqali yarating.',
      );
    }
    if (
      input.phone &&
      (await tx.user.findUnique({
        where: { phone: input.phone },
        select: { id: true },
      }))
    ) {
      throw new BootstrapError(
        'Bu telefon raqami bilan foydalanuvchi allaqachon mavjud',
      );
    }
    if (
      input.email &&
      (await tx.user.findUnique({
        where: { email: input.email },
        select: { id: true },
      }))
    ) {
      throw new BootstrapError(
        'Bu email bilan foydalanuvchi allaqachon mavjud',
      );
    }

    const now = new Date();
    const user = await tx.user.create({
      data: {
        phone: input.phone,
        email: input.email,
        fullName: input.fullName,
        passwordHash,
        role: UserRole.SUPER_ADMIN,
        status: UserStatus.ACTIVE,
        phoneVerifiedAt: input.phone ? now : null,
        emailVerifiedAt: input.email ? now : null,
      },
      select: { id: true, phone: true, email: true, role: true },
    });
    const phoneMasked = user.phone ? maskPhone(user.phone) : null;
    const emailMasked = user.email ? maskEmail(user.email) : null;
    await deps.audit.record(
      {
        action: AuditAction.SYSTEM_SUPER_ADMIN_BOOTSTRAPPED,
        resourceType: 'user',
        resourceId: user.id,
        actorId: null,
        actorRole: null,
        newValue: { role: user.role, phoneMasked, emailMasked },
      },
      tx,
    );
    return {
      id: user.id,
      contactMasked: [phoneMasked, emailMasked].filter(Boolean).join(', '),
    };
  });
}
