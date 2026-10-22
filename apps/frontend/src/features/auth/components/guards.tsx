import { useQueryClient } from '@tanstack/react-query';
import { ShieldX, WifiOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import type { UserRole } from '@/shared/types/api';
import { Button, ButtonLink, ErrorState, PageLoader } from '@/shared/ui';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { roleHome } from '../lib/permissions';
import { postLoginTarget } from '../lib/redirect';
import { endSession, initSession } from '../model/session';
import { useSessionStore } from '../model/session.store';

function FullScreen({ children }: { children: ReactNode }) {
  return <div className="flex min-h-dvh items-center justify-center bg-background p-4">{children}</div>;
}

function ServerUnreachable() {
  const queryClient = useQueryClient();
  return (
    <FullScreen>
      <div className="flex max-w-md flex-col items-center gap-3 text-center">
        <span aria-hidden className="inline-flex size-12 items-center justify-center rounded-full bg-primary-light">
          <WifiOff className="size-6" />
        </span>
        <h1 className="text-lg font-semibold">Server bilan aloqa yo‘q</h1>
        <p className="text-ink-secondary">Sessiyani tiklab bo‘lmadi. Internet aloqasini tekshirib, qayta urinib ko‘ring.</p>
        <Button onClick={() => void initSession(queryClient)}>Qayta urinish</Button>
      </div>
    </FullScreen>
  );
}

function LoginRedirect() {
  const endReason = useSessionStore((state) => state.endReason);
  const location = useLocation();
  // After an explicit logout the next person starts at their own home
  // page; otherwise (first visit, expired session) return to this page.
  const returnHere = endReason !== 'logout' && endReason !== 'logged-out-elsewhere';
  return (
    <Navigate
      to="/login"
      replace
      state={returnHere ? { from: { pathname: location.pathname, search: location.search } } : undefined}
    />
  );
}

/**
 * The app shell: waits for session restore, then lets in a signed-in user
 * or — guest mode — a visitor without an account, who browses the sample
 * farm. A session that has just ended (expired, ended elsewhere, failed)
 * goes to the login page instead of silently turning into the sample farm.
 */
export function AuthOrGuest() {
  const status = useSessionStore((state) => state.status);
  const endReason = useSessionStore((state) => state.endReason);
  if (status === 'anonymous' && endReason !== null && endReason !== 'logout') return <LoginRedirect />;
  return <RequireAuth guests />;
}

/**
 * Protected area: waits for session restore, then requires a signed-in user
 * (`guests`: or a guest in guest mode).
 */
export function RequireAuth({ guests = false }: { guests?: boolean }) {
  const status = useSessionStore((state) => state.status);
  const queryClient = useQueryClient();
  const me = useCurrentUser({ guest: guests });

  if (status === 'initializing') {
    return (
      <FullScreen>
        <PageLoader label="Sessiya tekshirilmoqda…" />
      </FullScreen>
    );
  }
  if (status === 'unreachable') return <ServerUnreachable />;
  if (status === 'anonymous' && !guests) return <LoginRedirect />;
  if (me.isPending) {
    return (
      <FullScreen>
        <PageLoader />
      </FullScreen>
    );
  }
  if (me.isError) {
    return (
      <FullScreen>
        <div className="flex flex-col items-center">
          <ErrorState error={me.error} onRetry={() => void me.refetch()} />
          <Button variant="ghost" onClick={() => endSession(queryClient, 'error')}>
            Kirish sahifasiga qaytish
          </Button>
        </div>
      </FullScreen>
    );
  }
  return <Outlet />;
}

export function ForbiddenView({ role }: { role: UserRole | undefined }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 px-4 text-center">
      <span aria-hidden className="inline-flex size-12 items-center justify-center rounded-full bg-danger-light text-danger">
        <ShieldX className="size-6" />
      </span>
      <h1 className="text-lg font-semibold">Ruxsat yo‘q</h1>
      <p className="max-w-md text-ink-secondary">Bu sahifa sizning rolingiz uchun mo‘ljallanmagan.</p>
      {role ? <ButtonLink to={roleHome(role)}>Bosh sahifaga qaytish</ButtonLink> : null}
    </div>
  );
}

/** Role gate inside the protected area (UI only — the API enforces it too). */
export function RequireRole({ allow }: { allow: (role: UserRole) => boolean }) {
  const { data: user } = useCurrentUser();
  if (!user) return null;
  if (!allow(user.role)) return <ForbiddenView role={user.role} />;
  return <Outlet />;
}

/** Login/registration pages: signed-in users go straight to their home page. */
export function GuestOnly() {
  const status = useSessionStore((state) => state.status);
  const me = useCurrentUser({ guest: false });
  const location = useLocation();
  if (status === 'initializing') {
    return (
      <FullScreen>
        <PageLoader label="Sessiya tekshirilmoqda…" />
      </FullScreen>
    );
  }
  // Same target as the login flow itself, so the two navigations agree
  // (a lazily loaded target page must not be overridden by the home page).
  if (status === 'authenticated' && me.data) return <Navigate to={postLoginTarget(me.data.role, location.state)} replace />;
  return <Outlet />;
}

/** `/` → the signed-in user's home. */
export function RoleHomeRedirect() {
  const { data: user } = useCurrentUser();
  if (!user) return null;
  return <Navigate to={roleHome(user.role)} replace />;
}
