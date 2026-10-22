import { isAxiosError } from 'axios';
import type { ApiErrorBody } from '@/shared/types/api';

/** Uzbek fallbacks for well-known backend error codes. */
const CODE_MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: 'Telefon yoki parol noto‘g‘ri',
  ACCOUNT_LOCKED: 'Juda ko‘p urinish. Keyinroq qayta urinib ko‘ring',
  ACCOUNT_BLOCKED: 'Akkaunt bloklangan. Administrator bilan bog‘laning',
  PHONE_NOT_VERIFIED: 'Telefon raqami tasdiqlanmagan',
  MFA_INVALID: 'Tasdiqlash kodi noto‘g‘ri',
  MFA_REQUIRED: 'Ikki bosqichli tasdiqlash talab qilinadi',
  OTP_INVALID: 'Kod noto‘g‘ri yoki muddati o‘tgan',
  CSRF_FAILED: 'Sessiyani yangilab bo‘lmadi. Qaytadan kiring',
  RATE_LIMITED: 'Juda ko‘p so‘rov. Biroz kutib, qayta urinib ko‘ring',
  INSUFFICIENT_STOCK: 'Omborda yetarli miqdor yo‘q',
  TAG_NUMBER_TAKEN: 'Bu raqamli hayvon fermada allaqachon bor',
  IDEMPOTENCY_KEY_REUSED: 'So‘rov takrorlandi. Sahifani yangilab, qayta urinib ko‘ring',
  SELF_ACTION_FORBIDDEN: 'Bu amalni o‘zingizga nisbatan bajarib bo‘lmaydi',
  LAST_SUPER_ADMIN: 'Oxirgi faol super adminni o‘zgartirib bo‘lmaydi',
  MEDICINE_IMMUTABLE: 'Tasdiqlangan dorini o‘zgartirib bo‘lmaydi',
  VALIDATION_FAILED: 'Kiritilgan ma’lumotlarni tekshiring',
  FORBIDDEN: 'Bu amal uchun ruxsatingiz yo‘q',
  UNAUTHORIZED: 'Sessiya tugagan. Qaytadan kiring',
  NOT_FOUND: 'Ma’lumot topilmadi',
  CONFLICT: 'Ma’lumotlar ziddiyati. Sahifani yangilang',
  RETRY: 'So‘rov parallel amal bilan to‘qnashdi, qayta urinib ko‘ring',
  IDEMPOTENCY_KEY_IN_PROGRESS: 'So‘rov hali bajarilmoqda. Biroz kutib, tarixni tekshiring',
  ISSUE_OVERLAP: 'Bu ratsion shu kunlar uchun allaqachon berilgan. Qo‘shimcha berish uchun alohida tasdiqlang',
  DUPLICATE_ITEM: 'Bu nomli yem allaqachon bor',
  RATION_ITEM_ARCHIVED: 'Ratsiondagi yem arxivlangan — ratsionni tahrirlang',
  INTERNAL_ERROR: 'Tizimda xatolik yuz berdi. Keyinroq urinib ko‘ring',
};

export const NETWORK_ERROR_MESSAGE = 'Aloqa yo‘q. Internetni tekshirib, qayta urinib ko‘ring';
export const OFFLINE_MESSAGE = 'Internet yo‘q. Aloqa tiklangach qayta urinib ko‘ring';
export const TIMEOUT_MESSAGE = 'Javob kelmadi (kutish vaqti tugadi). Internetni tekshirib, qayta urinib ko‘ring';
const UNKNOWN_ERROR_MESSAGE = 'Kutilmagan xatolik yuz berdi';

/** Gateway answers: the request may have reached the application before the proxy gave up. */
const GATEWAY_STATUSES = new Set([502, 503, 504]);

/**
 * Normalized API failure. Everything the UI shows about an error goes
 * through this class — raw Axios errors never reach components.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** Validation messages (backend sends a string[] for VALIDATION_FAILED). */
  readonly messages: readonly string[];
  readonly requestId: string | undefined;
  readonly details: Record<string, unknown> | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(init: {
    status: number;
    code: string;
    message: string;
    messages?: readonly string[];
    requestId?: string | undefined;
    details?: Record<string, unknown> | undefined;
    retryAfterSeconds?: number | undefined;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.messages = init.messages ?? [];
    this.requestId = init.requestId;
    this.details = init.details;
    this.retryAfterSeconds = init.retryAfterSeconds;
  }

  /** No HTTP answer at all: offline, connection lost or timed out. */
  get isNetworkError(): boolean {
    return this.status === 0;
  }

  /** The device knew it was offline: the request never left it. */
  get isOffline(): boolean {
    return this.code === 'OFFLINE';
  }

  get isTimeout(): boolean {
    return this.code === 'TIMEOUT';
  }

  get isServerError(): boolean {
    return this.status >= 500;
  }

  /**
   * The answer was lost on the way back (or a gateway gave up): a write may
   * have been applied by the server even though the browser saw a failure.
   */
  get outcomeUnknown(): boolean {
    return (this.isNetworkError && !this.isOffline) || GATEWAY_STATUSES.has(this.status);
  }
}

function deviceOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null) return false;
  const body = value as Partial<ApiErrorBody>;
  return typeof body.code === 'string' && (typeof body.message === 'string' || Array.isArray(body.message));
}

function parseRetryAfter(header: unknown, details: Record<string, unknown> | undefined): number | undefined {
  const fromDetails = details?.retryAfterSeconds;
  if (typeof fromDetails === 'number' && fromDetails > 0) return fromDetails;
  const seconds = typeof header === 'string' ? Number.parseInt(header, 10) : Number.NaN;
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

/** Converts anything thrown by the HTTP layer into an ApiError. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (isAxiosError(error)) {
    const response = error.response;
    if (!response) {
      if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
        return new ApiError({ status: 0, code: 'TIMEOUT', message: TIMEOUT_MESSAGE });
      }
      if (deviceOffline()) return new ApiError({ status: 0, code: 'OFFLINE', message: OFFLINE_MESSAGE });
      return new ApiError({ status: 0, code: 'NETWORK_ERROR', message: NETWORK_ERROR_MESSAGE });
    }
    const body: unknown = response.data;
    const headers = response.headers as Record<string, unknown>;
    if (isErrorBody(body)) {
      const messages = Array.isArray(body.message) ? body.message : [body.message];
      const knownMessage = CODE_MESSAGES[body.code];
      // Validation details are developer-oriented; show a plain Uzbek summary.
      const message =
        Array.isArray(body.message) || body.code === 'VALIDATION_FAILED'
          ? (knownMessage ?? UNKNOWN_ERROR_MESSAGE)
          : body.message || knownMessage || UNKNOWN_ERROR_MESSAGE;
      return new ApiError({
        status: response.status,
        code: body.code,
        message,
        messages,
        requestId: body.requestId,
        details: body.details,
        retryAfterSeconds: parseRetryAfter(headers['retry-after'], body.details),
      });
    }
    const code = response.status >= 500 ? 'INTERNAL_ERROR' : `HTTP_${response.status}`;
    return new ApiError({
      status: response.status,
      code,
      message: CODE_MESSAGES[code] ?? UNKNOWN_ERROR_MESSAGE,
      retryAfterSeconds: parseRetryAfter(headers['retry-after'], undefined),
    });
  }
  return new ApiError({ status: -1, code: 'CLIENT_ERROR', message: UNKNOWN_ERROR_MESSAGE });
}

/** User-facing message for any error (with a wait hint for rate limits). */
export function errorMessage(error: unknown): string {
  const apiError = toApiError(error);
  if (apiError.status === 429 && apiError.retryAfterSeconds) {
    return `${apiError.message} (${apiError.retryAfterSeconds} soniyadan keyin)`;
  }
  return apiError.message;
}

/**
 * Message for a failed save. When the answer was lost the record may already
 * exist on the server, so the farmer is told to check instead of "not saved";
 * offline nothing left the device.
 */
export function saveErrorMessage(error: unknown, subject = 'Yozuv'): string {
  const apiError = toApiError(error);
  if (apiError.outcomeUnknown) {
    return `Javob kelmadi. ${subject} saqlangan bo‘lishi mumkin — shu oynada qayta urining yoki tarixni tekshiring.`;
  }
  if (apiError.isOffline) return `Internet yo‘q — ${subject.toLocaleLowerCase('uz')} saqlanmadi. Aloqa tiklangach qayta urining.`;
  return errorMessage(error);
}

/**
 * Maps class-validator messages ("weightKg must be …") to form fields. The
 * backend message starts with the DTO property name.
 */
export function validationFieldErrors<TField extends string>(
  error: unknown,
  fields: readonly TField[],
): Partial<Record<TField, string>> {
  const apiError = toApiError(error);
  if (apiError.code !== 'VALIDATION_FAILED') return {};
  const result: Partial<Record<TField, string>> = {};
  for (const message of apiError.messages) {
    const field = fields.find((name) => message === name || message.startsWith(`${name} `));
    if (field && !result[field]) result[field] = 'Qiymat noto‘g‘ri yoki talablarga mos emas';
  }
  return result;
}
