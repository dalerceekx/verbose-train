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

  it('matches stock names written differently, at a word start only', () => {
    const matches = (name: string, medicineName: string) =>
      stockFor(medicine(medicineName), [item(name, '10.000')], today).state === 'available';
    expect(matches('Nitoks-200', 'Nitoks 200')).toBe(true);
    expect(matches('NITOKS 200 LA', 'Nitoks 200')).toBe(true);
    expect(matches('AD3E vitamin', 'Yog‘li A, D3, E vitaminlar')).toBe(true);
    expect(matches('Yog‘li A, D3, E', 'Yog‘li A, D3, E vitaminlar')).toBe(true);
    expect(matches('E selen', 'E-selen')).toBe(true);
    expect(matches('Eselen 50 ml', 'E-selen')).toBe(true);
    expect(matches('Septosprey', 'Septo-sprey')).toBe(true);
    expect(matches('Azit', 'Azitronit')).toBe(false);
    expect(matches('Antiseftonit', 'Seftonit')).toBe(false);
  });

  it('available: the usable stock, summed', () => {
    const result = stockFor(
      medicine('Seftonit'),
      [item('Seftonit', '40.000'), item('Seftonit 100 ml', '60.000', { expiresOn: today }), item('Fluneks', '5.000')],
      today,
    );
    expect(result.state).toBe('available');
    expect(result.items.map((entry) => entry.quantity)).toEqual(['40.000', '60.000']);
  });

  it('expired, empty and missing are told apart; archived items do not count', () => {
    expect(stockFor(medicine('Fluneks'), [item('Fluneks', '50.000', { expiresOn: '2026-10-21' })], today).state).toBe('expired');
    expect(stockFor(medicine('Butofan'), [item('Butofan', '0.000')], today).state).toBe('empty');
    expect(stockFor(medicine('Ivermek'), [], today).state).toBe('missing');
    expect(
      stockFor(medicine('Ivermek'), [item('Ivermek', '20.000', { archivedAt: '2026-10-01T00:00:00.000Z' })], today).state,
    ).toBe('missing');
  });
});
