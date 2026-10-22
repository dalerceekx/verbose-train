import type { InventoryItem } from '@/features/inventory/api/inventory.api';
import { Decimal } from '@/shared/lib/decimal';
import type { Ration } from '../api/rations.api';

/** A feed that lasts fewer days than this is "Kam qoldi" (the spec's default N). */
export const LOW_STOCK_DAYS = 7;

export type FeedStatus = 'empty' | 'low' | 'ok';

/** What one saved ration takes of a feed every day (per animal × animals). */
export interface FeedDemand {
  rationId: string;
  rationName: string;
  daily: Decimal;
}

export interface FeedAvailability {
  status: FeedStatus;
  /** Daily total of every saved ration that uses the feed; null when none does (or rations are not loaded). */
  dailyNeed: Decimal | null;
  demands: FeedDemand[];
  /** Whole days the balance lasts at `dailyNeed`; null without a daily need. */
  daysCovered: Decimal | null;
  /** At or below the farmer's minimum. */
  belowMinimum: boolean;
  /** Fewer than LOW_STOCK_DAYS days left for the rations that use it. */
  runsOutSoon: boolean;
}

/** Feed id → what each non-archived ration takes of it per day. */
export function feedDemands(
  rations: readonly Pick<Ration, 'id' | 'name' | 'animalCount' | 'items' | 'archivedAt'>[],
): Map<string, FeedDemand[]> {
  const result = new Map<string, FeedDemand[]>();
  for (const ration of rations) {
    if (ration.archivedAt) continue;
    for (const line of ration.items) {
      const daily = Decimal.from(line.dailyPerAnimal).mul(Decimal.from(ration.animalCount));
      if (daily.isZero()) continue;
      const list = result.get(line.inventoryItemId) ?? [];
      list.push({ rationId: ration.id, rationName: ration.name, daily });
      result.set(line.inventoryItemId, list);
    }
  }
  return result;
}

function wholeDays(value: Decimal): Decimal {
  const [integerPart = '0'] = value.toFixed(3).split('.');
  return Decimal.from(integerPart);
}

/**
 * How long a feed lasts and whether it is low — one rule for the warehouse,
 * the item page, the dashboard and the tab badge: empty at 0; low at or
 * below the farmer's minimum, or when the saved rations eat it up in fewer
 * than LOW_STOCK_DAYS days (400 kg at 100 kg a day → 4 days → low). A feed no
 * ration uses keeps the minimum rule only. Without ration data no day count
 * is shown at all — never a guessed number.
 */
export function feedAvailability(
  item: Pick<InventoryItem, 'quantity' | 'minQuantity'>,
  demands: readonly FeedDemand[] | undefined,
  lowDays = LOW_STOCK_DAYS,
): FeedAvailability {
  const quantity = Decimal.parse(item.quantity) ?? Decimal.ZERO;
  const minimum = Decimal.parse(item.minQuantity);
  const list = demands ? [...demands] : [];
  const dailyNeed = list.length > 0 ? Decimal.sum(list.map((demand) => demand.daily)) : null;
  const daysCovered = dailyNeed && !dailyNeed.isZero() && !quantity.isNegative() ? wholeDays(quantity.div(dailyNeed, 3)) : null;
  const belowMinimum = minimum !== null && !quantity.gt(minimum);
  const runsOutSoon = daysCovered !== null && daysCovered.lt(Decimal.from(lowDays));
  const empty = quantity.isZero() || quantity.isNegative();
  return {
    status: empty ? 'empty' : belowMinimum || runsOutSoon ? 'low' : 'ok',
    dailyNeed,
    demands: list,
    daysCovered,
    belowMinimum,
    runsOutSoon,
  };
}

export const FEED_STATUS_LABELS: Record<FeedStatus, string> = {
  empty: 'Tugagan',
  low: 'Kam qoldi',
  ok: 'Yetarli',
};
