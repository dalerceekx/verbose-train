import { describe, expect, it } from 'vitest';
import type { RationItem } from '../api/rations.api';
import { FEED_STATUS_LABELS, feedAvailability, feedDemands } from './feed-availability';

const ration = (id: string, animalCount: number, lines: Array<[string, string]>, archivedAt: string | null = null) => ({
  id,
  name: `Ratsion ${id}`,
  animalCount,
  archivedAt,
  items: lines.map(([inventoryItemId, dailyPerAnimal], position): RationItem => ({
    inventoryItemId,
    dailyPerAnimal,
    position,
    item: {
      id: inventoryItemId,
      name: inventoryItemId,
      unit: 'KG',
      category: 'FEED',
      quantity: '0.000',
      unitPrice: null,
      minQuantity: null,
      archivedAt: null,
    },
  })),
});

describe('how long a feed lasts', () => {
  it('400 kg at 100 kg a day lasts 4 days: "Kam qoldi"', () => {
    const demands = feedDemands([ration('r1', 10, [['arpa', '10.000']])]);
    const result = feedAvailability({ quantity: '400.000', minQuantity: null }, demands.get('arpa'));
    expect(result.dailyNeed?.toString()).toBe('100');
    expect(result.daysCovered?.toString()).toBe('4');
    expect(result.runsOutSoon).toBe(true);
    expect(FEED_STATUS_LABELS[result.status]).toBe('Kam qoldi');
  });

  it('counts whole days only and adds up every ration that uses the feed', () => {
    const demands = feedDemands([ration('r1', 5, [['arpa', '10.000']]), ration('r2', 10, [['arpa', '5.000']])]);
    const result = feedAvailability({ quantity: '450.000', minQuantity: null }, demands.get('arpa'));
    expect(result.dailyNeed?.toString()).toBe('100');
    expect(result.daysCovered?.toString()).toBe('4');
    expect(result.demands.map((demand) => demand.rationName)).toEqual(['Ratsion r1', 'Ratsion r2']);
  });

  it('enough for a week or more is "Yetarli"', () => {
    const demands = feedDemands([ration('r1', 10, [['arpa', '10.000']])]);
    const result = feedAvailability({ quantity: '1000.000', minQuantity: null }, demands.get('arpa'));
    expect(result.daysCovered?.toString()).toBe('10');
    expect(result.status).toBe('ok');
  });

  it('archived rations do not eat the feed', () => {
    const demands = feedDemands([ration('r1', 10, [['arpa', '10.000']], '2026-10-01T00:00:00.000Z')]);
    expect(demands.get('arpa')).toBeUndefined();
    expect(feedAvailability({ quantity: '400.000', minQuantity: null }, demands.get('arpa'))).toMatchObject({
      status: 'ok',
      daysCovered: null,
    });
  });

  it('without rations only the farmer’s minimum counts — no guessed day count', () => {
    const result = feedAvailability({ quantity: '150.000', minQuantity: '200.000' }, undefined);
    expect(result).toMatchObject({ status: 'low', belowMinimum: true, daysCovered: null, runsOutSoon: false });
  });

  it('nothing left is "Tugagan"', () => {
    const result = feedAvailability({ quantity: '0.000', minQuantity: null }, undefined);
    expect(FEED_STATUS_LABELS[result.status]).toBe('Tugagan');
  });
});
