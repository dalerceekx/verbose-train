/**
 * Form drafts on this device (localStorage). A draft is the farmer's own
 * unsent input — never server data, tokens or passwords — kept per user,
 * farm and form so two accounts on one phone never see each other's input.
 */
const PREFIX = 'mf-draft:v1:';
/** Drafts older than this are dropped. */
export const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Keys that must never be written to device storage, whatever the form. */
const SECRET_FIELD = /password|parol|token|secret|csrf/i;

export interface DraftScope {
  userId: string;
  farmId: string;
  /** Form identity, e.g. "item-create:FEED" or "ration-edit:<id>". */
  formId: string;
}

export interface StoredDraft<T> {
  savedAt: number;
  /** What the form was based on (e.g. the ration's updatedAt) — to tell when the server copy changed since. */
  version: string | null;
  values: T;
}

export function draftKey({ userId, farmId, formId }: DraftScope): string {
  return `${PREFIX}${userId}:${farmId}:${formId}`;
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function withoutSecrets<T>(values: T): T {
  if (typeof values !== 'object' || values === null || Array.isArray(values)) return values;
  return Object.fromEntries(Object.entries(values).filter(([key]) => !SECRET_FIELD.test(key))) as T;
}

export function readDraft<T>(scope: DraftScope, now = Date.now()): StoredDraft<T> | null {
  const store = storage();
  if (!store) return null;
  const key = draftKey(scope);
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredDraft<T>>;
    if (typeof parsed.savedAt !== 'number' || parsed.values === undefined || now - parsed.savedAt > DRAFT_MAX_AGE_MS) {
      store.removeItem(key);
      return null;
    }
    return { savedAt: parsed.savedAt, version: parsed.version ?? null, values: parsed.values };
  } catch {
    return null;
  }
}

/** Saves the draft; returns when it was saved, or null when the device refused (full, private mode). */
export function writeDraft<T>(scope: DraftScope, values: T, version: string | null = null, now = Date.now()): number | null {
  const store = storage();
  if (!store) return null;
  try {
    const draft: StoredDraft<T> = { savedAt: now, version, values: withoutSecrets(values) };
    store.setItem(draftKey(scope), JSON.stringify(draft));
    return now;
  } catch {
    return null;
  }
}

export function removeDraft(scope: DraftScope): void {
  try {
    storage()?.removeItem(draftKey(scope));
  } catch {
    // ignore
  }
}

function draftKeys(): string[] {
  const store = storage();
  if (!store) return [];
  const keys: string[] = [];
  for (let index = 0; index < store.length; index += 1) {
    const key = store.key(index);
    if (key?.startsWith(PREFIX)) keys.push(key);
  }
  return keys;
}

/** Drops drafts older than a week (run once per page load). */
export function purgeExpiredDrafts(now = Date.now()): void {
  const store = storage();
  if (!store) return;
  for (const key of draftKeys()) {
    try {
      const parsed = JSON.parse(store.getItem(key) ?? 'null') as Partial<StoredDraft<unknown>> | null;
      if (!parsed || typeof parsed.savedAt !== 'number' || now - parsed.savedAt > DRAFT_MAX_AGE_MS) store.removeItem(key);
    } catch {
      store.removeItem(key);
    }
  }
}

/** Explicit logout: nothing the user typed stays on a shared device. */
export function removeUserDrafts(userId: string): void {
  const store = storage();
  if (!store) return;
  for (const key of draftKeys()) {
    if (key.startsWith(`${PREFIX}${userId}:`)) store.removeItem(key);
  }
}
