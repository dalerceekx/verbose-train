import { useQueryClient } from '@tanstack/react-query';
import { Scale } from 'lucide-react';
import { useState } from 'react';
import { rationKeys, useRations } from '@/features/rations/model/rations.queries';
import { errorMessage } from '@/shared/api/errors';
import { useSubmitGuard } from '@/shared/hooks/useSubmitGuard';
import { Decimal } from '@/shared/lib/decimal';
import { Alert, Button, Checkbox, ConfirmDialog, toast } from '@/shared/ui';
import type { InventoryItem } from '../api/inventory.api';
import { formatQuantity } from '../lib/labels';
import { useArchiveItem } from '../model/inventory.queries';

interface ArchiveItemDialogProps {
  item: InventoryItem | null;
  onClose: () => void;
  onArchived?: () => void;
  /** Opens the inventory count, to write the remaining stock off first. */
  onAdjust?: () => void;
}

/**
 * "Arxivlash" with everything the farmer must know first: the stock still in
 * the warehouse (it is not written off — the API has no such step, so it is
 * offered as a separate inventory count) and the saved rations that use the
 * feed (they can no longer be issued from the warehouse afterwards).
 */
export function ArchiveItemDialog({ item, onClose, onArchived, onAdjust }: ArchiveItemDialogProps) {
  const queryClient = useQueryClient();
  const archive = useArchiveItem();
  const guard = useSubmitGuard();
  const [understood, setUnderstood] = useState(false);
  const isFeed = item?.category === 'FEED';
  const rations = useRations(item?.farmId ?? '', undefined, isFeed);
  const usedIn =
    isFeed && item
      ? (rations.data?.items ?? []).filter((ration) => ration.items.some((line) => line.inventoryItemId === item.id))
      : [];
  const stock = Decimal.parse(item?.quantity) ?? Decimal.ZERO;
  const hasStock = !stock.isZero() && !stock.isNegative();
  const risky = hasStock || usedIn.length > 0;

  function close(): void {
    setUnderstood(false);
    archive.reset();
    onClose();
  }

  return (
    <ConfirmDialog
      open={item !== null}
      title={`“${item?.name ?? ''}”ni arxivlash`}
      message="Mahsulot ombor ro‘yxatidan olinadi. Kirim va sarf tarixi saqlanib qoladi."
      confirmLabel="Arxivlash"
      loading={archive.isPending}
      confirmDisabled={risky && !understood}
      error={archive.error ? errorMessage(archive.error) : null}
      onCancel={close}
      onConfirm={() => {
        if (!item || (risky && !understood) || !guard.begin()) return;
        archive.mutate(item.id, {
          onSuccess: () => {
            // Rations show the feed as archived (and stop issuing it) at once.
            void queryClient.invalidateQueries({ queryKey: rationKeys.all });
            toast.success(`“${item.name}” arxivlandi`);
            setUnderstood(false);
            onArchived?.();
            onClose();
          },
          onSettled: () => guard.end(),
        });
      }}
    >
      {item && hasStock ? (
        <Alert tone="warning" title={`Omborda ${formatQuantity(item.quantity, item.unit)} bor`}>
          <p>
            Arxivlansa, bu qoldiq faol ombor hisobidan chiqadi, lekin yo‘qotish yoki sarf sifatida yozilmaydi. Yem buzilgan yoki
            yo‘qolgan bo‘lsa, avval inventarizatsiya bilan qoldiqni tuzating.
          </p>
          {onAdjust ? (
            <Button
              size="sm"
              variant="secondary"
              className="mt-2"
              icon={<Scale aria-hidden className="size-4" />}
              onClick={() => {
                close();
                onAdjust();
              }}
            >
              Avval inventarizatsiya qilish
            </Button>
          ) : null}
        </Alert>
      ) : null}
      {usedIn.length > 0 ? (
        <Alert tone="warning" title={`${usedIn.length} ta ratsionda ishlatiladi`}>
          <p>{usedIn.map((ration) => ration.name).join(', ')}</p>
          <p className="mt-1">
            Arxivdan keyin bu ratsionlarni ombordan berib bo‘lmaydi — ratsionni tahrirlab, boshqa yem tanlang.
          </p>
        </Alert>
      ) : null}
      {risky ? (
        <Checkbox
          label="Tushundim, baribir arxivlash"
          checked={understood}
          onChange={(event) => setUnderstood(event.target.checked)}
        />
      ) : null}
    </ConfirmDialog>
  );
}
