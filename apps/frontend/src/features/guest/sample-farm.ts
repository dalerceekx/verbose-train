/**
 * The sample farm visitors browse before signing in (guest mode). Static,
 * obviously fictional data in the backend's response shapes; nothing here is
 * sent to the server. Dates are relative to `now`, so "today" views (daily
 * rations, this month's expenses) always have something to show.
 */
import type { Animal } from '@/features/animals/api/animals.api';
import type { Farm } from '@/features/farms/api/farms.api';
import type { InventoryItem, StockMovement } from '@/features/inventory/api/inventory.api';
import type { Medicine } from '@/features/medicines/api/medicines.api';
import type { AnimalType, ProfileConfig, Ration, RationIssue } from '@/features/rations/api/rations.api';
import type { PublicUser } from '@/shared/types/api';

export interface SampleFarm {
  user: PublicUser;
  farm: Farm;
  animals: Animal[];
  items: InventoryItem[];
  movements: StockMovement[];
  medicines: Medicine[];
  animalTypes: AnimalType[];
  rations: Ration[];
  rationIssues: RationIssue[];
  profiles: ProfileConfig[];
}

const DAY = 86_400_000;
const HOUR = 3_600_000;

/** Same parameter sets as the backend (apps/backend/src/rations/ration-profiles.ts). */
const PROFILES: ProfileConfig[] = [
  { profile: 'BULL', purposes: ['FATTENING', 'MAINTENANCE', 'BREEDING'], states: [], fields: ['averageWeightKg', 'ageMonths'] },
  {
    profile: 'COW',
    purposes: ['MILK', 'MAINTENANCE', 'FATTENING'],
    states: ['NORMAL', 'PREGNANT', 'LACTATING', 'DRY'],
    fields: ['averageWeightKg', 'ageMonths', 'milkYieldLiters'],
  },
  { profile: 'RAM', purposes: ['MAINTENANCE', 'BREEDING', 'FATTENING'], states: [], fields: ['averageWeightKg', 'ageMonths'] },
  {
    profile: 'EWE',
    purposes: ['MAINTENANCE', 'BREEDING', 'FATTENING'],
    states: ['NORMAL', 'PREGNANT', 'LACTATING'],
    fields: ['averageWeightKg', 'ageMonths'],
  },
  {
    profile: 'OTHER',
    purposes: ['FATTENING', 'MAINTENANCE', 'MILK', 'BREEDING'],
    states: ['NORMAL', 'PREGNANT', 'LACTATING', 'DRY'],
    fields: ['averageWeightKg', 'ageMonths', 'milkYieldLiters'],
  },
];

/** Thousandths → the API's 3-decimal string (1500 → "1.500"). */
function milli(value: number): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  return `${sign}${Math.floor(abs / 1000)}.${String(abs % 1000).padStart(3, '0')}`;
}

type RationFields = Pick<
  Ration,
  'name' | 'animalCount' | 'averageWeightKg' | 'ageMonths' | 'purpose' | 'physiologicalState' | 'milkYieldLiters' | 'days'
> & { profile: AnimalType['profile'] };

export function createSampleFarm(now: number = Date.now()): SampleFarm {
  let sequence = 0;
  // UUID-shaped (v4 layout): pages validate ids taken from the URL.
  const newId = () => `00000000-0000-4000-a000-${(++sequence).toString(16).padStart(12, '0')}`;
  const ago = (days: number, hours = 0) => new Date(now - days * DAY - hours * HOUR).toISOString();

  const user: PublicUser = {
    id: newId(),
    phone: null,
    email: null,
    fullName: 'Mehmon',
    role: 'FARMER',
    status: 'ACTIVE',
    phoneVerifiedAt: null,
    emailVerifiedAt: null,
    mfaEnabled: false,
    isDemo: false,
    lastLoginAt: null,
    createdAt: ago(90),
    updatedAt: ago(90),
    blockedAt: null,
    archivedAt: null,
  };

  const farm: Farm = {
    id: newId(),
    name: 'Namuna ferma',
    region: 'Toshkent viloyati',
    archivedAt: null,
    createdAt: ago(80),
    updatedAt: ago(80),
  };

  const animalSeed: Array<Pick<Animal, 'tagNumber' | 'name' | 'species' | 'sex' | 'birthDate' | 'weightKg'>> = [
    { tagNumber: 'UZ-001', name: 'Oqqiz', species: 'CATTLE', sex: 'FEMALE', birthDate: '2021-04-12', weightKg: '480.50' },
    { tagNumber: 'UZ-002', name: 'Qoraqash', species: 'CATTLE', sex: 'FEMALE', birthDate: '2022-02-03', weightKg: '455.00' },
    { tagNumber: 'UZ-003', name: 'Bahodir', species: 'CATTLE', sex: 'MALE', birthDate: '2020-09-21', weightKg: '690.00' },
    { tagNumber: 'UZ-004', name: null, species: 'CATTLE', sex: 'FEMALE', birthDate: '2026-03-01', weightKg: '120.00' },
    { tagNumber: 'UZ-010', name: null, species: 'SHEEP', sex: 'FEMALE', birthDate: '2024-03-15', weightKg: '52.30' },
    { tagNumber: 'UZ-011', name: null, species: 'SHEEP', sex: 'FEMALE', birthDate: '2024-04-02', weightKg: '49.80' },
    { tagNumber: 'UZ-012', name: 'Hisori', species: 'SHEEP', sex: 'MALE', birthDate: '2023-01-20', weightKg: '84.00' },
    { tagNumber: 'UZ-013', name: null, species: 'SHEEP', sex: 'FEMALE', birthDate: '2024-05-11', weightKg: '47.20' },
    { tagNumber: 'UZ-020', name: null, species: 'GOAT', sex: 'FEMALE', birthDate: '2025-05-10', weightKg: '31.00' },
    { tagNumber: 'UZ-030', name: 'Jiyron', species: 'HORSE', sex: 'MALE', birthDate: '2019-06-01', weightKg: '420.00' },
    { tagNumber: 'UZ-100', name: null, species: 'POULTRY', sex: 'FEMALE', birthDate: '2026-01-05', weightKg: '1.80' },
    { tagNumber: 'UZ-101', name: null, species: 'POULTRY', sex: 'FEMALE', birthDate: '2026-01-05', weightKg: '1.75' },
  ];
  const animals: Animal[] = animalSeed.map((animal, index) => ({
    id: newId(),
    farmId: farm.id,
    notes: null,
    archivedAt: null,
    archivedReason: null,
    createdAt: ago(70 - index),
    updatedAt: ago(70 - index),
    ...animal,
  }));

  const medicine: Medicine = {
    id: newId(),
    name: 'Namuna dori №1',
    activeIngredient: 'Namuna modda',
    form: 'Eritma',
    concentration: null,
    withdrawalMeatDays: 0,
    withdrawalMilkDays: 0,
    status: 'APPROVED',
    isDemo: false,
    approvedAt: ago(30),
    createdAt: ago(40),
    updatedAt: ago(30),
  };

  const items: InventoryItem[] = [];
  const movements: StockMovement[] = [];
  const balances = new Map<string, number>();

  /** One ledger row; `quantity` in thousandths of the item unit. */
  function move(
    item: InventoryItem,
    type: StockMovement['type'],
    quantity: number,
    unitCost: string | null,
    createdAt: string,
    rationIssueId: string | null = null,
  ): StockMovement {
    const balance = (balances.get(item.id) ?? 0) + (type === 'IN' || type === 'ADJUSTMENT_IN' ? quantity : -quantity);
    balances.set(item.id, balance);
    // Like the API: every priced purchase becomes the item's current price.
    if (type === 'IN' && unitCost) item.unitPrice = unitCost;
    item.quantity = milli(balance);
    const movement: StockMovement = {
      id: newId(),
      itemId: item.id,
      farmId: farm.id,
      type,
      quantity: milli(quantity),
      balanceAfter: milli(balance),
      unitCost,
      currency: unitCost ? 'UZS' : null,
      reason: type.startsWith('ADJUSTMENT') ? 'Inventarizatsiya' : null,
      actorId: user.id,
      rationIssueId,
      createdAt,
    };
    movements.push(movement);
    return movement;
  }

  /** `history`: [type, whole units, unit cost, days ago]. */
  function addItem(
    partial: Pick<InventoryItem, 'name' | 'category' | 'unit'> & Partial<InventoryItem>,
    history: Array<[StockMovement['type'], number, string | null, number]>,
  ): InventoryItem {
    const item: InventoryItem = {
      id: newId(),
      farmId: farm.id,
      quantity: '0.000',
      medicineId: null,
      batchNumber: null,
      expiresOn: null,
      openedAt: null,
      useWithinDaysAfterOpening: null,
      unitPrice: null,
      minQuantity: null,
      archivedAt: null,
      createdAt: ago(60),
      updatedAt: ago(1),
      ...partial,
    };
    items.push(item);
    for (const [type, units, unitCost, daysAgo] of history) move(item, type, units * 1000, unitCost, ago(daysAgo, 3));
    return item;
  }

  const barley = addItem({ name: 'Arpa', category: 'FEED', unit: 'KG' }, [
    ['IN', 2000, '3200.00', 55],
    ['OUT', 450, null, 40],
    ['OUT', 300, null, 12],
    ['IN', 500, '3400.00', 6],
  ]);
  const hay = addItem({ name: 'Pichan', category: 'FEED', unit: 'KG' }, [
    ['IN', 5000, '1500.00', 50],
    ['OUT', 1600, null, 20],
  ]);
  const bran = addItem({ name: 'Kepak', category: 'FEED', unit: 'KG' }, [['IN', 600, '2500.00', 15]]);
  // Below its minimum: shows the low-stock warning.
  const compound = addItem({ name: 'Omuxta yem', category: 'FEED', unit: 'KG', minQuantity: '200.000' }, [
    ['IN', 1000, '4800.00', 33],
    ['OUT', 880, null, 4],
  ]);
  addItem(
    {
      name: medicine.name,
      category: 'MEDICINE',
      unit: 'ML',
      medicineId: medicine.id,
      batchNumber: 'NB-2026-01',
      expiresOn: new Date(now + 120 * DAY).toISOString().slice(0, 10),
    },
    [['IN', 500, '120.00', 25]],
  );
  addItem({ name: 'Bir martalik shprits', category: 'EQUIPMENT', unit: 'PIECE' }, [['IN', 100, '1500.00', 25]]);

  const typeSeed: Array<Pick<AnimalType, 'profile' | 'name' | 'species' | 'sex'>> = [
    { profile: 'BULL', name: 'Buqa', species: 'CATTLE', sex: 'MALE' },
    { profile: 'COW', name: 'Sigir', species: 'CATTLE', sex: 'FEMALE' },
    { profile: 'RAM', name: 'Qo‘chqor', species: 'SHEEP', sex: 'MALE' },
    { profile: 'EWE', name: 'Qo‘y', species: 'SHEEP', sex: 'FEMALE' },
  ];
  const animalTypes: AnimalType[] = typeSeed.map((type) => ({
    id: newId(),
    farmId: farm.id,
    ...type,
    isDefault: true,
    archivedAt: null,
    createdAt: ago(80),
    updatedAt: ago(80),
  }));

  const rations: Ration[] = [];
  const rationIssues: RationIssue[] = [];
  const rationLines = new Map<string, Array<[InventoryItem, number]>>();

  /** `lines`: [feed, thousandths per animal per day]; `issuedHoursAgo`: today's feeding, if given. */
  function addRation(fields: RationFields, lines: Array<[InventoryItem, number]>, issuedHoursAgo: number | null): void {
    const { profile, ...rest } = fields;
    const type = animalTypes.find((candidate) => candidate.profile === profile);
    if (!type) throw new Error(`sample farm: no animal type ${profile}`);
    const ration: Ration = {
      id: newId(),
      farmId: farm.id,
      animalTypeId: type.id,
      animalType: { id: type.id, name: type.name, profile: type.profile, species: type.species, sex: type.sex },
      ...rest,
      notes: null,
      items: [],
      lastIssue: null,
      archivedAt: null,
      createdAt: ago(10),
      updatedAt: ago(2),
    };
    if (issuedHoursAgo !== null) {
      // Issued from the warehouse: the issue is the feeding record.
      const issue: RationIssue = {
        id: newId(),
        rationId: ration.id,
        farmId: farm.id,
        days: 1,
        animalCount: ration.animalCount,
        actorId: user.id,
        createdAt: new Date(now - issuedHoursAgo * HOUR).toISOString(),
        movements: [],
      };
      for (const [item, daily] of lines) {
        issue.movements.push(move(item, 'OUT', daily * ration.animalCount, null, issue.createdAt, issue.id));
      }
      rationIssues.push(issue);
      ration.lastIssue = { id: issue.id, createdAt: issue.createdAt, days: issue.days };
    }
    rationLines.set(ration.id, lines);
    rations.push(ration);
  }

  addRation(
    {
      name: 'Sigirlar — sut davri',
      profile: 'COW',
      animalCount: 3,
      averageWeightKg: '460.00',
      ageMonths: 48,
      purpose: 'MILK',
      physiologicalState: 'LACTATING',
      milkYieldLiters: '14.00',
      days: 30,
    },
    [
      [hay, 8000],
      [barley, 3000],
      [bran, 1500],
    ],
    2,
  );
  addRation(
    {
      name: 'Qo‘ylar — semirtirish',
      profile: 'EWE',
      animalCount: 4,
      averageWeightKg: '50.00',
      ageMonths: 24,
      purpose: 'FATTENING',
      physiologicalState: null,
      milkYieldLiters: null,
      days: 30,
    },
    [
      [hay, 1500],
      [compound, 400],
    ],
    null,
  );

  // Joined on read like the API, after every movement (current stock).
  for (const ration of rations) {
    ration.items = (rationLines.get(ration.id) ?? []).map(([item, daily], position) => {
      const { id, name, unit, category, quantity, unitPrice, minQuantity, archivedAt } = item;
      return {
        inventoryItemId: id,
        dailyPerAnimal: milli(daily),
        position,
        item: { id, name, unit, category, quantity, unitPrice, minQuantity, archivedAt },
      };
    });
  }

  return {
    user,
    farm,
    animals,
    items,
    movements,
    medicines: [medicine],
    animalTypes,
    rations,
    rationIssues,
    profiles: PROFILES,
  };
}
