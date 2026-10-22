import { onlineManager } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MOCK_PASSWORDS } from '@/mocks/db';
import { addDays } from '@/features/rations/lib/daily';
import { todayInTashkent } from '@/shared/lib/dates';
import { PHONES, renderApp, resetClientState, setupMockApi, signIn, type TestApi } from '@/test/render';
import { findItem, seedRation } from '@/test/seed';
import { useOfflineQueue, type QueuedOperation } from './queue';

/** Regression tests for the QA report of 22.10.2026: losing and regaining the connection. */

let api: TestApi;

beforeEach(() => {
  resetClientState();
  api = setupMockApi();
  signIn(api, PHONES.farmer, MOCK_PASSWORDS.farmer);
});

afterEach(() => {
  vi.restoreAllMocks();
  window.dispatchEvent(new Event('online'));
  onlineManager.setOnline(true);
  resetClientState();
});

/** The browser reports the connection gone (or back) — like a phone losing signal. */
function setOnline(online: boolean): void {
  vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(online);
  window.dispatchEvent(new Event(online ? 'online' : 'offline'));
}

const issuePosts = () => api.requests.filter((request) => request.method === 'POST' && request.path.endsWith('/issue'));
const farmerId = () => api.server.db.users.find((user) => user.phone === PHONES.farmer)?.id ?? '';

describe('QA: "Berildi" without internet', () => {
  it('is queued on the device, never shown as saved, and sent once when the connection is back', async () => {
    const ration = seedRation(api, { lines: [[findItem(api, 'Arpa'), '8.000']] });
    const view = renderApp('/dashboard');
    const slides = await screen.findByRole('list', { name: 'Bugungi ratsionlar' });

    setOnline(false);
    expect(await screen.findByText(/Internet yo‘q/)).toBeInTheDocument();
    await view.user.click(within(slides).getByRole('button', { name: 'Berildi (ombordan chiqarish)' }));
    const dialog = await screen.findByRole('dialog', { name: 'Berildi (ombordan chiqarish): bugun' });
    await view.user.click(within(dialog).getByRole('button', { name: 'Ombordan chiqarish' }));

    expect(await screen.findByText(/yozuv navbatga olindi .* Hali saytga saqlanmagan\./)).toBeInTheDocument();
    expect(await within(slides).findByText('Navbatda — internet kutilmoqda (hali saqlanmagan)')).toBeInTheDocument();
    expect(screen.getByText('Yuborilishi kutilmoqda: 1 ta yozuv (hali saytga saqlanmagan)')).toBeInTheDocument();
    expect(screen.queryByText(/bugun berildi — ombordan chiqarildi/)).not.toBeInTheDocument();
    expect(issuePosts()).toHaveLength(0);
    const [queued] = useOfflineQueue.getState().ops;
    expect(queued).toMatchObject({ kind: 'ration-issue', state: 'pending', request: { rationId: ration.id, days: 1 } });

    setOnline(true);
    expect(await screen.findByText('Yuborildi: 1 ta yozuv saytga saqlandi')).toBeInTheDocument();
    expect(await within(slides).findByText(/Bugun berildi/)).toBeInTheDocument();
    expect(issuePosts()).toHaveLength(1);
    expect(issuePosts()[0]?.headers['idempotency-key']).toBe(queued?.idempotencyKey);
    expect(findItem(api, 'Arpa').quantity).toBe('1170.000');

    // Coming back online again sends nothing more.
    setOnline(false);
    setOnline(true);
    await waitFor(() => expect(useOfflineQueue.getState().ops).toHaveLength(0));
    expect(issuePosts()).toHaveLength(1);
  });

  it('a record queued on another day waits for the farmer’s decision, then is sent once', async () => {
    const ration = seedRation(api, { lines: [[findItem(api, 'Arpa'), '8.000']] });
    const yesterday = addDays(todayInTashkent(), -1);
    const queued: QueuedOperation = {
      id: 'op-1',
      kind: 'ration-issue',
      userId: farmerId(),
      farmId: ration.farmId,
      idempotencyKey: 'queued-key-0001',
      createdAt: `${yesterday}T05:00:00.000Z`,
      day: yesterday,
      label: `Berildi: ${ration.name} (1 kun)`,
      state: 'pending',
      error: null,
      firstSentAt: null,
      request: { rationId: ration.id, days: 1 },
    };
    // Left on the device by yesterday's visit (the IndexedDB fallback in jsdom).
    window.localStorage.setItem(`mf-kv:mf-queue:v1:${farmerId()}`, JSON.stringify([queued]));

    const view = renderApp('/dashboard');
    expect(await screen.findByText('1 tasi sizning qaroringizni kutmoqda')).toBeInTheDocument();
    expect(issuePosts()).toHaveLength(0);

    await view.user.click(screen.getByRole('button', { name: 'Ko‘rish' }));
    const dialog = await screen.findByRole('dialog', { name: 'Yuborilmagan yozuvlar' });
    expect(within(dialog).getByText('Tekshirish kerak')).toBeInTheDocument();
    expect(within(dialog).getByText('Kun o‘tdi — avtomatik yuborilmadi (sayt bugungi sana bilan yozadi)')).toBeInTheDocument();
    await view.user.click(within(dialog).getByRole('button', { name: 'Baribir yuborish' }));
    expect(await within(dialog).findByText('Hamma yozuvlar yuborildi.')).toBeInTheDocument();
    expect(issuePosts()).toHaveLength(1);
    expect(issuePosts()[0]?.headers['idempotency-key']).toBe('queued-key-0001');
  });

  it('an inventory count is not queued: it needs the balance the site holds now', async () => {
    const view = renderApp(`/feed/${findItem(api, 'Arpa').id}`);
    await view.user.click(await screen.findByRole('button', { name: 'Inventarizatsiya tuzatishi' }));
    const dialog = await screen.findByRole('dialog', { name: 'Inventarizatsiya tuzatishi: Arpa' });
    setOnline(false);
    await view.user.type(within(dialog).getByLabelText(/Sanab chiqilgan haqiqiy qoldiq/), '1200');
    await view.user.type(within(dialog).getByLabelText(/Sabab/), 'Sanab chiqildi');
    await view.user.click(within(dialog).getByRole('button', { name: 'Tuzatishni saqlash' }));
    expect(
      await within(dialog).findByText('Inventarizatsiya uchun internet kerak — joriy qoldiq saytda tekshiriladi'),
    ).toBeInTheDocument();
    expect(useOfflineQueue.getState().ops).toHaveLength(0);
    expect(api.requests.some((request) => request.method === 'POST' && request.path.endsWith('/movements'))).toBe(false);
  });
});

describe('QA: without internet nothing pretends to be zero', () => {
  it('expenses that could not load say so instead of "0 so‘m"', async () => {
    const view = renderApp('/feed');
    await screen.findByRole('cell', { name: 'Arpa' });
    setOnline(false);
    await view.router.navigate('/dashboard');

    const stats = await screen.findByRole('region', { name: 'Asosiy ko‘rsatkichlar' });
    const monthly = within(stats).getByText('Oylik xarid xarajati').closest('a') as HTMLElement;
    expect(await within(monthly).findByText('Ma’lumot yuklanmadi')).toBeInTheDocument();
    expect(monthly).not.toHaveTextContent('0 so‘m');

    const panel = screen.getByRole('region', { name: 'Xarajatlar' });
    const expenseStats = within(panel).getByRole('region', { name: 'Xarajatlar ko‘rsatkichlari' });
    expect(await within(expenseStats).findAllByText('Ma’lumot yuklanmadi')).toHaveLength(3);
    expect(expenseStats).not.toHaveTextContent('so‘m');

    // Back online: the real figures replace the notice.
    setOnline(true);
    await waitFor(() => expect(expenseStats).toHaveTextContent('so‘m'));
  });
});
