import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MOCK_PASSWORDS } from '@/mocks/db';
import { diseaseCatalog } from '@/mocks/diseases';
import { PHONES, renderApp, resetClientState, setupMockApi, signIn, type TestApi } from '@/test/render';
import { SAFETY_NOTICE, SOURCE_STATUS_LABEL } from './lib/labels';

let api: TestApi;

beforeEach(() => {
  resetClientState();
  api = setupMockApi();
  signIn(api, PHONES.farmer, MOCK_PASSWORDS.farmer);
});

afterEach(() => resetClientState());

const catalog = diseaseCatalog();
const listed = () =>
  within(screen.getByRole('region', { name: 'Kasalliklar' }))
    .getAllByRole('link')
    .map((link) => Number(/^(\d+)\./.exec(link.textContent ?? '')?.[1]));
const oneSpace = (text: string) => text.replace(/\s+/g, ' ');

describe('the source text', () => {
  it('has all 18 diseases in 4 groups, and splitting it loses nothing', () => {
    expect(catalog.diseases.map((disease) => disease.number)).toEqual(Array.from({ length: 18 }, (_, index) => index + 1));
    expect(catalog.groups.map((group) => group.diseaseCount)).toEqual([7, 4, 4, 3]);
    const rebuilt: string[] = [catalog.source.abbreviations];
    for (const group of catalog.groups) {
      rebuilt.push(group.heading);
      for (const disease of catalog.diseases.filter((candidate) => candidate.groupNumber === group.number)) {
        rebuilt.push(disease.fullText);
      }
    }
    expect(rebuilt.join('\n')).toBe(catalog.source.fullText);
  });
});

describe('Molim kasal — choosing a disease', () => {
  it('lists every disease, and animal, group and search filters combine', async () => {
    const view = renderApp('/diseases');
    await waitFor(() => expect(listed()).toHaveLength(18));

    await view.user.click(screen.getByRole('button', { name: 'Buzoq' }));
    await waitFor(() => expect(listed()).toEqual([8, 9, 11, 14, 16, 17]));

    await view.user.selectOptions(screen.getByLabelText('2. Kasallik guruhi'), '2');
    await waitFor(() => expect(listed()).toEqual([8, 9, 11]));

    // By symptom, apostrophes optional: "yo'taladi" is in #8's symptoms.
    await view.user.type(screen.getByLabelText(/Qidirish/), 'yotaladi');
    await waitFor(() => expect(listed()).toEqual([8]));
    expect(view.router.state.location.search).toContain('animal=CALF');
  });

  it('finds a disease by name and shows a clear empty state', async () => {
    const view = renderApp('/diseases');
    await view.user.type(await screen.findByLabelText(/Qidirish/), 'G‘ADIR-BUDUR');
    await waitFor(() => expect(listed()).toEqual([1]));

    await view.user.clear(screen.getByLabelText(/Qidirish/));
    await view.user.type(screen.getByLabelText(/Qidirish/), 'mavjud bo‘lmagan kasallik');
    expect(await screen.findByText('Hech narsa topilmadi')).toBeInTheDocument();
    await view.user.click(screen.getByRole('button', { name: 'Filtrlarni tozalash' }));
    await waitFor(() => expect(listed()).toHaveLength(18));
  });

  it('opens a disease from the list and goes back to the same filters', async () => {
    const view = renderApp('/diseases?animal=LAMB');
    await waitFor(() => expect(listed()).toEqual([8, 9, 14, 16, 18]));
    await view.user.click(screen.getByRole('link', { name: /^9\./ }));
    expect(await screen.findByText(SAFETY_NOTICE)).toBeInTheDocument();
    await view.user.click(screen.getByRole('link', { name: 'Kasalliklar ro‘yxati' }));
    await waitFor(() => expect(listed()).toEqual([8, 9, 14, 16, 18]));
  });
});

describe('Molim kasal — a disease shows its whole source text', () => {
  it.each(catalog.diseases.map((disease) => disease.number))('disease %i: warning, status and every line', async (number) => {
    const disease = catalog.diseases.find((candidate) => candidate.number === number);
    const view = renderApp(`/diseases/${number}`);
    expect(await screen.findByText(SAFETY_NOTICE)).toBeInTheDocument();
    expect(screen.getByText(SOURCE_STATUS_LABEL)).toBeInTheDocument();
    const heading = await screen.findByRole('heading', { level: 2, name: disease?.lines[0]?.text });
    const card = heading.closest('section') as HTMLElement;
    // No vet approved the scheme: its doses stay folded until asked for.
    const scheme = within(card).getByRole('region', { name: 'Davolash sxemasi' });
    expect(within(scheme).getByText('Bu sxema veterinar tomonidan tasdiqlanmagan')).toBeInTheDocument();
    expect(card.querySelector('pre')).toBeNull();
    await view.user.click(within(scheme).getByRole('button', { name: 'Sxemani ko‘rsatish (tasdiqlanmagan)' }));
    // The readable view (without the "Asl matn" block) keeps every line; labels are only set in bold.
    const readableCard = card.cloneNode(true) as HTMLElement;
    readableCard.querySelector('details')?.remove();
    const readable = oneSpace(readableCard.textContent ?? '');
    for (const line of disease?.lines ?? []) {
      const expected = line.kind === 'symptoms' ? line.text.replace(/^Xalq tilida belgilari:\s*/, '') : line.text;
      expect(readable).toContain(oneSpace(expected));
    }
    expect(readable).toContain(catalog.source.abbreviations);
    // …and the untouched original is there too.
    expect(card.querySelector('pre')?.textContent).toBe(disease?.fullText);
  });

  it('urgent diseases open with a "call the vet now" alert, the others do not', async () => {
    const first = renderApp('/diseases/7');
    expect(await screen.findByText('Shoshilinch: darhol veterinar chaqiring')).toBeInTheDocument();
    first.unmount();
    renderApp('/diseases/1');
    expect(await screen.findByText(SAFETY_NOTICE)).toBeInTheDocument();
    expect(screen.queryByText('Shoshilinch: darhol veterinar chaqiring')).not.toBeInTheDocument();
  });

  it('shows the whole source as "Asl matn" after the same explicit step', async () => {
    const view = renderApp('/diseases/source');
    expect(await screen.findByText(SAFETY_NOTICE)).toBeInTheDocument();
    const reveal = await screen.findByRole('button', { name: 'Butun matnni ko‘rsatish (tasdiqlanmagan)' });
    expect(screen.queryByLabelText('Manba matni')).not.toBeInTheDocument();
    await view.user.click(reveal);
    expect(screen.getByLabelText('Manba matni').textContent).toBe(catalog.source.fullText);
  });

  it('says so when a disease number does not exist', async () => {
    renderApp('/diseases/19');
    expect(await screen.findByText('Ma’lumotlarni yuklab bo‘lmadi')).toBeInTheDocument();
  });
});

describe('Molim kasal — are the treatment’s medicines in the pharmacy?', () => {
  function addMedicine(name: string, quantity: string, extra: { expiresOn?: string; medicineId?: string } = {}) {
    const [template] = api.server.db.items;
    if (!template) throw new Error('seed has no inventory items');
    const id = `00000000-0000-4000-9000-${String(api.server.db.items.length).padStart(12, '0')}`;
    api.server.db.items.push({
      ...template,
      id,
      name,
      category: 'MEDICINE',
      unit: 'ML',
      quantity,
      expiresOn: extra.expiresOn ?? null,
      medicineId: extra.medicineId ?? null,
      archivedAt: null,
    });
    return id;
  }

  /** An approved catalog entry with exactly the scheme's name. */
  function addCatalogMedicine(name: string) {
    const [template] = api.server.db.medicines;
    if (!template) throw new Error('seed has no medicines');
    const id = `00000000-0000-4000-9100-${String(api.server.db.medicines.length).padStart(12, '0')}`;
    api.server.db.medicines.push({ ...template, id, name, status: 'APPROVED', isDemo: false });
    return id;
  }

  it('lists every medicine of the scheme; "Bor" only through the catalog, a similar name is to be checked', async () => {
    const seftonit = addMedicine('Seftonit', '100.000', { medicineId: addCatalogMedicine('Seftonit') });
    addMedicine('Nitoks-200', '0.000', { medicineId: addCatalogMedicine('Nitoks 200') });
    addMedicine('Fluneks', '50.000', { expiresOn: '2020-01-01', medicineId: addCatalogMedicine('Fluneks') });
    // Same name, but not linked to the catalog.
    addMedicine('Butofan', '30.000');
    // Same name, but linked to another catalog medicine (another product or strength).
    const [other] = api.server.db.medicines;
    addMedicine('Septogel', '20.000', { medicineId: other?.id });
    renderApp('/diseases/1');

    const section = await screen.findByRole('region', { name: 'Dorixonangizda bormi?' });
    expect(
      await within(section).findByText(
        'Sxemadagi 8 ta doridan 1 tasi dorixonangizda bor, 2 tasining faqat nomi o‘xshash — tekshiring.',
      ),
    ).toBeInTheDocument();
    const row = (name: string) => within(section).getByText(name).closest('li') as HTMLElement;
    expect(row('Seftonit')).toHaveTextContent('Bor · 100 ml');
    expect(within(row('Seftonit')).getByRole('link', { name: 'Seftonit' })).toHaveAttribute(
      'href',
      `/medicines/stock/${seftonit}`,
    );
    expect(row('Nitoks 200')).toHaveTextContent('Tugagan');
    expect(row('Fluneks')).toHaveTextContent('Muddati o‘tgan');
    expect(row('Butofan')).toHaveTextContent('Nomi o‘xshash — tekshiring');
    expect(row('Butofan')).toHaveTextContent('Omborda: Butofan (katalogga bog‘lanmagan)');
    expect(row('Butofan')).not.toHaveTextContent('Bor');
    expect(row('Septogel')).toHaveTextContent('Nomi o‘xshash — tekshiring');
    expect(row('Azitronit')).toHaveTextContent('Yo‘q');
    expect(row('Yog‘li A, D3, E vitaminlar')).toHaveTextContent('Yo‘q');
    expect(within(section).getByRole('link', { name: 'Dori omboriga o‘tish' })).toHaveAttribute('href', '/medicines');
  });
});
