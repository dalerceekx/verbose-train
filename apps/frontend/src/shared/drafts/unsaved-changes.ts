/**
 * Forms with input not yet saved to the server. One registry for the whole
 * app, because a router supports a single navigation blocker: the guard in
 * the layout asks here before leaving a page, reloading or closing the tab.
 */
const entries = new Map<string, () => void>();

/** `flush` writes the form's draft to the device right away. */
export function registerUnsavedChanges(id: string, flush: () => void): void {
  entries.set(id, flush);
}

export function unregisterUnsavedChanges(id: string): void {
  entries.delete(id);
}

export function hasUnsavedChanges(): boolean {
  return entries.size > 0;
}

/** Saves every open form's draft now (the page may be closed next). */
export function flushUnsavedDrafts(): void {
  for (const flush of entries.values()) flush();
}
