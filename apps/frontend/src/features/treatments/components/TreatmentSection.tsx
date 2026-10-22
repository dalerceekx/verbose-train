import { Stethoscope } from 'lucide-react';
import { useId, useState } from 'react';
import type { AnimalDetails } from '@/features/animals/api/animals.api';
import { VetOnlyBadge } from '@/features/diseases/components/DiseaseSafety';
import { errorMessage } from '@/shared/api/errors';
import { formatDate, formatDateTime, formatDecimal } from '@/shared/lib/format';
import { AsyncContent, Badge, Button, ConfirmDialog, EmptyState, toast } from '@/shared/ui';
import { snapshotTitle, type Treatment } from '../api/treatments.api';
import { describeDose, TREATMENT_STATUS_LABELS } from '../lib/labels';
import { useAnimalTreatments, useFinishTreatment } from '../model/treatments.queries';
import { StartTreatmentDialog } from './StartTreatmentDialog';

const STATUS_TONES = { ACTIVE: 'warning', COMPLETED: 'success', CANCELLED: 'neutral' } as const;

function TreatmentRow({ treatment, onFinish }: { treatment: Treatment; onFinish: (outcome: 'complete' | 'cancel') => void }) {
  return (
    <li className="flex flex-col gap-1.5 py-3">
      <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
        {snapshotTitle(treatment) ?? 'Davolash'}
        <Badge tone={STATUS_TONES[treatment.status]}>{TREATMENT_STATUS_LABELS[treatment.status]}</Badge>
      </p>
      <p className="text-[13px] text-ink-secondary">
        Boshlangan: {formatDateTime(treatment.startedAt)} · tugaydi: {formatDate(treatment.endsOn)} · vazn{' '}
        {formatDecimal(treatment.animalWeightKg, { maxFractionDigits: 2 })} kg
      </p>
      <ul className="flex flex-col gap-1 text-sm text-ink">
        {treatment.doses.map((dose) => (
          <li key={dose.id} className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium">{dose.medicineName}:</span> {describeDose(dose)}
            {dose.route === 'IV' ? <VetOnlyBadge /> : null}
          </li>
        ))}
      </ul>
      {treatment.notes ? <p className="text-[13px] text-ink-secondary">Izoh: {treatment.notes}</p> : null}
      <p className="text-[13px] text-warning">{treatment.warning}</p>
      {treatment.status === 'ACTIVE' ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => onFinish('complete')}>
            Tugallash
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onFinish('cancel')}>
            Bekor qilish
          </Button>
        </div>
      ) : null}
    </li>
  );
}

/**
 * An animal's treatments (the vet module of the API): history with the doses
 * the server computed and the withdrawal warning, starting one from an
 * approved protocol, and finishing it. Medicine stock is not changed here —
 * the API does not do that yet, so the farmer records it as "Sarf".
 */
export function TreatmentSection({ animal }: { animal: AnimalDetails }) {
  const headingId = useId();
  const treatments = useAnimalTreatments(animal.id);
  const finish = useFinishTreatment();
  const [starting, setStarting] = useState(false);
  const [finishing, setFinishing] = useState<{ treatment: Treatment; outcome: 'complete' | 'cancel' } | null>(null);

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3 border-t border-line pt-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={headingId} className="font-semibold text-ink">
          Davolash tarixi
        </h3>
        {animal.archivedAt ? null : (
          <Button size="sm" icon={<Stethoscope aria-hidden className="size-4" />} onClick={() => setStarting(true)}>
            Davolashni boshlash
          </Button>
        )}
      </div>
      <p className="text-[13px] text-ink-secondary">
        Faqat veterinar tasdiqlagan sxema bilan boshlanadi; dozani tizim hisoblaydi. Dori qoldig‘i avtomatik kamaymaydi — berilgan
        dorini «Dori ombori»da «Sarf» bilan yozing.
      </p>
      <AsyncContent
        query={treatments}
        collection
        isEmpty={(data) => data.items.length === 0}
        empty={<EmptyState title="Davolash yozuvlari yo‘q" description="Bu hayvon hali davolanmagan." />}
      >
        {(data) => (
          <ul aria-label="Davolashlar" className="divide-y divide-line">
            {data.items.map((treatment) => (
              <TreatmentRow
                key={treatment.id}
                treatment={treatment}
                onFinish={(outcome) => setFinishing({ treatment, outcome })}
              />
            ))}
          </ul>
        )}
      </AsyncContent>

      {starting ? <StartTreatmentDialog animal={animal} onClose={() => setStarting(false)} /> : null}
      <ConfirmDialog
        open={finishing !== null}
        title={finishing?.outcome === 'complete' ? 'Davolashni tugallash' : 'Davolashni bekor qilish'}
        message={
          finishing?.outcome === 'complete'
            ? 'Davolash tugallangan deb belgilanadi. Kutish muddati (go‘sht, sut) o‘zgarmaydi.'
            : 'Davolash bekor qilingan deb belgilanadi. Berilgan dorining kutish muddati baribir amal qiladi.'
        }
        confirmLabel={finishing?.outcome === 'complete' ? 'Tugallash' : 'Bekor qilish'}
        cancelLabel="Ortga"
        tone={finishing?.outcome === 'complete' ? 'primary' : 'danger'}
        loading={finish.isPending}
        error={finish.error ? errorMessage(finish.error) : null}
        onCancel={() => {
          setFinishing(null);
          finish.reset();
        }}
        onConfirm={() => {
          if (!finishing || finish.isPending) return;
          finish.mutate(
            { id: finishing.treatment.id, outcome: finishing.outcome },
            {
              onSuccess: () => {
                toast.success(finishing.outcome === 'complete' ? 'Davolash tugallandi' : 'Davolash bekor qilindi');
                setFinishing(null);
              },
            },
          );
        }}
      />
    </section>
  );
}
