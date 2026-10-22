import type { InventoryItem } from '@/features/inventory/api/inventory.api';
import { Decimal } from '@/shared/lib/decimal';
import type { DiseaseDetails } from '../api/diseases.api';

/** A medicine the "Molim kasal" treatment schemes name. */
export interface TreatmentMedicine {
  /** As the source text writes it. */
  name: string;
  /**
   * Normalized spellings (see normalizeName) that identify it, matched at a
   * word start: in the treatment text and in the farm's stock item names.
   */
  match: readonly string[];
}

/** Every medicine named in apps/backend/prisma/data/kasalliklar-manba.txt. */
export const TREATMENT_MEDICINES: readonly TreatmentMedicine[] = [
  { name: 'Azitronit', match: ['azitronit'] },
  { name: 'Nitoks 200', match: ['nitoks'] },
  { name: 'Seftonit', match: ['seftonit'] },
  { name: 'Fluneks', match: ['fluneks'] },
  { name: 'Septo-sprey', match: ['septo sprey', 'septosprey'] },
  { name: 'Septogel', match: ['septogel'] },
  { name: 'Butofan', match: ['butofan'] },
  { name: 'Yog‘li A, D3, E vitaminlar', match: ['a d3 e', 'ad3e'] },
  { name: 'Leksoflon', match: ['leksoflon'] },
  { name: 'Mastenit', match: ['mastenit'] },
  { name: 'Mastomitsin', match: ['mastomitsin'] },
  { name: 'Mastisan', match: ['mastisan'] },
  { name: 'Amoksitsillin 150', match: ['amoksitsillin'] },
  { name: 'Ikki tomonlama gel', match: ['ikki tomonlama gel'] },
  { name: 'Kalsiy borglyukonat 20%', match: ['kalsiy borglyukonat'] },
  { name: 'Uteroton', match: ['uteroton'] },
  { name: 'Yodopen', match: ['yodopen'] },
  { name: 'Regostenol', match: ['regostenol'] },
  { name: 'Mitrek', match: ['mitrek'] },
  { name: 'Fergolin', match: ['fergolin'] },
  { name: 'E-selen', match: ['e selen', 'eselen'] },
  { name: 'Kofein-benzoat 20%', match: ['kofein'] },
  { name: 'Tulatrin', match: ['tulatrin'] },
  { name: 'Floroks', match: ['floroks'] },
  { name: 'Doksiloks', match: ['doksiloks'] },
  { name: 'Tilozin 50 / 200', match: ['tilozin'] },
  { name: 'Pnevmotil', match: ['pnevmotil'] },
  { name: 'Enronit', match: ['enronit'] },
  { name: 'Ditrim', match: ['ditrim'] },
  { name: 'Strolitin', match: ['strolitin'] },
  { name: 'Ksilanit', match: ['ksilanit'] },
  { name: 'Ivermek', match: ['ivermek'] },
  { name: 'Meradok', match: ['meradok'] },
  { name: 'Neozidin', match: ['neozidin'] },
  { name: 'Ferran', match: ['ferran'] },
  { name: 'Rikazol', match: ['rikazol'] },
  { name: 'Klozatrem', match: ['klozatrem'] },
  { name: 'Alvet', match: ['alvet'] },
];

/**
 * " lower-case words ": apostrophes (o', g', o‘) dropped, every other run of
 * non-letters/digits one space, padded so a match can require a word start.
 */
export function normalizeName(value: string): string {
  const words = value
    .normalize('NFKC')
    .toLocaleLowerCase('uz')
    .replace(/['`´ʻʼ‘’]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  return ` ${words} `;
}

/** Position of the earliest word-start match in a normalized text, or -1. */
function firstMatch(normalized: string, medicine: TreatmentMedicine): number {
  let first = -1;
  for (const spelling of medicine.match) {
    const at = normalized.indexOf(` ${spelling}`);
    if (at !== -1 && (first === -1 || at < first)) first = at;
  }
  return first;
}

/**
 * The medicines a disease's text names, in order of first mention. The
 * title and the symptoms are not treatment and are not searched.
 */
export function medicinesInTreatment(lines: DiseaseDetails['lines']): TreatmentMedicine[] {
  const text = normalizeName(
    lines
      .filter((line) => line.kind !== 'title' && line.kind !== 'symptoms')
      .map((line) => line.text)
      .join('\n'),
  );
  return TREATMENT_MEDICINES.map((medicine) => ({ medicine, at: firstMatch(text, medicine) }))
    .filter((entry) => entry.at !== -1)
    .sort((a, b) => a.at - b.at)
    .map((entry) => entry.medicine);
}

/**
 * `similar`: the farm has an item whose name only looks like the medicine
 * (another strength or product is possible) — never reported as "Bor".
 */
export type StockState = 'available' | 'similar' | 'expired' | 'empty' | 'missing';

export interface MedicineStock {
  medicine: TreatmentMedicine;
  state: StockState;
  /** The farm's items behind the state (the usable ones when available). */
  items: InventoryItem[];
}

/** An approved entry of the medicine catalog. */
export interface CatalogMedicine {
  id: string;
  name: string;
}

function hasStock(item: InventoryItem): boolean {
  const quantity = Decimal.parse(item.quantity);
  return quantity !== null && !quantity.isZero() && !quantity.isNegative();
}

/**
 * Whether the farm's pharmacy has `medicine` — confirmed only through the
 * catalog: a non-archived stock item linked (medicineId) to the approved
 * catalog entry that is exactly this medicine, in stock and not past its
 * expiry date (`today`: YYYY-MM-DD). An item that merely has a similar name
 * — unlinked, or linked to another catalog entry — is "similar": the farmer
 * checks it with the vet. The scheme text itself has no catalog ids, so the
 * catalog entry is found by its exact name.
 */
export function stockFor(
  medicine: TreatmentMedicine,
  items: readonly InventoryItem[],
  today: string,
  catalog: readonly CatalogMedicine[] = [],
): MedicineStock {
  const wanted = normalizeName(medicine.name);
  const catalogIds = new Set(catalog.filter((entry) => normalizeName(entry.name) === wanted).map((entry) => entry.id));
  const active = items.filter((item) => !item.archivedAt);
  const linked = active.filter((item) => item.medicineId !== null && catalogIds.has(item.medicineId));
  const inStock = linked.filter(hasStock);
  const usable = inStock.filter((item) => !item.expiresOn || item.expiresOn >= today);
  if (usable.length > 0) return { medicine, state: 'available', items: usable };
  if (inStock.length > 0) return { medicine, state: 'expired', items: inStock };
  if (linked.length > 0) return { medicine, state: 'empty', items: linked };
  const named = active.filter((item) => firstMatch(normalizeName(item.name), medicine) !== -1);
  if (named.length > 0) return { medicine, state: 'similar', items: named };
  return { medicine, state: 'missing', items: [] };
}
