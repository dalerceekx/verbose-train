import { useMemo } from 'react';
import type { InventoryItem } from '@/features/inventory/api/inventory.api';
import { useInventoryItems } from '@/features/inventory/model/inventory.queries';
import { feedAvailability, feedDemands, type FeedAvailability } from '../lib/feed-availability';
import { useRations } from './rations.queries';

/**
 * The farm's feeds with how long each lasts for the saved rations. While the
 * rations are not loaded (or failed to load) days are unknown and only the
 * farmer's minimum decides "Kam qoldi".
 */
export function useFeedAvailability(farmId: string) {
  const items = useInventoryItems(farmId, 'FEED');
  const rations = useRations(farmId);
  const demands = useMemo(() => (rations.data ? feedDemands(rations.data.items) : null), [rations.data]);
  const byItem = useMemo(() => {
    const map = new Map<string, FeedAvailability>();
    for (const item of items.data?.items ?? []) map.set(item.id, feedAvailability(item, demands?.get(item.id)));
    return map;
  }, [items.data, demands]);

  return {
    items,
    rations,
    /** Day counts are shown only when the rations are known. */
    daysKnown: demands !== null,
    of(item: Pick<InventoryItem, 'id' | 'quantity' | 'minQuantity'>): FeedAvailability {
      return byItem.get(item.id) ?? feedAvailability(item, demands?.get(item.id));
    },
    /** Empty or low feeds, in the list order. */
    lowItems: (items.data?.items ?? []).filter((item) => byItem.get(item.id)?.status !== 'ok'),
  };
}
