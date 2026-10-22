import { useCallback, useEffect, useRef, useState } from 'react';
import { readDraft, removeDraft, writeDraft, type DraftScope } from './draft-storage';
import { registerUnsavedChanges, unregisterUnsavedChanges } from './unsaved-changes';

/** Autosave this long after the last change (the spec asks for 2–3 s). */
export const DRAFT_SAVE_DELAY_MS = 2_500;

export interface DraftOffer<T> {
  savedAt: number;
  values: T;
  /** The record changed on the server after the draft was saved. */
  outdated: boolean;
}

export interface FormDraft<T> {
  /** A draft found when the form opened: offered, never applied silently. */
  offer: DraftOffer<T> | null;
  /** When the current input was last written to this device (null: not yet). */
  savedAt: number | null;
  /** Takes the offered values (the form applies them). */
  restore: () => T | null;
  /** Deletes the offered draft. */
  discard: () => void;
  /** The server saved the form: drop the draft and stop guarding. */
  clear: () => void;
  /** Writes the draft now (e.g. when a field loses focus). */
  flush: () => void;
}

interface UseFormDraftOptions<T> {
  /** Drafts are kept per user and farm: other accounts on the device never see them. */
  userId: string | undefined;
  farmId: string | undefined;
  /** Identity of the form, e.g. "movement:<itemId>:purchase". */
  formId: string;
  values: T;
  /** The input differs from what the server has. */
  dirty: boolean;
  /** False while a dialog is closed. */
  enabled?: boolean;
  /** Version of the record being edited (e.g. updatedAt): an older draft is flagged. */
  version?: string | null;
  delayMs?: number;
}

/**
 * Autosaves a form's unsent input on this device and offers it back when
 * the form opens again (reload, lost connection, accidental back). A draft
 * is not a save: the form still has to reach the server.
 */
export function useFormDraft<T>({
  userId,
  farmId,
  formId,
  values,
  dirty,
  enabled = true,
  version = null,
  delayMs = DRAFT_SAVE_DELAY_MS,
}: UseFormDraftOptions<T>): FormDraft<T> {
  const scopeKey = userId && farmId ? `${userId}:${farmId}:${formId}` : null;
  const serialized = JSON.stringify(values);
  const [offer, setOffer] = useState<DraftOffer<T> | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  /** Input equal to this snapshot has just been saved to the server. */
  const settled = useRef<string | null>(null);
  /** A change is waiting for the debounce. */
  const pending = useRef(false);
  const latest = useRef<{ scope: DraftScope | null; scopeKey: string | null; values: T; serialized: string; dirty: boolean }>({
    scope: null,
    scopeKey: null,
    values,
    serialized,
    dirty,
  });
  useEffect(() => {
    latest.current = { scope: userId && farmId ? { userId, farmId, formId } : null, scopeKey, values, serialized, dirty };
  });
  const versionRef = useRef(version);
  useEffect(() => {
    versionRef.current = version;
  });

  const save = useCallback(() => {
    pending.current = false;
    const current = latest.current;
    if (!current.scope || !current.dirty || current.serialized === settled.current) return;
    const at = writeDraft(current.scope, current.values, versionRef.current);
    if (at !== null) setSavedAt(at);
  }, []);

  // Opening the form: a draft left by an earlier visit is offered.
  useEffect(() => {
    settled.current = null;
    setSavedAt(null);
    if (!enabled || !userId || !farmId) {
      setOffer(null);
      return;
    }
    const stored = readDraft<T>({ userId, farmId, formId });
    const base = versionRef.current;
    setOffer(
      stored
        ? { savedAt: stored.savedAt, values: stored.values, outdated: Boolean(base && stored.version && stored.version !== base) }
        : null,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, scopeKey]);

  const unsaved = enabled && scopeKey !== null && dirty && serialized !== settled.current;

  // Debounced autosave. Paused while an older draft waits for the farmer's
  // decision, so it is not overwritten by accident.
  useEffect(() => {
    if (!unsaved || offer) return undefined;
    pending.current = true;
    const timer = window.setTimeout(save, delayMs);
    return () => window.clearTimeout(timer);
  }, [unsaved, offer, serialized, delayMs, save]);

  // Leaving the page with this input asks first (see UnsavedChangesGuard).
  useEffect(() => {
    if (!unsaved || !scopeKey) return undefined;
    registerUnsavedChanges(scopeKey, save);
    return () => unregisterUnsavedChanges(scopeKey);
  }, [unsaved, scopeKey, save]);

  // Closing the dialog or leaving the page keeps the last keystrokes too.
  useEffect(() => {
    if (!enabled) return undefined;
    return () => {
      if (pending.current) save();
    };
  }, [enabled, save]);

  const restore = useCallback(() => {
    const offered = offer?.values ?? null;
    setOffer(null);
    return offered;
  }, [offer]);

  const discard = useCallback(() => {
    const { scope } = latest.current;
    if (scope) removeDraft(scope);
    setOffer(null);
    setSavedAt(null);
  }, []);

  const clear = useCallback(() => {
    const { scope, scopeKey: key, serialized: current } = latest.current;
    settled.current = current;
    pending.current = false;
    if (scope) removeDraft(scope);
    if (key) unregisterUnsavedChanges(key);
    setOffer(null);
    setSavedAt(null);
  }, []);

  return { offer, savedAt, restore, discard, clear, flush: save };
}
