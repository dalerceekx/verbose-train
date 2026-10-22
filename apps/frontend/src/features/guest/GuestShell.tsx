import { LogIn, UserRound } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Alert, ButtonLink } from '@/shared/ui';
import { onGuestSignInRequest, type GuestSignInTarget } from './guest-mode';

const CONTROLS = 'button, a[href], [role="button"], [role="menuitem"], input[type="submit"]';
// Looking around is free: navigation (tab bar, pagination), dialogs, toasts,
// filters (aria-pressed), menus and sheets opening, explicit data-guest-ok.
const VIEW_ONLY_AREAS = '[data-guest-ok], nav, [role="dialog"], [role="radiogroup"], [role="status"], [role="alert"]';
const VIEW_ONLY_CONTROLS = '[aria-pressed], [aria-haspopup], [aria-expanded]';

/** Links that start an action: create dialogs (?new=1) and editor pages. */
function isActionLink(url: URL): boolean {
  return url.searchParams.get('new') === '1' || /\/(new|edit)\/?$/.test(url.pathname);
}

function useFromHere(): GuestSignInTarget {
  const { pathname, search } = useLocation();
  return { pathname, search };
}

/**
 * Guest mode in the UI: any action (add, edit, delete, save, confirm…)
 * opens the login page instead, which returns here — or, for an action
 * link, to that link — once signed in. Mounted while nobody is signed in.
 */
export function GuestActionGuard() {
  const navigate = useNavigate();
  const here = useFromHere();
  const hereRef = useRef(here);

  useEffect(() => {
    hereRef.current = here;
  });

  useEffect(() => {
    const signIn = (target?: GuestSignInTarget) => navigate('/login', { state: { from: target ?? hereRef.current } });

    // Capture phase: runs before React's own handlers, so no dialog opens.
    function onClick(event: MouseEvent): void {
      const control = event.target instanceof Element ? event.target.closest(CONTROLS) : null;
      if (!control || control.closest(VIEW_ONLY_AREAS) || control.matches(VIEW_ONLY_CONTROLS)) return;
      let target: GuestSignInTarget | undefined;
      if (control instanceof HTMLAnchorElement) {
        const url = new URL(control.href, window.location.href);
        if (url.origin !== window.location.origin || !isActionLink(url)) return;
        target = { pathname: url.pathname, search: url.search };
      }
      event.preventDefault();
      event.stopPropagation();
      signIn(target);
    }

    const unsubscribe = onGuestSignInRequest(signIn);
    document.addEventListener('click', onClick, true);
    return () => {
      unsubscribe();
      document.removeEventListener('click', onClick, true);
    };
  }, [navigate]);

  return null;
}

/** Above every page while browsing the sample farm. */
export function GuestNotice() {
  const from = useFromHere();
  return (
    <Alert
      tone="info"
      className="mb-6"
      title="Bu — namuna ferma"
      action={
        <ButtonLink to="/login" state={{ from }} size="sm" icon={<LogIn aria-hidden className="size-4" />}>
          Kirish
        </ButtonLink>
      }
    >
      Ilovani ro‘yxatdan o‘tmasdan ko‘ryapsiz. O‘z fermangizni yuritish, qo‘shish va o‘zgartirish uchun tizimga kiring.
    </Alert>
  );
}

/** The header's profile place while nobody is signed in. */
export function GuestSignInLink() {
  const from = useFromHere();
  return (
    <ButtonLink
      to="/login"
      state={{ from }}
      variant="secondary"
      icon={<UserRound aria-hidden className="size-5" />}
      className="rounded-full"
    >
      <span className="max-[380px]:sr-only">Kirish</span>
    </ButtonLink>
  );
}
