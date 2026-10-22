import { create } from 'zustand';
import { http } from '@/shared/api/client';
import { toApiError } from '@/shared/api/errors';

interface NetworkState {
  /** What the browser reports (navigator.onLine): false means surely offline. */
  online: boolean;
  /** Last time the API answered at all (epoch ms); data on screen is at most this fresh. */
  lastResponseAt: number | null;
  /** The device is online but requests get no answer (server or route down). */
  unreachable: boolean;
  /** When the connection came back after being lost (for a short "restored" note). */
  restoredAt: number | null;
}

export const useNetworkStore = create<NetworkState>(() => ({
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  lastResponseAt: null,
  unreachable: false,
  restoredAt: null,
}));

const isLost = (state: Pick<NetworkState, 'online' | 'unreachable'>) => !state.online || state.unreachable;

/** Applies a change and notes the moment a lost connection is back. */
function update(patch: Partial<Omit<NetworkState, 'restoredAt'>>): void {
  const before = useNetworkStore.getState();
  const next = { ...before, ...patch };
  const cameBack = isLost(before) && !isLost(next);
  useNetworkStore.setState(cameBack ? { ...patch, restoredAt: Date.now() } : patch);
}

/** Data restored from the device (offline mode) is as fresh as when it was saved. */
export function setLastResponseAt(timestamp: number): void {
  const current = useNetworkStore.getState().lastResponseAt;
  if (current === null || timestamp > current) useNetworkStore.setState({ lastResponseAt: timestamp });
}

let installed = false;

/**
 * Tracks connectivity for the whole app: the browser's online/offline
 * events and the outcome of every API call (an answer of any status proves
 * the server is reachable; no answer while online means it is not).
 */
export function installNetworkTracking(): void {
  if (installed) return;
  installed = true;
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => update({ online: true }));
    window.addEventListener('offline', () => update({ online: false }));
  }
  http.interceptors.response.use(
    (response) => {
      update({ lastResponseAt: Date.now(), unreachable: false });
      return response;
    },
    (error: unknown) => {
      const apiError = toApiError(error);
      if (apiError.isNetworkError) update({ unreachable: !apiError.isOffline });
      else if (apiError.status > 0) update({ lastResponseAt: Date.now(), unreachable: false });
      throw error;
    },
  );
}

/** Offline, or online without an answer from the server. */
export function useConnectionLost(): boolean {
  return useNetworkStore((state) => !state.online || state.unreachable);
}
