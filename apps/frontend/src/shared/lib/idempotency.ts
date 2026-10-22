/**
 * Idempotency-Key for one user submission (backend accepts
 * /^[A-Za-z0-9_-]{8,128}$/). Generate it once per submit attempt and reuse
 * it for any retry of that same attempt, so the server applies it once.
 */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

const STORAGE_PREFIX = 'mf-pending-key:v1:';
/**
 * How long the key of an attempt whose answer was lost is kept — far inside
 * the server's replay window (24 h by default), so a retry is replayed, never
 * applied a second time.
 */
export const PENDING_KEY_TTL_MS = 10 * 60_000;

interface StoredKey {
  key: string;
  createdAt: number;
}

function read(scope: string): StoredKey | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + scope);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredKey>;
    return typeof parsed.key === 'string' && typeof parsed.createdAt === 'number'
      ? { key: parsed.key, createdAt: parsed.createdAt }
      : null;
  } catch {
    return null;
  }
}

/**
 * The key of an earlier attempt of `scope` (e.g. one ration's issue) whose
 * answer never arrived, while it is still fresh. Reopening the dialog — or
 * the page — then retries with the same key and the server replays the
 * first result instead of writing the stock movement twice.
 */
export function recoverIdempotencyKey(scope: string, now = Date.now()): string | null {
  const stored = read(scope);
  if (!stored) return null;
  if (now - stored.createdAt > PENDING_KEY_TTL_MS) {
    forgetIdempotencyKey(scope);
    return null;
  }
  return stored.key;
}

/** Keeps `key` until the outcome of its request is known (called right before sending). */
export function rememberIdempotencyKey(scope: string, key: string, now = Date.now()): void {
  const stored = read(scope);
  try {
    // A retry keeps the time of the first attempt: the window never slides.
    const createdAt = stored?.key === key ? stored.createdAt : now;
    window.localStorage.setItem(STORAGE_PREFIX + scope, JSON.stringify({ key, createdAt } satisfies StoredKey));
  } catch {
    // Storage unavailable: retries in the same dialog still reuse the key.
  }
}

/** The outcome is known (saved, or refused by the server): the key is no longer needed. */
export function forgetIdempotencyKey(scope: string): void {
  try {
    window.localStorage.removeItem(STORAGE_PREFIX + scope);
  } catch {
    // ignore
  }
}
