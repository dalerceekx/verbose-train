import { create } from 'zustand';
import type { CreateMovementInput } from '@/features/inventory/api/inventory.api';
import { todayInTashkent } from '@/shared/lib/dates';
import { kvStore } from '@/shared/lib/kv-store';

/**
 * `pending`: waits for the connection; `sending`: on its way; `failed`: the
 * server refused it (reason kept); `needs-review`: not sent automatically
 * (another day, an earlier issue for the same days, an old lost answer) —
 * the farmer decides.
 */
export type QueuedState = 'pending' | 'sending' | 'failed' | 'needs-review';

interface QueuedBase {
  id: string;
  userId: string;
  farmId: string;
  /** Sent with every attempt: the server applies the record once. */
  idempotencyKey: string;
  /** When the farmer pressed the button (device time). */
  createdAt: string;
  /** The Tashkent day it was meant for: sent automatically on that day only. */
  day: string;
  /** What the farmer sees in the queue. */
  label: string;
  state: QueuedState;
  error: string | null;
  /** First time it left the device; its answer may have been lost since. */
  firstSentAt: string | null;
}

export interface QueuedIssue extends QueuedBase {
  kind: 'ration-issue';
  request: { rationId: string; days: number };
}

export interface QueuedMovement extends QueuedBase {
  kind: 'stock-movement';
  request: { itemId: string; body: CreateMovementInput };
}

export type QueuedOperation = QueuedIssue | QueuedMovement;

type NewOperation = Pick<QueuedOperation, 'userId' | 'farmId' | 'idempotencyKey' | 'label'> &
  (Pick<QueuedIssue, 'kind' | 'request'> | Pick<QueuedMovement, 'kind' | 'request'>);

const storageKey = (userId: string) => `mf-queue:v1:${userId}`;

interface QueueState {
  /** Whose queue is loaded (each account on the device has its own). */
  userId: string | null;
  ops: QueuedOperation[];
  load: (userId: string) => Promise<void>;
  /** False when the device could not keep it (then nothing is queued). */
  enqueue: (operation: NewOperation) => Promise<boolean>;
  update: (id: string, patch: Partial<Pick<QueuedOperation, 'state' | 'error' | 'firstSentAt'>>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** Explicit logout: nothing unsent stays on a shared device. */
  clear: (userId: string) => Promise<void>;
}

/**
 * Records made without internet ("Berildi", purchase, intake, consumption),
 * kept on the device (IndexedDB) so a reload does not lose them, each with
 * its Idempotency-Key. Nothing here is ever shown as saved: it is saved only
 * when the server answers.
 */
export const useOfflineQueue = create<QueueState>((set, get) => {
  async function persist(ops: QueuedOperation[]): Promise<boolean> {
    const { userId } = get();
    if (!userId) return false;
    set({ ops });
    return kvStore.set(storageKey(userId), ops);
  }

  return {
    userId: null,
    ops: [],
    async load(userId) {
      if (get().userId === userId) return;
      set({ userId, ops: [] });
      const stored = (await kvStore.get<QueuedOperation[]>(storageKey(userId))) ?? [];
      // A send interrupted by a reload is simply pending again (same key).
      if (get().userId === userId) {
        set({ ops: stored.map((op) => (op.state === 'sending' ? { ...op, state: 'pending' } : op)) });
      }
    },
    async enqueue(operation) {
      if (get().userId !== operation.userId) await get().load(operation.userId);
      const queued = {
        ...operation,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        day: todayInTashkent(),
        state: 'pending',
        error: null,
        firstSentAt: null,
      } as QueuedOperation;
      const saved = await persist([...get().ops, queued]);
      if (!saved) set({ ops: get().ops.filter((op) => op.id !== queued.id) });
      return saved;
    },
    async update(id, patch) {
      await persist(get().ops.map((op) => (op.id === id ? { ...op, ...patch } : op)));
    },
    async remove(id) {
      await persist(get().ops.filter((op) => op.id !== id));
    },
    async clear(userId) {
      await kvStore.delete(storageKey(userId));
      if (get().userId === userId) set({ ops: [] });
    },
  };
});

/** Pending "Berildi" of a ration (made offline, not sent yet). */
export function queuedIssueFor(ops: readonly QueuedOperation[], rationId: string): QueuedIssue | undefined {
  return ops.find(
    (op): op is QueuedIssue => op.kind === 'ration-issue' && op.request.rationId === rationId && op.state !== 'failed',
  );
}

/** The browser knows it has no network: a request would not even leave the device. */
export function deviceOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}
