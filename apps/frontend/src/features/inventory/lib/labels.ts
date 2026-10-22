import { formatDecimal } from '@/shared/lib/format';
import {
  INVENTORY_UNITS,
  type InventoryCategory,
  type InventoryUnit,
  type MovementType,
  type StockMovement,
} from '../api/inventory.api';

export const CATEGORY_LABELS: Record<InventoryCategory, string> = {
  FEED: 'Yem',
  MEDICINE: 'Dori',
  EQUIPMENT: 'Jihoz',
  OTHER: 'Boshqa',
};

export const UNIT_SHORT: Record<InventoryUnit, string> = {
  KG: 'kg',
  G: 'g',
  L: 'l',
  ML: 'ml',
  PIECE: 'dona',
  DOSE: 'doza',
};

export const UNIT_NAMES: Record<InventoryUnit, string> = {
  KG: 'Kilogramm (kg)',
  G: 'Gramm (g)',
  L: 'Litr (l)',
  ML: 'Millilitr (ml)',
  PIECE: 'Dona',
  DOSE: 'Doza',
};

/** Feed is weighed (tonnes and bags are entered and converted to kg); grams, millilitres and doses are for medicines. */
const FEED_UNITS: readonly InventoryUnit[] = ['KG', 'L', 'PIECE'];

/** Units offered when a new item of `category` is added. */
export function unitsFor(category: InventoryCategory): readonly InventoryUnit[] {
  return category === 'FEED' ? FEED_UNITS : INVENTORY_UNITS;
}

export const MOVEMENT_LABELS: Record<MovementType, string> = {
  IN: 'Kirim',
  OUT: 'Chiqim',
  ADJUSTMENT_IN: 'Tuzatish (+)',
  ADJUSTMENT_OUT: 'Tuzatish (−)',
};

export function isIncoming(type: MovementType): boolean {
  return type === 'IN' || type === 'ADJUSTMENT_IN';
}

/** Reason the backend writes on the intake recorded for a new item's starting stock. */
export const OPENING_BALANCE_REASON = 'Boshlang‘ich qoldiq';

/** Lower case, one kind of apostrophe, single spaces — for comparing names and fixed texts. */
export function plainText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKC')
    .replace(/['`´ʻʼ‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('uz');
}

/**
 * Stock that was already in the warehouse when the item was added — not a
 * purchase, so never an expense. The API marks it only by its reason text
 * (it has no separate type yet).
 */
export function isOpeningBalance(movement: Pick<StockMovement, 'type' | 'reason'>): boolean {
  return movement.type === 'IN' && plainText(movement.reason) === plainText(OPENING_BALANCE_REASON);
}

/** What a movement means to the farmer (one name per action everywhere). */
export type MovementKind = 'purchase' | 'intake' | 'opening' | 'ration' | 'consumption' | 'adjustment-in' | 'adjustment-out';

export function movementKind(movement: Pick<StockMovement, 'type' | 'unitCost' | 'reason' | 'rationIssueId'>): MovementKind {
  switch (movement.type) {
    case 'IN':
      if (isOpeningBalance(movement)) return 'opening';
      return movement.unitCost !== null ? 'purchase' : 'intake';
    case 'OUT':
      return movement.rationIssueId ? 'ration' : 'consumption';
    case 'ADJUSTMENT_IN':
      return 'adjustment-in';
    case 'ADJUSTMENT_OUT':
      return 'adjustment-out';
  }
}

export const MOVEMENT_KIND_LABELS: Record<MovementKind, string> = {
  purchase: 'Xarid',
  intake: 'Kirim (xaridsiz)',
  opening: 'Boshlang‘ich qoldiq',
  ration: 'Ratsion sarfi',
  consumption: 'Sarf',
  'adjustment-in': 'Tuzatish (+)',
  'adjustment-out': 'Tuzatish (−)',
};

/** "1 250 kg", "12,5 l". */
export function formatQuantity(quantity: string | null | undefined, unit: InventoryUnit): string {
  const formatted = formatDecimal(quantity, { maxFractionDigits: 3 });
  return formatted === '—' ? formatted : `${formatted} ${UNIT_SHORT[unit]}`;
}
