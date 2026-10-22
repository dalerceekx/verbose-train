import type { InventoryItem } from '../api/inventory.api';
import { plainText } from './labels';

export interface SameNameMatch {
  /** An item in the warehouse with the same name. */
  active: InventoryItem | null;
  /** An archived item with the same name. */
  archived: InventoryItem | null;
}

/**
 * Items whose name is the same as `name` ignoring case, extra spaces and the
 * kind of apostrophe: "TEST Arpa" = " test arpa ", "Bug'doy" = "Bug‘doy".
 * A UI check only — the API itself does not refuse duplicate names.
 */
export function findSameName(name: string, items: readonly InventoryItem[], exceptId?: string): SameNameMatch {
  const wanted = plainText(name);
  if (!wanted) return { active: null, archived: null };
  const same = items.filter((item) => item.id !== exceptId && plainText(item.name) === wanted);
  return {
    active: same.find((item) => !item.archivedAt) ?? null,
    archived: same.find((item) => item.archivedAt) ?? null,
  };
}
