import { describe, expect, it } from 'vitest';
import type { InventoryItem } from '../api/inventory.api';
import { findSameName } from './item-names';

function item(id: string, name: string, archivedAt: string | null = null): InventoryItem {
  return {
    id,
    farmId: 'farm',
    name,
    category: 'FEED',
    unit: 'KG',
    quantity: '100.000',
    medicineId: null,
    batchNumber: null,
    expiresOn: null,
    openedAt: null,
    useWithinDaysAfterOpening: null,
    unitPrice: null,
    minQuantity: null,
    archivedAt,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };
}

describe('duplicate feed names', () => {
  const items = [item('a', 'Test Arpa'), item('b', 'Bug‘doy'), item('c', 'Kepak', '2026-10-05T00:00:00.000Z')];

  it('ignores case and extra spaces: " test arpa " is "Test Arpa"', () => {
    expect(findSameName(' test arpa ', items).active?.id).toBe('a');
    expect(findSameName('TEST   ARPA', items).active?.id).toBe('a');
  });

  it("ignores the kind of apostrophe: Bug'doy is Bug‘doy", () => {
    expect(findSameName("Bug'doy", items).active?.id).toBe('b');
    expect(findSameName('Bugʻdoy', items).active?.id).toBe('b');
  });

  it('other names are not duplicates', () => {
    expect(findSameName('Arpa', items)).toEqual({ active: null, archived: null });
    expect(findSameName('Test Arpa 2', items)).toEqual({ active: null, archived: null });
    expect(findSameName('   ', items)).toEqual({ active: null, archived: null });
  });

  it('an item being edited is not a duplicate of itself', () => {
    expect(findSameName('Test arpa', items, 'a').active).toBeNull();
  });

  it('tells an archived namesake apart', () => {
    expect(findSameName('kepak', items)).toEqual({ active: null, archived: items[2] });
  });
});
