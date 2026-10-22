import type { Location } from 'react-router';
import { useSessionStore } from '@/features/auth/model/session.store';
import { http } from '@/shared/api/client';
import { ApiError } from '@/shared/api/errors';
import type { SampleBackend } from './sample-backend';

export const GUEST_SIGN_IN_MESSAGE = 'Davom etish uchun tizimga kiring';

/** Where to continue after signing in (default: the page the guest is on). */
export type GuestSignInTarget = Pick<Location, 'pathname' | 'search'>;
type SignInListener = (target?: GuestSignInTarget) => void;

const listeners = new Set<SignInListener>();

/** The guest shell listens and opens the login page. */
export function onGuestSignInRequest(listener: SignInListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function requestGuestSignIn(target?: GuestSignInTarget): void {
  for (const listener of listeners) listener(target);
}

/** What a guest gets instead of a request that needs an account. */
export function guestSignInRequired(): ApiError {
  requestGuestSignIn();
  return new ApiError({ status: 401, code: 'SIGN_IN_REQUIRED', message: GUEST_SIGN_IN_MESSAGE });
}

/** Nobody is signed in: the app shows the sample farm. */
export function isGuest(): boolean {
  return useSessionStore.getState().status === 'anonymous';
}

let backend: Promise<SampleBackend> | null = null;

// Loaded on the first guest request only: signed-in users never download it.
function sampleBackend(): Promise<SampleBackend> {
  backend ??= import('./sample-backend').then((module) => module.createSampleBackend());
  return backend;
}

let installed = false;

/**
 * Guest mode at the HTTP layer. While nobody is signed in, reads that need
 * an account are answered from the sample farm in the browser, and writes
 * are never sent — the visitor is asked to sign in instead. Public calls
 * (`skipAuth`: login, refresh, sign-in methods) still reach the server.
 */
export function installGuestMode(): void {
  if (installed) return;
  installed = true;
  http.interceptors.request.use(async (config) => {
    if (config.skipAuth || !isGuest()) return config;
    if ((config.method ?? 'get').toLowerCase() !== 'get') throw guestSignInRequired();
    const sample = await sampleBackend();
    config.adapter = (request) => sample.handle(request);
    return config;
  });
}
