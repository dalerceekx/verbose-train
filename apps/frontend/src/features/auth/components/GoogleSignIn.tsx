import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '@/shared/api/errors';
import { cn } from '@/shared/lib/cn';
import { Alert, FormError, Skeleton } from '@/shared/ui';
import { useAuthMethods, useGoogleLogin } from '../hooks/useAuthFlows';

// Google Identity Services (the official "Sign in with Google" button).
const GSI_SRC = 'https://accounts.google.com/gsi/client';
const BUTTON_MAX_WIDTH = 400;

type ButtonText = 'signin_with' | 'signup_with' | 'continue_with';

interface GoogleAccountsId {
  initialize(config: {
    client_id: string;
    callback: (response: { credential?: string }) => void;
    ux_mode: 'popup';
    context: 'signin' | 'signup';
    itp_support: boolean;
  }): void;
  renderButton(
    parent: HTMLElement,
    options: {
      type: 'standard';
      theme: 'outline';
      size: 'large';
      text: ButtonText;
      shape: 'pill';
      logo_alignment: 'center';
      width: number;
      locale: string;
    },
  ): void;
}

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleAccountsId } };
  }
}

let gsiScript: Promise<GoogleAccountsId> | null = null;

/** Loads the Google script once; a failed load may be retried. */
function loadGoogleIdentity(): Promise<GoogleAccountsId> {
  const loaded = window.google?.accounts?.id;
  if (loaded) return Promise.resolve(loaded);
  gsiScript ??= new Promise<GoogleAccountsId>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GSI_SRC;
    script.async = true;
    script.onload = () => {
      const id = window.google?.accounts?.id;
      if (id) resolve(id);
      else reject(new Error('Google Identity Services did not initialize'));
    };
    script.onerror = () => reject(new Error('Google Identity Services failed to load'));
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    gsiScript = null;
    throw error;
  });
  return gsiScript;
}

function GoogleButton({
  clientId,
  text,
  disabled,
  onCredential,
}: {
  clientId: string;
  text: ButtonText;
  disabled: boolean;
  onCredential: (credential: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const latest = useRef(onCredential);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');

  useEffect(() => {
    latest.current = onCredential;
  }, [onCredential]);

  useEffect(() => {
    let cancelled = false;
    loadGoogleIdentity().then(
      (google) => {
        const parent = container.current;
        if (cancelled || !parent) return;
        google.initialize({
          client_id: clientId,
          callback: (response) => {
            if (response.credential) latest.current(response.credential);
          },
          ux_mode: 'popup',
          context: text === 'signup_with' ? 'signup' : 'signin',
          itp_support: true,
        });
        google.renderButton(parent, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text,
          shape: 'pill',
          logo_alignment: 'center',
          width: Math.min(parent.offsetWidth || BUTTON_MAX_WIDTH, BUTTON_MAX_WIDTH),
          locale: 'uz',
        });
        setState('ready');
      },
      () => {
        if (!cancelled) setState('failed');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [clientId, text]);

  if (state === 'failed') {
    return <Alert tone="warning">Google tugmasini yuklab bo‘lmadi. Internet aloqasini tekshirib, sahifani yangilang.</Alert>;
  }
  return (
    <div
      className={cn('relative min-h-11', disabled && 'pointer-events-none opacity-60')}
      aria-busy={disabled || state === 'loading'}
    >
      <div ref={container} className="flex justify-center" />
      {state === 'loading' ? <Skeleton className="absolute inset-0 h-11 rounded-full" /> : null}
    </div>
  );
}

/**
 * "Sign in with Google": new farmers get an account on their first sign-in,
 * admin roles continue with TOTP. Renders nothing while the server has no
 * Google client ID configured.
 */
export function GoogleSignIn({ text = 'continue_with', className }: { text?: ButtonText; className?: string }) {
  const methods = useAuthMethods();
  const google = useGoogleLogin();
  const clientId = methods.data?.google?.clientId;

  if (methods.isPending) return <Skeleton className={cn('h-11 rounded-full', className)} />;
  if (!clientId) return null;
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <GoogleButton
        clientId={clientId}
        text={text}
        disabled={google.isPending}
        onCredential={(credential) => {
          if (!google.isPending) google.mutate(credential);
        }}
      />
      {google.isPending ? (
        <p className="text-center text-sm text-ink-secondary" role="status">
          Google orqali kirilmoqda…
        </p>
      ) : null}
      <FormError message={google.error ? errorMessage(google.error) : null} />
    </div>
  );
}
