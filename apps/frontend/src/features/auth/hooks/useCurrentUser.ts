import { useQuery } from '@tanstack/react-query';
import { authApi } from '../api/auth.api';
import { authKeys } from '../model/keys';
import { useSessionStore } from '../model/session.store';

/**
 * The signed-in user (GET /auth/me). Role and status always come from the
 * server. While nobody is signed in, the sample farm's guest user (guest
 * mode answers /auth/me) — unless `guest: false`.
 */
export function useCurrentUser({ guest = true }: { guest?: boolean } = {}) {
  const status = useSessionStore((state) => state.status);
  const asGuest = guest && status === 'anonymous';
  return useQuery({
    queryKey: asGuest ? authKeys.guest : authKeys.me,
    queryFn: authApi.me,
    enabled: status === 'authenticated' || asGuest,
    staleTime: 5 * 60_000,
  });
}
