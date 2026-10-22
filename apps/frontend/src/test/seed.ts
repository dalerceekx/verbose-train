import type { InventoryItem } from '@/features/inventory/api/inventory.api';
import type { AnimalType } from '@/features/rations/api/rations.api';
import type { MockRation } from '@/mocks/db';
import type { TestApi } from './render';

const stamp = '2026-10-10T09:00:00.000Z';

/** A feed (kg) put straight into the mock warehouse (no movement history). */
export function seedItem(api: TestApi, name: string, quantity: string, extra: Partial<InventoryItem> = {}): InventoryItem {
  const [template] = api.server.db.items;
  if (!template) throw new Error('seed has no inventory items');
  const item: InventoryItem = {
    ...template,
    id: crypto.randomUUID(),
    name,
    category: 'FEED',
    unit: 'KG',
    quantity,
    medicineId: null,
    unitPrice: null,
    minQuantity: null,
    archivedAt: null,
    ...extra,
  };
  api.server.db.items.push(item);
  return item;
}

export function findItem(api: TestApi, name: string): InventoryItem {
  const item = api.server.db.items.find((candidate) => candidate.name === name);
  if (!item) throw new Error(`no item ${name}`);
  return item;
}

/** The farm's "Buqa" ration category (created once). */
function bullType(api: TestApi): AnimalType {
  const db = api.server.db;
  const existing = db.rationAnimalTypes.find((type) => type.profile === 'BULL');
  if (existing) return existing;
  const type: AnimalType = {
    id: crypto.randomUUID(),
    farmId: db.farms[0]?.id ?? '',
    name: 'Buqa',
    profile: 'BULL',
    species: 'CATTLE',
    sex: 'MALE',
    isDefault: true,
    archivedAt: null,
    createdAt: stamp,
    updatedAt: stamp,
  };
  db.rationAnimalTypes.push(type);
  return type;
}

/** A saved bull ration: `lines` are [item, kg per head per day]. */
export function seedRation(
  api: TestApi,
  {
    name = 'Semirtirish',
    animalCount = 10,
    days = 30,
    lines,
  }: { name?: string; animalCount?: number; days?: number; lines: Array<[InventoryItem, string]> },
): MockRation {
  const db = api.server.db;
  const ration: MockRation = {
    id: crypto.randomUUID(),
    farmId: db.farms[0]?.id ?? '',
    animalTypeId: bullType(api).id,
    name,
    animalCount,
    averageWeightKg: '450.00',
    ageMonths: 18,
    purpose: 'FATTENING',
    physiologicalState: null,
    milkYieldLiters: null,
    days,
    notes: null,
    items: lines.map(([item, dailyPerAnimal], position) => ({ inventoryItemId: item.id, dailyPerAnimal, position })),
    archivedAt: null,
    createdAt: stamp,
    updatedAt: stamp,
  };
  db.rations.push(ration);
  return ration;
}
