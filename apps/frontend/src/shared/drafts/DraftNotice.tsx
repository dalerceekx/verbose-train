import { HardDrive, RotateCcw, Trash2 } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { formatSavedTime } from '@/shared/lib/format';
import { Alert } from '@/shared/ui/Alert';
import { Button } from '@/shared/ui/Button';
import type { FormDraft } from './useFormDraft';

/**
 * Above a form: the offer to restore a draft found on this device, or —
 * while typing — when the input was last kept on the device. Always says
 * that a draft is not a save on the server.
 */
export function DraftNotice<T>({
  draft,
  onRestore,
  className,
}: {
  draft: FormDraft<T>;
  onRestore: (values: T) => void;
  className?: string;
}) {
  if (draft.offer) {
    const { savedAt, outdated } = draft.offer;
    return (
      <Alert tone="info" className={className} title={`Saqlanmagan qoralama topildi (${formatSavedTime(savedAt)})`}>
        <p>
          Bu kiritilganlar faqat shu qurilmada saqlangan — saytga yuborilmagan.
          {outdated ? ' Ma’lumot keyin o‘zgargan: tiklasangiz, yangi qiymatlar ustidan yoziladi.' : ''}
        </p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          <Button
            size="sm"
            icon={<RotateCcw aria-hidden className="size-4" />}
            onClick={() => {
              const values = draft.restore();
              if (values !== null) onRestore(values);
            }}
          >
            Tiklash
          </Button>
          <Button size="sm" variant="secondary" icon={<Trash2 aria-hidden className="size-4" />} onClick={draft.discard}>
            O‘chirish
          </Button>
        </div>
      </Alert>
    );
  }
  if (draft.savedAt) {
    return (
      <p className={cn('flex items-start gap-1.5 text-[13px] text-ink-secondary', className)}>
        <HardDrive aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>Qoralama shu qurilmada saqlandi · {formatSavedTime(draft.savedAt)} — saytga hali yuborilmagan</span>
      </p>
    );
  }
  return null;
}
