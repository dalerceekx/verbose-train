import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MOCK_PASSWORDS } from '@/mocks/db';
import { http } from '@/shared/api/client';
import { toApiError } from '@/shared/api/errors';
import { PHONES, renderApp, resetClientState, setupMockApi, type TestApi } from '@/test/render';

let api: TestApi;

beforeEach(() => {
  resetClientState();
  api = setupMockApi();
});

afterEach(() => resetClientState());

async function signInOnLoginPage(view: ReturnType<typeof renderApp>) {
  expect(await screen.findByRole('heading', { name: 'Xush kelibsiz!' })).toBeInTheDocument();
  await view.user.type(screen.getByLabelText(/Telefon raqami/), PHONES.farmer);
  await view.user.type(screen.getByLabelText(/^Parol/, { selector: 'input' }), MOCK_PASSWORDS.farmer);
  await view.user.click(screen.getByRole('button', { name: 'Kirish' }));
}

describe('guest mode (browsing without an account)', () => {
  it('shows the sample farm dashboard with today’s rations, and a sign-in link instead of the profile', async () => {
    renderApp('/dashboard');

    expect(await screen.findByRole('heading', { level: 1, name: 'Bosh sahifa' })).toBeInTheDocument();
    expect(await screen.findByText('Sigirlar — sut davri')).toBeInTheDocument();
    expect(screen.getByText('Qo‘ylar — semirtirish')).toBeInTheDocument();
    expect(screen.getByText(/Assalomu alaykum, Mehmon!/)).toBeInTheDocument();
    expect(screen.getByText('Bu — namuna ferma')).toBeInTheDocument();
    const header = screen.getByRole('banner');
    expect(within(header).getByRole('link', { name: 'Kirish' })).toHaveAttribute('href', '/login');
    expect(within(header).queryByRole('button', { name: /profil/i })).not.toBeInTheDocument();
    // Nothing of the sample farm comes from the API.
    expect(api.requests.map((request) => request.path)).not.toContain('/farms');
  });

  it('an action button opens the login page instead of its dialog', async () => {
    const view = renderApp('/dashboard');
    await view.user.click(await screen.findByRole('button', { name: 'Berildi — tasdiqlash' }));

    expect(await screen.findByRole('heading', { name: 'Xush kelibsiz!' })).toBeInTheDocument();
    expect(view.router.state.location.pathname).toBe('/login');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('an action link continues to its target after signing in', async () => {
    const view = renderApp('/dashboard');
    await view.user.click(await screen.findByRole('link', { name: /Hayvon qo‘shish/ }));
    await signInOnLoginPage(view);

    await waitFor(() => expect(view.router.state.location.pathname).toBe('/animals'));
    expect(view.router.state.location.search).toBe('?new=1');
    // Signed in: the real farm, no sample banner.
    expect(screen.queryByText('Bu — namuna ferma')).not.toBeInTheDocument();
  });

  it('looking around keeps working: carousel, tab bar sheets and their pages', async () => {
    const view = renderApp('/dashboard');
    await view.user.click(await screen.findByRole('button', { name: 'Keyingi ratsion' }));
    expect(view.router.state.location.pathname).toBe('/dashboard');

    const sheetButton = screen.getByRole('button', { name: /Ombor/ });
    await view.user.click(sheetButton);
    expect(sheetButton).toHaveAttribute('aria-expanded', 'true');
    await view.user.click(screen.getByRole('link', { name: 'Yem ombori' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Yem ombori' })).toBeInTheDocument();
    expect(await screen.findByText('Omuxta yem')).toBeInTheDocument();
    expect(view.router.state.location.pathname).toBe('/feed');
  });

  it('pages that need an account send the guest to the login page', async () => {
    const view = renderApp('/diseases');
    expect(await screen.findByRole('heading', { name: 'Xush kelibsiz!' })).toBeInTheDocument();
    expect(view.router.state.location.state).toMatchObject({ from: { pathname: '/diseases' } });
  });

  it('writes never leave the browser while nobody is signed in', async () => {
    renderApp('/dashboard');
    await screen.findByText('Sigirlar — sut davri');

    const error = await http.post('/animals', { tagNumber: 'X-1' }).then(
      () => null,
      (reason: unknown) => toApiError(reason),
    );

    expect(error).toMatchObject({ status: 401, code: 'SIGN_IN_REQUIRED' });
    expect(api.requests.some((request) => request.method === 'POST')).toBe(false);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Xush kelibsiz!' })).toBeInTheDocument());
  });
});
