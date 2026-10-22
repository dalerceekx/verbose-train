import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MOCK_PASSWORDS } from '@/mocks/db';
import { PHONES, renderApp, resetClientState, setupMockApi, signIn, type TestApi } from '@/test/render';

const CLIENT_ID = 'test-client.apps.googleusercontent.com';

interface GsiConfig {
  client_id: string;
  callback: (response: { credential?: string }) => void;
}

let api: TestApi;
let gsi: GsiConfig | undefined;

/** Stands in for the Google Identity Services script (no network in tests). */
function stubGoogleIdentity(): void {
  window.google = {
    accounts: {
      id: {
        initialize: (config: GsiConfig) => {
          gsi = config;
        },
        renderButton: (parent: HTMLElement) => {
          const button = document.createElement('button');
          button.textContent = 'Google bilan davom etish';
          parent.append(button);
        },
      },
    },
  } as unknown as Window['google'];
}

beforeEach(() => {
  resetClientState();
  api = setupMockApi();
  gsi = undefined;
});

afterEach(() => {
  resetClientState();
  delete window.google;
});

describe('sign-in while SMS is off', () => {
  beforeEach(() => {
    api.server.db.authMethods = { google: null, sms: false };
  });

  it('login offers phone + password only and points to the administrator', async () => {
    renderApp('/login');
    expect(await screen.findByText('Hisob ochish uchun administratorga murojaat qiling.')).toBeInTheDocument();
    expect(screen.getByLabelText(/Telefon raqami/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Parolni unutdingizmi?' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Ro‘yxatdan o‘ting' })).not.toBeInTheDocument();
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
  });

  it('the register page explains instead of offering an SMS form', async () => {
    renderApp('/register');
    expect(await screen.findByText(/SMS orqali ro‘yxatdan o‘tish vaqtincha o‘chirilgan/)).toHaveTextContent(
      'Administratorga murojaat qiling.',
    );
    expect(screen.queryByLabelText(/Telefon raqami/)).not.toBeInTheDocument();
    expect(api.requests.some((request) => request.path === '/auth/otp/send')).toBe(false);
  });
});

describe('Google sign-in', () => {
  beforeEach(() => {
    api.server.db.authMethods = { google: { clientId: CLIENT_ID }, sms: false };
    stubGoogleIdentity();
  });

  it('renders the Google button with the server’s client ID above the phone form', async () => {
    renderApp('/login');
    expect(await screen.findByRole('button', { name: 'Google bilan davom etish' })).toBeInTheDocument();
    expect(gsi?.client_id).toBe(CLIENT_ID);
    expect(screen.getByRole('separator')).toHaveTextContent('yoki telefon raqami bilan');
    expect(
      screen.getByText('Hisobingiz yo‘qmi? Google bilan birinchi marta kirganingizda hisob avtomatik ochiladi.'),
    ).toBeInTheDocument();
  });

  it('a new Google user is signed in as a farmer', async () => {
    const view = renderApp('/login');
    await waitFor(() => expect(gsi).toBeDefined());

    act(() => gsi?.callback({ credential: 'mock-google:Yangi.Fermer@gmail.com' }));

    await waitFor(() => expect(view.router.state.location.pathname).toBe('/dashboard'));
    const request = api.requests.find((entry) => entry.path === '/auth/google');
    expect(request?.body).toEqual({ credential: 'mock-google:Yangi.Fermer@gmail.com' });
    expect(api.server.db.users.find((user) => user.email === 'yangi.fermer@gmail.com')).toMatchObject({
      role: 'FARMER',
      phone: null,
    });
  });

  it('admin roles continue with the TOTP setup', async () => {
    const view = renderApp('/login');
    await waitFor(() => expect(gsi).toBeDefined());

    act(() => gsi?.callback({ credential: 'mock-google:admin@meningfermam.local' }));

    await waitFor(() => expect(view.router.state.location.pathname).toBe('/login/mfa-setup'));
  });

  it('shows the server’s message when Google sign-in fails', async () => {
    renderApp('/login');
    await waitFor(() => expect(gsi).toBeDefined());

    act(() => gsi?.callback({ credential: 'forged' }));

    expect(await screen.findByText('Google orqali kirib bo‘lmadi. Qaytadan urinib ko‘ring')).toBeInTheDocument();
  });
});

describe('administrators adding users', () => {
  async function openCreateDialog() {
    const view = renderApp('/admin/users');
    await view.user.click(await screen.findByRole('button', { name: 'Foydalanuvchi qo‘shish' }));
    return { view, dialog: await screen.findByRole('dialog') };
  }

  function realSuperAdmin(): void {
    const superAdmin = api.server.db.users.find((user) => user.phone === PHONES.superAdmin);
    if (superAdmin) superAdmin.isDemo = false;
    signIn(api, PHONES.superAdmin, MOCK_PASSWORDS.superAdmin);
  }

  it('creates a Google-only account from an email, without phone or password', async () => {
    realSuperAdmin();
    const { view, dialog } = await openCreateDialog();

    await view.user.type(within(dialog).getByLabelText(/Ism va familiya/), 'Google Xodim');
    await view.user.type(within(dialog).getByLabelText(/Google email/), 'xodim@gmail.com');
    await view.user.click(screen.getByRole('button', { name: 'Yaratish' }));

    expect(await screen.findByText('Google Xodim hisobi yaratildi')).toBeInTheDocument();
    const request = api.requests.find((entry) => entry.method === 'POST' && entry.path === '/admin/users');
    expect(request?.body).toEqual({ fullName: 'Google Xodim', role: 'VET', email: 'xodim@gmail.com' });
  });

  it('asks for an email or a phone, and for a password with a phone', async () => {
    realSuperAdmin();
    const { view, dialog } = await openCreateDialog();

    await view.user.type(within(dialog).getByLabelText(/Ism va familiya/), 'Xodim');
    await view.user.click(screen.getByRole('button', { name: 'Yaratish' }));
    expect(await within(dialog).findByText('Google email yoki telefon raqamini kiriting')).toBeInTheDocument();

    await view.user.type(within(dialog).getByLabelText(/Telefon raqami/), '+998 90 777 66 55');
    await view.user.click(screen.getByRole('button', { name: 'Yaratish' }));
    expect(await within(dialog).findByText('Telefon bilan kirish uchun parol kiriting')).toBeInTheDocument();
    expect(api.requests.some((entry) => entry.method === 'POST' && entry.path === '/admin/users')).toBe(false);
  });

  it('tells a demo administrator why it cannot add real users', async () => {
    signIn(api, PHONES.superAdmin, MOCK_PASSWORDS.superAdmin);
    const { dialog } = await openCreateDialog();

    expect(within(dialog).getByText(/Demo akkaunt orqali haqiqiy foydalanuvchi qo‘shib bo‘lmaydi/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yaratish' })).toBeDisabled();
  });
});
