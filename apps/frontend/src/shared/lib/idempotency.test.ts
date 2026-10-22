import { afterEach, describe, expect, it } from 'vitest';
import {
  forgetIdempotencyKey,
  newIdempotencyKey,
  PENDING_KEY_TTL_MS,
  recoverIdempotencyKey,
  rememberIdempotencyKey,
} from './idempotency';

afterEach(() => window.localStorage.clear());

describe('Idempotency-Key of an attempt whose answer was lost', () => {
  it('matches the backend format', () => {
    expect(newIdempotencyKey()).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
    expect(newIdempotencyKey()).not.toBe(newIdempotencyKey());
  });

  it('is recovered after a reload, so the retry is replayed instead of applied twice', () => {
    rememberIdempotencyKey('ration-issue:r1', 'key-1', 1_000);
    expect(recoverIdempotencyKey('ration-issue:r1', 2_000)).toBe('key-1');
    expect(recoverIdempotencyKey('ration-issue:r2', 2_000)).toBeNull();
  });

  it('is dropped once the outcome is known', () => {
    rememberIdempotencyKey('ration-issue:r1', 'key-1');
    forgetIdempotencyKey('ration-issue:r1');
    expect(recoverIdempotencyKey('ration-issue:r1')).toBeNull();
  });

  it('expires well inside the server’s replay window; a retry does not extend it', () => {
    rememberIdempotencyKey('ration-issue:r1', 'key-1', 0);
    rememberIdempotencyKey('ration-issue:r1', 'key-1', PENDING_KEY_TTL_MS - 1);
    expect(recoverIdempotencyKey('ration-issue:r1', PENDING_KEY_TTL_MS + 1)).toBeNull();
  });
});
