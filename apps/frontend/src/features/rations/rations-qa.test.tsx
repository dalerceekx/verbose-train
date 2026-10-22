import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MOCK_PASSWORDS } from '@/mocks/db';
import { PHONES, renderApp, resetClientState, setupMockApi, signIn, type TestApi } from '@/test/render';
import { findItem, seedRation } from '@/test/seed';

/** Regression tests for the QA report of 22.10.2026 (rations part). */

let api: TestApi;

beforeEach(() => {
  resetClientState();
  api = setupMockApi();
  signIn(api, PHONES.farmer, MOCK_PASSWORDS.farmer);
});

afterEach(() => resetClientState());

const issuePosts = () => api.requests.filter((request) => request.method === 'POST' && request.path.endsWith('/issue'));
const resultRow = (name: RegExp) => within(screen.getByRole('table', { name: 'Ratsion natijalari' })).getByRole('row', { name });

function barleyRation() {
  return seedRation(api, { name: 'Semirtirish', animalCount: 10, lines: [[findItem(api, 'Arpa'), '8.000']] });
}

describe('QA: the same feeding is not taken from the warehouse twice', () => {
  it('after "Berildi" on the dashboard, the ration page warns and asks before an extra issue', async () => {
    const ration = barleyRation();
    const view = renderApp('/dashboard');
    const slides = await screen.findByRole('list', { name: 'Bugungi ratsionlar' });
    await view.user.click(within(slides).getByRole('button', { name: 'Berildi (ombordan chiqarish)' }));
    let dialog = await screen.findByRole('dialog', { name: 'Berildi (ombordan chiqarish): bugun' });
    await view.user.click(within(dialog).getByRole('button', { name: 'Ombordan chiqarish' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(findItem(api, 'Arpa').quantity).toBe('1170.000');

    await view.router.navigate(`/feed-calculator/rations/${ration.id}`);
    await view.user.click(await screen.findByRole('button', { name: 'Berildi (ombordan chiqarish)' }));
    dialog = await screen.findByRole('dialog', { name: 'Berildi (ombordan chiqarish)' });
    expect(await within(dialog).findByText('Bu kunlar uchun allaqachon berilgan')).toBeInTheDocument();
    expect(within(dialog).getByText(/sarf ikki baravar bo‘ladi/)).toBeInTheDocument();
    const submit = within(dialog).getByRole('button', { name: 'Ombordan chiqarish' });
    expect(submit).toBeDisabled();

    // A deliberate extra issue is a new operation with its own key.
    await view.user.click(within(dialog).getByRole('checkbox', { name: 'Bu qo‘shimcha berish — ataylab yana chiqaraman' }));
    await view.user.click(submit);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const [first, second] = issuePosts();
    expect(issuePosts()).toHaveLength(2);
    expect(first?.headers['idempotency-key']).not.toBe(second?.headers['idempotency-key']);
    expect(findItem(api, 'Arpa').quantity).toBe('1090.000');
    const history = await screen.findByRole('list', { name: 'Sarf tarixi' });
    expect(await within(history).findByText('Qo‘shimcha berish')).toBeInTheDocument();
  });

  it('a 7-day issue keeps the ration "given" on the dashboard for the whole week', async () => {
    const ration = barleyRation();
    const view = renderApp(`/feed-calculator/rations/${ration.id}`);
    await view.user.click(await screen.findByRole('button', { name: 'Berildi (ombordan chiqarish)' }));
    const dialog = await screen.findByRole('dialog', { name: 'Berildi (ombordan chiqarish)' });
    await view.user.click(within(dialog).getByRole('button', { name: '7 kun' }));
    expect(within(dialog).getByText(/^Qaysi kunlar uchun:/)).toBeInTheDocument();
    await view.user.click(within(dialog).getByRole('button', { name: 'Ombordan chiqarish' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await view.router.navigate('/dashboard');
    const slides = await screen.findByRole('list', { name: 'Bugungi ratsionlar' });
    expect(await within(slides).findByText(/^Berildi · .* gacha$/)).toBeInTheDocument();
    expect(within(slides).queryByRole('button', { name: 'Berildi (ombordan chiqarish)' })).not.toBeInTheDocument();
    expect(issuePosts()).toHaveLength(1);
  });
});

describe('QA: the calculator follows the chosen period', () => {
  it('30 → 50 days: the period amount and the period cost change together', async () => {
    const view = renderApp('/feed-calculator');
    await view.user.click(await screen.findByRole('link', { name: /Buqa/ }));
    await view.user.click((await screen.findAllByRole('link', { name: 'Yangi ratsion' }))[0] as HTMLElement);
    await view.user.type(await screen.findByLabelText(/Ratsion nomi/), 'Qishki');
    await view.user.type(screen.getByLabelText(/Hayvonlar soni/), '10');
    await screen.findByRole('option', { name: /Arpa/ });
    await view.user.selectOptions(screen.getByRole('combobox', { name: '1-yem' }), findItem(api, 'Arpa').id);
    await view.user.type(screen.getByLabelText(/Bir boshga, kuniga/), '8');

    // 10 × 8 kg × 30 days × 3 400 so‘m.
    expect(resultRow(/^30 kunlik yem sarfi/)).toHaveTextContent('2 400 kg');
    const costs = () => screen.getByRole('region', { name: 'Xarajatlar' });
    // The chosen period's cost leads the card (the monthly figure below is the same here: 30 days).
    expect(within(costs()).getByText('30 kunlik xarajat').nextElementSibling).toHaveTextContent('8 160 000 so‘m');

    const days = screen.getByLabelText(/Oziqlantirish muddati/);
    await view.user.clear(days);
    await view.user.type(days, '50');
    expect(resultRow(/^50 kunlik yem sarfi/)).toHaveTextContent('4 000 kg');
    expect(resultRow(/^Umumiy xarajat/)).toHaveTextContent('13 600 000 so‘m');
    expect(within(costs()).getByText('50 kunlik xarajat').nextElementSibling).toHaveTextContent('13 600 000 so‘m');
    expect(within(costs()).queryByText('30 kunlik xarajat')).not.toBeInTheDocument();
  });

  it('leaving the editor with unsaved input asks first and keeps a draft', async () => {
    const view = renderApp('/feed-calculator');
    await view.user.click(await screen.findByRole('link', { name: /Buqa/ }));
    await view.user.click((await screen.findAllByRole('link', { name: 'Yangi ratsion' }))[0] as HTMLElement);
    await view.user.type(await screen.findByLabelText(/Ratsion nomi/), 'Qishki');

    await view.user.click(screen.getByRole('link', { name: 'Bosh sahifa' }));
    const confirm = await screen.findByRole('dialog', { name: 'O‘zgarishlar saqlanmagan' });
    await view.user.click(within(confirm).getByRole('button', { name: 'Qolish' }));
    expect(screen.getByLabelText(/Ratsion nomi/)).toHaveValue('Qishki');

    await view.user.click(screen.getByRole('link', { name: 'Bosh sahifa' }));
    await view.user.click(
      within(await screen.findByRole('dialog', { name: 'O‘zgarishlar saqlanmagan' })).getByRole('button', { name: 'Chiqish' }),
    );
    await waitFor(() => expect(view.router.state.location.pathname).toBe('/dashboard'));
    expect(Object.keys(window.localStorage).some((key) => key.startsWith('mf-draft:v1:'))).toBe(true);
    expect(api.requests.some((request) => request.method === 'POST' && request.path === '/rations')).toBe(false);
  });
});
