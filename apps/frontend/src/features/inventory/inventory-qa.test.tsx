import { screen, waitFor, within } from '@testing-library/react';
import { AxiosError, type AxiosAdapter } from 'axios';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockAdapter } from '@/mocks/adapter';
import { MOCK_PASSWORDS } from '@/mocks/db';
import { http } from '@/shared/api/client';
import { PHONES, renderApp, resetClientState, setupMockApi, signIn, type TestApi } from '@/test/render';
import { findItem, seedItem, seedRation } from '@/test/seed';

/** Regression tests for the QA report of 22.10.2026 (warehouse part). */

let api: TestApi;

beforeEach(() => {
  resetClientState();
  api = setupMockApi();
  signIn(api, PHONES.farmer, MOCK_PASSWORDS.farmer);
});

afterEach(() => resetClientState());

const movementPosts = () => api.requests.filter((request) => request.method === 'POST' && request.path.endsWith('/movements'));
const itemPosts = () => api.requests.filter((request) => request.method === 'POST' && request.path === '/inventory/items');

async function openMovement(view: ReturnType<typeof renderApp>, action: string, title: string) {
  await view.user.click(await screen.findByRole('button', { name: action }));
  return screen.findByRole('dialog', { name: title });
}

describe('QA: forms say what is missing or wrong before anything is sent', () => {
  it('a new feed cannot be saved empty, with 0 or with letters', async () => {
    const view = renderApp('/feed?new=1');
    const dialog = await screen.findByRole('dialog', { name: 'Yangi yem' });
    const save = within(dialog).getByRole('button', { name: 'Saqlash' });
    expect(save).toBeDisabled();
    expect(within(dialog).getByText('Saqlash uchun yem nomini, miqdorini va narxini kiriting')).toBeInTheDocument();

    await view.user.type(within(dialog).getByLabelText(/Nomi/), 'Makkajo‘xori');
    const quantity = within(dialog).getByLabelText(/Boshlang‘ich miqdor/);
    await view.user.type(quantity, '0');
    await view.user.tab();
    expect(await within(dialog).findByText('Qiymat noldan katta bo‘lsin')).toBeInTheDocument();
    await view.user.clear(quantity);
    await view.user.type(quantity, 'abc');
    expect(await within(dialog).findByText('Musbat son kiriting (masalan 12,5)')).toBeInTheDocument();
    await view.user.clear(quantity);
    await view.user.type(quantity, '500');
    expect(await within(dialog).findByText('Saqlash uchun yem narxini kiriting')).toBeInTheDocument();
    expect(save).toBeDisabled();

    await view.user.type(within(dialog).getByLabelText(/1 kg narxi/), '3500');
    await waitFor(() => expect(save).toBeEnabled());
    expect(itemPosts()).toHaveLength(0);
  });

  it('a purchase without a quantity is not sent', async () => {
    const view = renderApp(`/feed/${findItem(api, 'Arpa').id}`);
    const dialog = await openMovement(view, 'Xarid', 'Xarid qilish: Arpa');
    await view.user.click(within(dialog).getByRole('button', { name: 'Xaridni saqlash' }));
    expect(await within(dialog).findByText('Miqdorni kiriting')).toBeInTheDocument();
    expect(movementPosts()).toHaveLength(0);
  });
});

describe('QA: one feed, one name', () => {
  it('" test arpa " and Bug\'doy are the feeds already in the warehouse', async () => {
    seedItem(api, 'Test Arpa', '100.000');
    const wheat = seedItem(api, 'Bug‘doy', '100.000');
    const view = renderApp('/feed?new=1');
    const dialog = await screen.findByRole('dialog', { name: 'Yangi yem' });
    const name = within(dialog).getByLabelText(/Nomi/);

    await view.user.type(name, ' test arpa ');
    expect(await within(dialog).findByText('«Test Arpa» omborda allaqachon bor')).toBeInTheDocument();
    await view.user.type(within(dialog).getByLabelText(/Boshlang‘ich miqdor/), '500');
    await view.user.type(within(dialog).getByLabelText(/1 kg narxi/), '3500');
    expect(within(dialog).getByRole('button', { name: 'Saqlash' })).toBeDisabled();
    expect(within(dialog).getByText('Bu nom band — boshqa nom yozing yoki mavjud yemni oching')).toBeInTheDocument();

    await view.user.clear(name);
    await view.user.type(name, "Bug'doy");
    expect(await within(dialog).findByText('«Bug‘doy» omborda allaqachon bor')).toBeInTheDocument();
    await view.user.click(within(dialog).getByRole('button', { name: 'Mavjud yemni ochish' }));
    await waitFor(() => expect(view.router.state.location.pathname).toBe(`/feed/${wheat.id}`));
    expect(itemPosts()).toHaveLength(0);
  });
});

describe('QA: Xarid and Kirim (xaridsiz) are told apart', () => {
  it('an intake has no price and is not an expense; it offers to switch to a purchase', async () => {
    const view = renderApp(`/feed/${findItem(api, 'Arpa').id}`);
    let dialog = await openMovement(view, 'Kirim (xaridsiz)', 'Kirim (xaridsiz): Arpa');
    expect(within(dialog).getByText('Bu xarid emas')).toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/narxi/)).not.toBeInTheDocument();
    await view.user.type(within(dialog).getByLabelText(/Miqdor/), '50');
    await view.user.click(within(dialog).getByRole('button', { name: 'Kirimni saqlash' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(movementPosts()[0]?.body).toEqual({ type: 'IN', quantity: '50' });

    dialog = await openMovement(view, 'Kirim (xaridsiz)', 'Kirim (xaridsiz): Arpa');
    await view.user.click(within(dialog).getByRole('button', { name: 'Xarid sifatida kiritish' }));
    dialog = await screen.findByRole('dialog', { name: 'Xarid qilish: Arpa' });
    // A purchase starts from the current price and shows the total before saving.
    expect(within(dialog).getByLabelText(/1 kg narxi/)).toHaveValue('3400');
    await view.user.type(within(dialog).getByLabelText(/Miqdor/), '10');
    expect(within(dialog).getByText('34 000 so‘m')).toBeInTheDocument();
  });
});

describe('QA: tonnes and bags are converted to kg', () => {
  it('2 tonnes are sent as 2 000 kg', async () => {
    const view = renderApp(`/feed/${findItem(api, 'Arpa').id}`);
    const dialog = await openMovement(view, 'Xarid', 'Xarid qilish: Arpa');
    await view.user.click(within(dialog).getByRole('radio', { name: 'tonna' }));
    await view.user.type(within(dialog).getByLabelText(/Miqdor \(tonna\)/), '2');
    expect(within(dialog).getByText(/^= 2 tonna \(2\s000 kg\)$/u)).toBeInTheDocument();
    await view.user.click(within(dialog).getByRole('button', { name: 'Xaridni saqlash' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(movementPosts()[0]?.body).toMatchObject({ type: 'IN', quantity: '2000', unitCost: '3400', currency: 'UZS' });
    expect(findItem(api, 'Arpa').quantity).toBe('3250.000');
  });

  it('10 bags of 50 kg are sent as 500 kg', async () => {
    const view = renderApp(`/feed/${findItem(api, 'Arpa').id}`);
    const dialog = await openMovement(view, 'Kirim (xaridsiz)', 'Kirim (xaridsiz): Arpa');
    await view.user.click(within(dialog).getByRole('radio', { name: 'qop' }));
    await view.user.type(within(dialog).getByLabelText(/Miqdor \(qop\)/), '10');
    await view.user.type(within(dialog).getByLabelText(/1 qop necha kg/), '50');
    expect(within(dialog).getByText('= 10 qop (500 kg)')).toBeInTheDocument();
    await view.user.click(within(dialog).getByRole('button', { name: 'Kirimni saqlash' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(movementPosts()[0]?.body).toEqual({ type: 'IN', quantity: '500', reason: '10 qop (500 kg)' });
  });
});

describe('QA: an inventory count is the counted balance, not the difference', () => {
  it('140 kg counted as 135 kg writes ADJUSTMENT_OUT 5 kg', async () => {
    const feed = seedItem(api, 'Test arpa', '140.000');
    const view = renderApp(`/feed/${feed.id}`);
    const dialog = await openMovement(view, 'Inventarizatsiya tuzatishi', 'Inventarizatsiya tuzatishi: Test arpa');
    await view.user.type(within(dialog).getByLabelText(/Sanab chiqilgan haqiqiy qoldiq/), '135');
    expect(within(dialog).getByText(/Yangi qoldiq:/)).toHaveTextContent(/Yangi qoldiq: 135 kg · Farq: −5 kg \(kamayadi\)/);
    await view.user.type(within(dialog).getByLabelText(/Sabab/), 'Sanab chiqildi');
    await view.user.click(within(dialog).getByRole('button', { name: 'Tuzatishni saqlash' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(movementPosts()[0]?.body).toEqual({ type: 'ADJUSTMENT_OUT', quantity: '5', reason: 'Sanab chiqildi' });
    expect(findItem(api, 'Test arpa').quantity).toBe('135.000');
  });

  it('a count equal to the balance changes nothing and is not sent', async () => {
    const feed = seedItem(api, 'Test arpa', '140.000');
    const view = renderApp(`/feed/${feed.id}`);
    const dialog = await openMovement(view, 'Inventarizatsiya tuzatishi', 'Inventarizatsiya tuzatishi: Test arpa');
    await view.user.type(within(dialog).getByLabelText(/Sanab chiqilgan haqiqiy qoldiq/), '140');
    await view.user.type(within(dialog).getByLabelText(/Sabab/), 'Sanab chiqildi');
    await view.user.click(within(dialog).getByRole('button', { name: 'Tuzatishni saqlash' }));
    expect(await within(dialog).findByText('Qoldiq o‘zgarmaydi — tuzatish kerak emas')).toBeInTheDocument();
    expect(movementPosts()).toHaveLength(0);
  });
});

describe('QA: how many days a feed lasts', () => {
  it('400 kg at 100 kg a day: 4 days, "Kam qoldi" — the same on the warehouse page and its warning', async () => {
    const wheat = seedItem(api, 'Bug‘doy', '400.000', { unitPrice: '3000.00' });
    seedRation(api, { name: 'Qishki', animalCount: 10, lines: [[wheat, '10.000']] });
    renderApp('/feed');
    const row = (await screen.findByRole('cell', { name: 'Bug‘doy' })).closest('tr') as HTMLElement;
    expect(await within(row).findByText('4 kun')).toBeInTheDocument();
    expect(within(row).getByText('Kam qoldi')).toBeInTheDocument();
    expect(screen.getByText(/^Bug‘doy:/, { selector: 'li' })).toHaveTextContent('Bug‘doy: 400 kg — 4 kunga yetadi (Qishki)');
  });
});

describe('QA: a record is saved once, however it is clicked and whatever the network does', () => {
  it('a rapid double click sends one request', async () => {
    http.defaults.adapter = createMockAdapter(api.server, { latencyMs: 40 });
    const view = renderApp(`/feed/${findItem(api, 'Arpa').id}`);
    const dialog = await openMovement(view, 'Xarid', 'Xarid qilish: Arpa');
    await view.user.type(within(dialog).getByLabelText(/Miqdor/), '100');
    await view.user.dblClick(within(dialog).getByRole('button', { name: 'Xaridni saqlash' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(movementPosts()).toHaveLength(1);
    expect(findItem(api, 'Arpa').quantity).toBe('1350.000');
  });

  it('a refused request keeps the input; the retry uses the same Idempotency-Key and is saved once', async () => {
    const handle = api.server.handle.bind(api.server);
    let refuse = true;
    api.server.handle = (request) => {
      if (refuse && request.method === 'POST' && request.path.endsWith('/movements')) {
        refuse = false;
        api.requests.push({ ...request, status: 500 });
        return { status: 500, body: { statusCode: 500, code: 'INTERNAL_ERROR', message: 'Ichki xatolik', requestId: 'r' } };
      }
      return handle(request);
    };
    const view = renderApp(`/feed/${findItem(api, 'Arpa').id}`);
    const dialog = await openMovement(view, 'Xarid', 'Xarid qilish: Arpa');
    await view.user.type(within(dialog).getByLabelText(/Miqdor/), '100');
    const save = within(dialog).getByRole('button', { name: 'Xaridni saqlash' });
    await view.user.click(save);
    await waitFor(() => expect(movementPosts()).toHaveLength(1));
    await waitFor(() => expect(save).toBeEnabled());
    expect(within(dialog).getByLabelText(/Miqdor/)).toHaveValue('100');
    expect(findItem(api, 'Arpa').quantity).toBe('1250.000');

    await view.user.click(save);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const keys = movementPosts().map((request) => request.headers['idempotency-key']);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect(findItem(api, 'Arpa').quantity).toBe('1350.000');
  });

  it('a lost answer is checked in the history instead of being written twice', async () => {
    const adapter = http.defaults.adapter as AxiosAdapter;
    let lose = true;
    http.defaults.adapter = async (config) => {
      const response = await adapter(config);
      if (lose && config.method === 'post' && String(config.url).endsWith('/movements')) {
        lose = false;
        throw new AxiosError('Network Error', AxiosError.ERR_NETWORK, config);
      }
      return response;
    };
    const view = renderApp(`/feed/${findItem(api, 'Arpa').id}`);
    const dialog = await openMovement(view, 'Xarid', 'Xarid qilish: Arpa');
    await view.user.type(within(dialog).getByLabelText(/Miqdor/), '100');
    await view.user.click(within(dialog).getByRole('button', { name: 'Xaridni saqlash' }));
    expect(await screen.findByText(/Xarid allaqachon saqlangan .* qayta yozilmadi/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(movementPosts()).toHaveLength(1);
    expect(findItem(api, 'Arpa').quantity).toBe('1350.000');
  });
});

describe('QA: typed input survives a reload as a draft on this device', () => {
  it('a half-filled new feed is offered back after a reload — and is not a save', async () => {
    const first = renderApp('/feed?new=1');
    let dialog = await screen.findByRole('dialog', { name: 'Yangi yem' });
    await first.user.type(within(dialog).getByLabelText(/Nomi/), 'Makkajo‘xori');
    await first.user.type(within(dialog).getByLabelText(/Boshlang‘ich miqdor/), '500');
    // The page goes away (reload): the draft is written first.
    window.dispatchEvent(new Event('pagehide'));
    first.unmount();

    const second = renderApp('/feed?new=1');
    dialog = await screen.findByRole('dialog', { name: 'Yangi yem' });
    expect(await within(dialog).findByText(/^Saqlanmagan qoralama topildi/)).toBeInTheDocument();
    expect(within(dialog).getByText(/faqat shu qurilmada saqlangan — saytga yuborilmagan/)).toBeInTheDocument();
    // Offered, never applied silently.
    expect(within(dialog).getByLabelText(/Nomi/)).toHaveValue('');
    await second.user.click(within(dialog).getByRole('button', { name: 'Tiklash' }));
    expect(within(dialog).getByLabelText(/Nomi/)).toHaveValue('Makkajo‘xori');
    expect(within(dialog).getByLabelText(/Boshlang‘ich miqdor/)).toHaveValue('500');
    expect(itemPosts()).toHaveLength(0);
  });
});

describe('QA: archiving a feed', () => {
  it('names the stock and the rations it affects; the ration then cannot be issued', async () => {
    const kepak = findItem(api, 'Kepak');
    const ration = seedRation(api, { name: 'Kepakli', lines: [[kepak, '2.000']] });
    const view = renderApp('/feed');
    await view.user.click(await screen.findByRole('button', { name: 'Kepak: arxivlash' }));
    const confirm = await screen.findByRole('dialog', { name: '“Kepak”ni arxivlash' });
    expect(await within(confirm).findByText('1 ta ratsionda ishlatiladi')).toBeInTheDocument();
    expect(within(confirm).getByText('Kepakli')).toBeInTheDocument();
    await view.user.click(within(confirm).getByRole('checkbox', { name: 'Tushundim, baribir arxivlash' }));
    await view.user.click(within(confirm).getByRole('button', { name: 'Arxivlash' }));
    await waitFor(() => expect(screen.queryByRole('cell', { name: 'Kepak' })).not.toBeInTheDocument());

    await view.router.navigate(`/feed-calculator/rations/${ration.id}`);
    expect(await screen.findByText('Ratsionda arxivlangan yem bor')).toBeInTheDocument();
    expect(screen.getByText('Arxivlangan · omborda 0')).toBeInTheDocument();
    await view.user.click(screen.getByRole('button', { name: 'Berildi (ombordan chiqarish)' }));
    const dialog = await screen.findByRole('dialog', { name: 'Berildi (ombordan chiqarish)' });
    expect(within(dialog).getByRole('button', { name: 'Ombordan chiqarish' })).toBeDisabled();
    expect(api.requests.some((request) => request.path.endsWith('/issue'))).toBe(false);
  });
});
