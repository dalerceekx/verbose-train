import { useState } from 'react';
import type { AnimalDetails } from '@/features/animals/api/animals.api';
import { VetOnlyBadge } from '@/features/diseases/components/DiseaseSafety';
import { formatQuantity } from '@/features/inventory/lib/labels';
import { useInventoryItems } from '@/features/inventory/model/inventory.queries';
import { saveErrorMessage } from '@/shared/api/errors';
import { useSubmitGuard } from '@/shared/hooks/useSubmitGuard';
import { Decimal } from '@/shared/lib/decimal';
import { formatDate, formatDecimal } from '@/shared/lib/format';
import { newIdempotencyKey } from '@/shared/lib/idempotency';
import { decimalProblem, normalizeDecimal } from '@/shared/lib/validation';
import { AsyncContent, Button, EmptyState, Field, FormError, Input, Modal, Select, Textarea, toast } from '@/shared/ui';
import type { Recommendation } from '../api/treatments.api';
import { DOSE_UNIT_LABELS, ROUTE_LABELS } from '../lib/labels';
import { useRecommendations, useStartTreatment } from '../model/treatments.queries';

/** Backend limit for animalWeightKg: > 0, at most 5 000 kg, 2 decimals. */
const WEIGHT_RULE = { maxIntegerDigits: 4, maxFractionDigits: 2, positive: true, max: '5000' };

function ProtocolOption({
  recommendation,
  selected,
  onSelect,
}: {
  recommendation: Recommendation;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <label
      aria-label={recommendation.title}
      className={
        selected
          ? 'flex cursor-pointer gap-3 rounded-[12px] border-2 border-primary-hover bg-primary-light/40 p-3'
          : 'flex cursor-pointer gap-3 rounded-[12px] border border-line p-3 hover:border-input-line'
      }
    >
      <input
        type="radio"
        name="protocol"
        className="mt-1 size-4 accent-[var(--primary-hover)]"
        checked={selected}
        onChange={onSelect}
      />
      <span className="min-w-0">
        <span className="block font-semibold text-ink">{recommendation.title}</span>
        <span className="block text-[13px] text-ink-secondary">
          {recommendation.condition} · {recommendation.version}-versiya
          {recommendation.approvedAt ? ` · tasdiqlangan ${formatDate(recommendation.approvedAt)}` : ''}
        </span>
        <span className="mt-1.5 flex flex-col gap-1 text-[13px] text-ink">
          {recommendation.drugs.map((drug) => (
            <span key={drug.medicineId} className="flex flex-wrap items-center gap-1.5">
              {drug.medicineName}: {formatDecimal(drug.dosePerKg, { maxFractionDigits: 4 })} {DOSE_UNIT_LABELS[drug.doseUnit]}/kg
              · {ROUTE_LABELS[drug.route]} · kuniga {drug.frequencyPerDay} marta · {drug.durationDays} kun
              {drug.route === 'IV' ? <VetOnlyBadge /> : null}
            </span>
          ))}
        </span>
      </span>
    </label>
  );
}

/**
 * Starts a treatment from a protocol a veterinarian approved — the only kind
 * the API accepts (emergencies never get one). The server computes every dose
 * from the weight; the farmer only picks the protocol, confirms the weight
 * and, optionally, which medicine of the pharmacy is used.
 */
export function StartTreatmentDialog({ animal, onClose }: { animal: AnimalDetails; onClose: () => void }) {
  const recommendations = useRecommendations(animal.species, true);
  const stock = useInventoryItems(animal.farmId, 'MEDICINE');
  const start = useStartTreatment();
  const guard = useSubmitGuard();
  const [idempotencyKey] = useState(newIdempotencyKey);
  const [versionId, setVersionId] = useState('');
  const [weight, setWeight] = useState(animal.weightKg ? Decimal.from(animal.weightKg).toString() : '');
  const [itemFor, setItemFor] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  const [tried, setTried] = useState(false);

  const chosen = recommendations.data?.items.find((recommendation) => recommendation.versionId === versionId) ?? null;
  const weightProblem = weight.trim() ? decimalProblem(weight, WEIGHT_RULE) : 'Hayvon vaznini kiriting';
  const notesProblem = notes.trim().length > 1000 ? 'Ko‘pi bilan 1000 ta belgi' : null;
  const invalid = !chosen || weightProblem !== null || notesProblem !== null;
  const usableStock = (medicineId: string) =>
    (stock.data?.items ?? []).filter(
      (item) => item.medicineId === medicineId && !item.archivedAt && !(Decimal.parse(item.quantity)?.isZero() ?? true),
    );

  async function submit(): Promise<void> {
    setTried(true);
    if (invalid || !chosen || !guard.begin()) return;
    try {
      const items = chosen.drugs.flatMap((drug) => {
        const inventoryItemId = itemFor[drug.medicineId];
        return inventoryItemId ? [{ medicineId: drug.medicineId, inventoryItemId }] : [];
      });
      await start.mutateAsync({
        body: {
          animalId: animal.id,
          protocolVersionId: chosen.versionId,
          animalWeightKg: normalizeDecimal(weight),
          ...(items.length > 0 ? { items } : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        },
        idempotencyKey,
      });
      toast.success('Davolash boshlandi — dozalar avtomatik hisoblandi');
      onClose();
    } catch {
      // Shown in the dialog (FormError).
    } finally {
      guard.end();
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`Davolashni boshlash: ${animal.tagNumber}`}
      description="Faqat veterinar tasdiqlagan sxemalar. Dozani tizim hayvon vazni bo‘yicha hisoblaydi."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Bekor qilish
          </Button>
          <Button
            onClick={() => void submit()}
            loading={start.isPending}
            disabled={(tried && invalid) || !recommendations.data?.items.length}
          >
            Davolashni boshlash
          </Button>
        </>
      }
    >
      <AsyncContent
        query={recommendations}
        collection
        isEmpty={(data) => data.items.length === 0}
        empty={
          <EmptyState
            title="Tasdiqlangan davolash sxemalari hali yo‘q"
            description="Bu tur uchun veterinar tasdiqlagan sxema yo‘q. Davolashni veterinar bilan kelishing — sayt dozani o‘zi taklif qilmaydi."
          />
        }
      >
        {(data) => (
          <div className="flex flex-col gap-4">
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium text-ink">
                Sxema
                <span className="ml-0.5 text-danger" aria-hidden>
                  *
                </span>
              </legend>
              {data.items.map((recommendation) => (
                <ProtocolOption
                  key={recommendation.versionId}
                  recommendation={recommendation}
                  selected={recommendation.versionId === versionId}
                  onSelect={() => {
                    setVersionId(recommendation.versionId);
                    setItemFor({});
                  }}
                />
              ))}
              {tried && !chosen ? <p className="text-[13px] font-medium text-danger">Sxemani tanlang</p> : null}
            </fieldset>
            <Field label="Hayvon vazni (kg)" required error={tried || weight.trim() ? (weightProblem ?? undefined) : undefined}>
              <Input inputMode="decimal" autoComplete="off" value={weight} onChange={(event) => setWeight(event.target.value)} />
            </Field>
            {chosen
              ? chosen.drugs.map((drug) => {
                  const options = usableStock(drug.medicineId);
                  return (
                    <Field
                      key={drug.medicineId}
                      label={`${drug.medicineName}: ombordagi dori`}
                      hint={options.length === 0 ? 'Omborda bu dori (katalogga bog‘langan) yo‘q — ixtiyoriy' : 'Ixtiyoriy'}
                    >
                      <Select
                        value={itemFor[drug.medicineId] ?? ''}
                        disabled={options.length === 0}
                        onChange={(event) => setItemFor((current) => ({ ...current, [drug.medicineId]: event.target.value }))}
                      >
                        <option value="">Tanlanmagan</option>
                        {options.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name} — {formatQuantity(item.quantity, item.unit)}
                            {item.expiresOn ? ` · ${formatDate(item.expiresOn)} gacha` : ''}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  );
                })
              : null}
            <Field label="Izoh (alomatlar, kasallik)" hint="Ixtiyoriy" error={notesProblem ?? undefined}>
              <Textarea rows={2} maxLength={1000} value={notes} onChange={(event) => setNotes(event.target.value)} />
            </Field>
            <p className="text-[13px] text-ink-secondary">
              Dori qoldig‘i avtomatik kamaymaydi — berilgan dorini «Dori ombori»da «Sarf» bilan yozing.
            </p>
            <FormError message={start.error ? saveErrorMessage(start.error, 'Davolash') : null} />
          </div>
        )}
      </AsyncContent>
    </Modal>
  );
}
