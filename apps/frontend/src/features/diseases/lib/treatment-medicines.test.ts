import { describe, expect, it } from 'vitest';
import type { InventoryItem } from '@/features/inventory/api/inventory.api';
import { diseaseCatalog } from '@/mocks/diseases';
import {
  medicinesInTreatment,
  normalizeName,
  stockFor,
  TREATMENT_MEDICINES,
  type TreatmentMedicine,
} from './treatment-medicines';

const catalog = diseaseCatalog();

function namesFor(number: number): string[] {
  const disease = catalog.diseases.find((candidate) => candidate.number === number);
  if (!disease) throw new Error(`no disease ${number}`);
  return medicinesInTreatment(disease.lines).map((found) => found.name);
}

function medicine(name: string): TreatmentMedicine {
  const found = TREATMENT_MEDICINES.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`no medicine ${name}`);
  return found;
}

function item(name: string, quantity: string, extra: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: `id-${name}-${quantity}`,
    farmId: 'farm',
    name,
    category: 'MEDICINE',
    unit: 'ML',
    quantity,
    medicineId: null,
    batchNumber: null,
    expiresOn: null,
    openedAt: null,
    useWithinDaysAfterOpening: null,
    unitPrice: null,
    minQuantity: null,
    archivedAt: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...extra,
  };
}

describe('medicines named by a treatment scheme', () => {
  it('are found in the order the text first names them', () => {
    expect(namesFor(1)).toEqual([
      'Azitronit',
      'Nitoks 200',
      'Seftonit',
      'Fluneks',
      'Septo-sprey',
      'Septogel',
      'Butofan',
      'Yog‘li A, D3, E vitaminlar',
    ]);
    expect(namesFor(12)).toEqual([
      'Neozidin',
      'Nitoks 200',
      'Kofein-benzoat 20%',
      'Kalsiy borglyukonat 20%',
      'Butofan',
      'Ferran',
      'Strolitin',
    ]);
  });

  it('every disease of the source names some, and every listed medicine occurs in the source', () => {
    const withoutMedicines = catalog.diseases
      .filter((disease) => medicinesInTreatment(disease.lines).length === 0)
      .map((disease) => disease.number);
    expect(withoutMedicines).toEqual([]);
    const source = normalizeName(catalog.source.fullText);
    const notInSource = TREATMENT_MEDICINES.filter(({ match }) => !match.some((spelling) => source.includes(` ${spelling}`))).map(
      ({ name }) => name,
    );
    expect(notInSource).toEqual([]);
  });

  it('ignores the title and the symptoms', () => {
    expect(
      medicinesInTreatment([
        { kind: 'title', text: '1. Seftonit kasalligi' },
        { kind: 'symptoms', text: 'Xalq tilida belgilari: Butofan kabi hidlanadi.' },
      ]),
    ).toEqual([]);
  });
});

describe('whether the pharmacy has a medicine', () => {
  const today = '2026-10-22';
  const CATALOG = [
    { id: 'cat-seftonit', name: 'Seftonit' },
    { id: 'cat-fluneks', name: 'Fluneks' },
    { id: 'cat-butofan', name: 'Butofan' },
    { id: 'cat-ivermek', name: 'Ivermek' },
    { id: 'cat-nitoks', name: 'Nitoks 200' },
    { id: 'cat-nitoks-la', name: 'Nitoks 200 LA' },
  ];

  it('a name that only looks like the medicine is "similar", matched at a word start only', () => {
    const state = (name: string, medicineName: string) =>
      stockFor(medicine(medicineName), [item(name, '10.000')], today, CATALOG).state;
    expect(state('Nitoks-200', 'Nitoks 200')).toBe('similar');
    expect(state('NITOKS 200 LA', 'Nitoks 200')).toBe('similar');
    expect(state('AD3E vitamin', 'Yog‘li A, D3, E vitaminlar')).toBe('similar');
    expect(state('Yog‘li A, D3, E', 'Yog‘li A, D3, E vitaminlar')).toBe('similar');
    expect(state('E selen', 'E-selen')).toBe('similar');
    expect(state('Eselen 50 ml', 'E-selen')).toBe('similar');
    expect(state('Septosprey', 'Septo-sprey')).toBe('similar');
    expect(state('Azit', 'Azitronit')).toBe('missing');
    expect(state('Antiseftonit', 'Seftonit')).toBe('missing');
  });

  it('a similar name linked to another catalog entry is never reported as available', () => {
    const result = stockFor(
      medicine('Nitoks 200'),
      [item('Nitoks 200', '100.000', { medicineId: 'cat-nitoks-la' })],
      today,
      CATALOG,
    );
    expect(result.state).toBe('similar');
    expect(result.items.map((entry) => entry.name)).toEqual(['Nitoks 200']);
  });

  it('available: the usable stock linked to the catalog entry, summed', () => {
    const result = stockFor(
      medicine('Seftonit'),
      [
        item('Seftonit', '40.000', { medicineId: 'cat-seftonit' }),
        item('Seftonit 100 ml', '60.000', { medicineId: 'cat-seftonit', expiresOn: today }),
        item('Seftonit (eski)', '25.000'),
        item('Fluneks', '5.000', { medicineId: 'cat-fluneks' }),
      ],
      today,
      CATALOG,
    );
    expect(result.state).toBe('available');
    expect(result.items.map((entry) => entry.quantity)).toEqual(['40.000', '60.000']);
  });

  it('without a catalog the scheme medicine cannot be confirmed: only "similar"', () => {
    expect(stockFor(medicine('Seftonit'), [item('Seftonit', '40.000', { medicineId: 'cat-seftonit' })], today).state).toBe(
      'similar',
    );
  });

  it('expired, empty and missing are told apart; archived items do not count', () => {
    expect(
      stockFor(
        medicine('Fluneks'),
        [item('Fluneks', '50.000', { medicineId: 'cat-fluneks', expiresOn: '2026-10-21' })],
        today,
        CATALOG,
      ).state,
    ).toBe('expired');
    expect(stockFor(medicine('Butofan'), [item('Butofan', '0.000', { medicineId: 'cat-butofan' })], today, CATALOG).state).toBe(
      'empty',
    );
    expect(stockFor(medicine('Ivermek'), [], today, CATALOG).state).toBe('missing');
    expect(
      stockFor(
        medicine('Ivermek'),
        [item('Ivermek', '20.000', { medicineId: 'cat-ivermek', archivedAt: '2026-10-01T00:00:00.000Z' })],
        today,
        CATALOG,
      ).state,
    ).toBe('missing');
  });
});
