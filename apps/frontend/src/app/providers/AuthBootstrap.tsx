import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, type ReactNode } from 'react';
import { endSession, initSession, subscribeToOtherTabs } from '@/features/auth/model/session';
import { useSessionStore } from '@/features/auth/model/session.store';
import { installGuestMode } from '@/features/guest/guest-mode';
import { startOfflineCopy } from '@/features/offline/persist';
import { onSessionExpired } from '@/shared/api/client';
import { installNetworkTracking } from '@/shared/network/network-status';

// Idempotent; before the first request, so visitors without an account see the sample farm.
installGuestMode();
installNetworkTracking();

/**
 * Restores the session once per page load and reacts to session loss:
 * refresh rejected (expired/revoked) or a logout in another tab.
 */
export function AuthBootstrap({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void initSession(queryClient);
  }, [queryClient]);

  useEffect(() => {
    const unsubscribeExpired = onSessionExpired(() => {
      if (useSessionStore.getState().status === 'authenticated') endSession(queryClient, 'expired');
    });
    const unsubscribeTabs = subscribeToOtherTabs(queryClient);
    const stopOfflineCopy = startOfflineCopy(queryClient);
    // The connection is back: a session that could not be checked is checked now.
    function onOnline(): void {
      const { status } = useSessionStore.getState();
      if (status === 'offline' || status === 'unreachable') void initSession(queryClient);
    }
    window.addEventListener('online', onOnline);
    return () => {
      unsubscribeExpired();
      unsubscribeTabs();
      stopOfflineCopy();
      window.removeEventListener('online', onOnline);
    };
  }, [queryClient]);

  return <>{children}</>;
}
