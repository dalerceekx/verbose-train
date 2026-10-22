import { useCallback, useEffect } from 'react';
import { useBlocker, type BlockerFunction } from 'react-router';
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog';
import { purgeExpiredDrafts } from './draft-storage';
import { flushUnsavedDrafts, hasUnsavedChanges } from './unsaved-changes';

/**
 * Mounted once in the layout: leaving a page with unsent input — a link,
 * the menu, the browser's back button — asks first; a reload or closing the
 * tab gets the browser's own warning. Every draft is written to the device
 * before the page can go away.
 */
export function UnsavedChangesGuard() {
  const shouldBlock = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) => hasUnsavedChanges() && currentLocation.pathname !== nextLocation.pathname,
    [],
  );
  const blocker = useBlocker(shouldBlock);

  useEffect(() => {
    purgeExpiredDrafts();
    function onBeforeUnload(event: BeforeUnloadEvent): void {
      if (!hasUnsavedChanges()) return;
      flushUnsavedDrafts();
      event.preventDefault();
      // Older browsers show the warning only when returnValue is set.
      event.returnValue = '';
    }
    function onVisibilityChange(): void {
      // Phones may discard a hidden page without any unload event.
      if (document.visibilityState === 'hidden') flushUnsavedDrafts();
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('pagehide', flushUnsavedDrafts);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('pagehide', flushUnsavedDrafts);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  return (
    <ConfirmDialog
      open={blocker.state === 'blocked'}
      title="O‘zgarishlar saqlanmagan"
      message="Kiritganlaringiz saytga saqlanmagan. Qoralama shu qurilmada qoladi — formani qayta ochsangiz, tiklashni taklif qilamiz. Chiqasizmi?"
      confirmLabel="Chiqish"
      cancelLabel="Qolish"
      onConfirm={() => {
        flushUnsavedDrafts();
        blocker.proceed?.();
      }}
      onCancel={() => blocker.reset?.()}
    />
  );
}
