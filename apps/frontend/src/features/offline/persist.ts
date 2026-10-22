import { dehydrate, hydrate, type DehydratedState, type QueryClient } from '@tanstack/react-query';
import { authKeys } from '@/features/auth/model/keys';
import { useSessionStore } from '@/features/auth/model/session.store';
import { removeUserDrafts } from '@/shared/drafts/draft-storage';
import { kvStore } from '@/shared/lib/kv-store';
import { setLastResponseAt } from '@/shared/network/network-status';
import type { PublicUser } from '@/shared/types/api';
import { useOfflineQueue } from './queue';

const CACHE_PREFIX = 'mf-cache:v1:';
/** Whose copy may be opened offline on this device (the last signed-in farmer). */
const LAST_USER_KEY = 'mf-offline-user';
/** An offline copy older than this is not shown. */
export const OFFLINE_COPY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const SAVE_DELAY_MS = 3_000;
/** The farm's own data a farmer may read offline — never auth, admin or audit data. */
const PERSISTED_ROOTS = new Set(['farms', 'inventory', 'rations', 'animals', 'diseases', 'medicines', 'treatments']);

interface OfflineCopy {
  savedAt: number;
  user: PublicUser;
  state: DehydratedState;
}

function lastUser(): string | null {
  try {
    return window.localStorage.getItem(LAST_USER_KEY);
  } catch {
    return null;
  }
}

function setLastUser(userId: string | null): void {
  try {
    if (userId) window.localStorage.setItem(LAST_USER_KEY, userId);
    else window.localStorage.removeItem(LAST_USER_KEY);
  } catch {
    // Storage unavailable: no offline copy.
  }
}

async function save(queryClient: QueryClient): Promise<void> {
  if (useSessionStore.getState().status !== 'authenticated') return;
  const user = queryClient.getQueryData<PublicUser>(authKeys.me);
  if (!user || user.role !== 'FARMER') return;
  const state = dehydrate(queryClient, {
    shouldDehydrateQuery: (query) => query.state.status === 'success' && PERSISTED_ROOTS.has(String(query.queryKey[0])),
  });
  const copy: OfflineCopy = { savedAt: Date.now(), user, state };
  if (await kvStore.set(CACHE_PREFIX + user.id, copy)) setLastUser(user.id);
}

/**
 * Keeps a copy of the farm's data on the device (IndexedDB), a few seconds
 * after it changes, so the app can be opened without internet and show the
 * last known balances — read-only, with the time of that copy.
 */
export function startOfflineCopy(queryClient: QueryClient): () => void {
  let timer: number | undefined;
  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'success') return;
    if (!PERSISTED_ROOTS.has(String(event.query.queryKey[0]))) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void save(queryClient), SAVE_DELAY_MS);
  });
  return () => {
    window.clearTimeout(timer);
    unsubscribe();
  };
}

/**
 * Offline at start-up: puts the last signed-in farmer's copy back into the
 * cache (and their profile), if it is fresh enough. False: nothing to show.
 */
export async function restoreOfflineCopy(queryClient: QueryClient): Promise<boolean> {
  const userId = lastUser();
  if (!userId) return false;
  const copy = await kvStore.get<OfflineCopy>(CACHE_PREFIX + userId);
  if (!copy || copy.user.id !== userId || Date.now() - copy.savedAt > OFFLINE_COPY_MAX_AGE_MS) return false;
  hydrate(queryClient, copy.state);
  queryClient.setQueryData(authKeys.me, copy.user);
  setLastResponseAt(copy.savedAt);
  return true;
}

/** A user signed in: another account's offline copy must never be opened by them. */
export function claimOfflineCopy(userId: string): void {
  const previous = lastUser();
  if (previous && previous !== userId) void kvStore.delete(CACHE_PREFIX + previous);
  setLastUser(userId);
}

/**
 * The session ended. Always drops the offline copy; an explicit logout also
 * drops the user's unsent queue and drafts (nothing stays on a shared device).
 */
export function forgetOfflineData(userId: string, { everything }: { everything: boolean }): void {
  void kvStore.delete(CACHE_PREFIX + userId);
  if (lastUser() === userId) setLastUser(null);
  if (everything) {
    void useOfflineQueue.getState().clear(userId);
    removeUserDrafts(userId);
  }
}
