import type { QueryClient } from '@tanstack/react-query';
import { refreshSession } from '@/shared/api/client';
import { toApiError } from '@/shared/api/errors';
import { accessTokenStore } from '@/shared/api/token-store';
import type { PublicUser } from '@/shared/types/api';
import { claimOfflineCopy, forgetOfflineData, restoreOfflineCopy } from '@/features/offline/persist';
import type { AuthenticatedResponse } from '../api/auth.types';
import { authKeys } from './keys';
import { useSessionStore, type SessionEndReason } from './session.store';

const CHANNEL_NAME = 'meningfermam-auth';
type ChannelMessage = { type: 'logout' };

let channel: BroadcastChannel | null = null;

function authChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  channel ??= new BroadcastChannel(CHANNEL_NAME);
  return channel;
}

/** Called after login / MFA success. */
export function startSession(response: AuthenticatedResponse, queryClient: QueryClient): void {
  accessTokenStore.set(response.accessToken);
  // Whatever was cached before (the sample farm of guest mode) is not theirs.
  queryClient.clear();
  queryClient.setQueryData(authKeys.me, response.user);
  claimOfflineCopy(response.user.id);
  useSessionStore.setState({ status: 'authenticated', mfaChallenge: null, notice: null, endReason: null });
}

/**
 * Drops every trace of the session from memory and the query cache — and the
 * offline copy on the device; an explicit logout also its unsent queue and
 * drafts.
 */
export function endSession(queryClient: QueryClient, reason: SessionEndReason): void {
  const userId = queryClient.getQueryData<PublicUser>(authKeys.me)?.id;
  if (userId) forgetOfflineData(userId, { everything: reason === 'logout' });
  accessTokenStore.clear();
  queryClient.clear();
  useSessionStore.setState({
    status: 'anonymous',
    mfaChallenge: null,
    notice: reason === 'expired' || reason === 'logged-out-elsewhere' ? reason : null,
    endReason: reason,
  });
  // Other tabs of this browser follow an explicit logout.
  if (reason === 'logout') authChannel()?.postMessage({ type: 'logout' } satisfies ChannelMessage);
}

/**
 * Restores a session after a page load: the access token lives in memory,
 * so it is re-issued from the HttpOnly refresh cookie.
 */
export async function initSession(queryClient: QueryClient): Promise<void> {
  // Re-checking after being offline keeps the offline copy on screen meanwhile.
  if (useSessionStore.getState().status !== 'offline') useSessionStore.setState({ status: 'initializing' });
  try {
    const refreshed = await refreshSession();
    if (!refreshed) {
      useSessionStore.setState({ status: 'anonymous' });
      return;
    }
    const shown = queryClient.getQueryData<PublicUser>(authKeys.me);
    // The offline copy was someone else's: nothing of it may stay.
    if (refreshed.user && shown && shown.id !== refreshed.user.id) queryClient.clear();
    if (refreshed.user) {
      queryClient.setQueryData(authKeys.me, refreshed.user);
      claimOfflineCopy(refreshed.user.id);
    }
    const wasOffline = useSessionStore.getState().status === 'offline';
    useSessionStore.setState({ status: 'authenticated' });
    // Back online: every screen reloads from the server.
    if (wasOffline) void queryClient.invalidateQueries();
  } catch (error) {
    const apiError = toApiError(error);
    if (apiError.isNetworkError || apiError.isServerError) {
      // No connection: the last farmer's copy on this device, read-only — no token, nothing sent.
      const restored = useSessionStore.getState().status === 'offline' || (await restoreOfflineCopy(queryClient));
      useSessionStore.setState({ status: restored ? 'offline' : 'unreachable' });
      return;
    }
    useSessionStore.setState({ status: 'anonymous' });
  }
}

/** Mirrors logouts from other tabs of the same browser. */
export function subscribeToOtherTabs(queryClient: QueryClient): () => void {
  const current = authChannel();
  if (!current) return () => undefined;
  const onMessage = (event: MessageEvent<ChannelMessage>) => {
    if (event.data?.type === 'logout' && useSessionStore.getState().status === 'authenticated') {
      endSession(queryClient, 'logged-out-elsewhere');
    }
  };
  current.addEventListener('message', onMessage);
  return () => current.removeEventListener('message', onMessage);
}
