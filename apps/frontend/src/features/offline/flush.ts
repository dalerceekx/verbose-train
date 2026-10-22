import type { QueryClient } from '@tanstack/react-query';
import { inventoryApi } from '@/features/inventory/api/inventory.api';
import { inventoryKeys } from '@/features/inventory/model/inventory.queries';
import { rationsApi } from '@/features/rations/api/rations.api';
import { overlappingIssues } from '@/features/rations/lib/daily';
import { rationKeys } from '@/features/rations/model/rations.queries';
import { saveErrorMessage, toApiError } from '@/shared/api/errors';
import { todayInTashkent } from '@/shared/lib/dates';
import { formatSavedTime } from '@/shared/lib/format';
import { toast } from '@/shared/ui/toast';
import { useOfflineQueue, type QueuedOperation } from './queue';

/**
 * An attempt whose answer was lost is resent automatically only this long
 * after it first left the device — well inside the server's replay window
 * for an Idempotency-Key (24 h by default) — so a resend is replayed, never
 * applied twice.
 */
export const RESEND_WINDOW_MS = 12 * 60 * 60 * 1000;
const FLUSH_LOCK = 'meningfermam:queue-flush';

let running: Promise<number> | null = null;

async function exclusive<T>(task: () => Promise<T>): Promise<T> {
  // Two tabs never send the same queue at once.
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  return locks ? locks.request(FLUSH_LOCK, task) : task();
}

/** Why an operation must not go out by itself now (null: it may). */
async function holdReason(op: QueuedOperation, today: string): Promise<string | null> {
  // The server writes today's date: a record meant for another day would land on the wrong day.
  if (op.day !== today) return 'Kun o‘tdi — avtomatik yuborilmadi (sayt bugungi sana bilan yozadi)';
  if (op.firstSentAt && Date.now() - Date.parse(op.firstSentAt) > RESEND_WINDOW_MS) {
    return 'Avvalgi urinishga javob kelmagan — tarixni tekshiring';
  }
  // Never sent yet: a ration given meanwhile on another device must not be given twice.
  if (op.kind === 'ration-issue' && !op.firstSentAt) {
    const history = await rationsApi.issues(op.request.rationId, { limit: 100 });
    const [earlier] = overlappingIssues(history.items, op.request.days, today);
    if (earlier) return `Bu ratsion ${formatSavedTime(earlier.createdAt)} da berilgan — ikkinchi marta yuborilmadi`;
  }
  return null;
}

async function drain(queryClient: QueryClient, force: ReadonlySet<string>): Promise<number> {
  const queue = useOfflineQueue.getState();
  const today = todayInTashkent();
  let sent = 0;
  for (const op of [...queue.ops]) {
    const forced = force.has(op.id);
    if ((op.state === 'failed' || op.state === 'needs-review') && !forced) continue;
    try {
      if (!forced) {
        const hold = await holdReason(op, today);
        if (hold) {
          await queue.update(op.id, { state: 'needs-review', error: hold });
          continue;
        }
      }
      await queue.update(op.id, { state: 'sending', error: null, firstSentAt: op.firstSentAt ?? new Date().toISOString() });
      if (op.kind === 'ration-issue') await rationsApi.issue(op.request.rationId, op.request.days, op.idempotencyKey);
      else await inventoryApi.createMovement(op.request.itemId, op.request.body, op.idempotencyKey);
      await queue.remove(op.id);
      sent += 1;
    } catch (error) {
      const apiError = toApiError(error);
      if (apiError.isNetworkError || apiError.outcomeUnknown || apiError.status === 401) {
        // Still no connection (or the session must be restored first): try again later, same key.
        await queue.update(op.id, { state: 'pending' });
        break;
      }
      await queue.update(op.id, { state: 'failed', error: saveErrorMessage(error) });
    }
  }
  if (sent > 0) {
    void queryClient.invalidateQueries({ queryKey: rationKeys.all });
    void queryClient.invalidateQueries({ queryKey: inventoryKeys.all });
    toast.success(`Yuborildi: ${sent} ta yozuv saytga saqlandi`);
  }
  return sent;
}

/**
 * Sends the queue in order. Each record keeps its own Idempotency-Key, so a
 * record whose answer was lost is replayed by the server, not applied again.
 * `force`: records the farmer chose to send despite a hold (another day, an
 * earlier issue). Returns how many were saved.
 */
export function flushQueue(queryClient: QueryClient, { force = [] }: { force?: readonly string[] } = {}): Promise<number> {
  running ??= exclusive(() => drain(queryClient, new Set(force))).finally(() => {
    running = null;
  });
  return running;
}
