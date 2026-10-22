import { Pill } from 'lucide-react';
import { useId, useMemo } from 'react';
import { Link } from 'react-router';
import { useActiveFarm } from '@/features/farms/model/active-farm';
import { formatTotals, totalsByUnit } from '@/features/inventory/lib/stock-math';
import { useInventoryItems } from '@/features/inventory/model/inventory.queries';
import { useMedicineCatalog } from '@/features/medicines/model/medicines.queries';
import { todayInTashkent } from '@/shared/lib/dates';
import { Badge, ButtonLink, ErrorState, Skeleton, type BadgeTone } from '@/shared/ui';
import type { DiseaseDetails } from '../api/diseases.api';
import { medicinesInTreatment, stockFor, type MedicineStock, type TreatmentMedicine } from '../lib/treatment-medicines';

const STATE_BADGE: Record<MedicineStock['state'], { tone: BadgeTone; label: string }> = {
  available: { tone: 'success', label: 'Bor' },
  similar: { tone: 'warning', label: 'Nomi o‘xshash — tekshiring' },
  expired: { tone: 'warning', label: 'Muddati o‘tgan' },
  empty: { tone: 'warning', label: 'Tugagan' },
  missing: { tone: 'danger', label: 'Yo‘q' },
};

function StockRow({ row }: { row: MedicineStock }) {
  const badge = STATE_BADGE[row.state];
  const [first] = row.items;
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2.5">
      <span className="min-w-0">
        {first ? (
          <Link to={`/medicines/stock/${first.id}`} className="font-medium text-ink hover:underline">
            {row.medicine.name}
          </Link>
        ) : (
          <span className="font-medium text-ink">{row.medicine.name}</span>
        )}
        {row.state === 'similar' ? (
          <span className="block text-[13px] text-ink-secondary">
            Omborda: {row.items.map((item) => `${item.name}${item.medicineId ? '' : ' (katalogga bog‘lanmagan)'}`).join(', ')}
          </span>
        ) : null}
      </span>
      <Badge tone={badge.tone}>
        {row.state === 'available' ? `${badge.label} · ${formatTotals(totalsByUnit(row.items))}` : badge.label}
      </Badge>
    </li>
  );
}

function StockList({ farmId, medicines }: { farmId: string; medicines: TreatmentMedicine[] }) {
  const items = useInventoryItems(farmId, 'MEDICINE');
  // Approved catalog: "Bor" is confirmed through it, never by a similar name.
  const catalog = useMedicineCatalog();
  const today = todayInTashkent();

  if (items.isPending || (catalog.isPending && catalog.fetchStatus === 'fetching')) return <Skeleton className="h-28" />;
  if (items.isError) return <ErrorState error={items.error} collection onRetry={() => void items.refetch()} />;

  const approved = (catalog.data ?? []).filter((medicine) => medicine.status === 'APPROVED');
  const rows = medicines.map((medicine) => stockFor(medicine, items.data.items, today, approved));
  const available = rows.filter((row) => row.state === 'available').length;
  const similar = rows.filter((row) => row.state === 'similar').length;
  return (
    <>
      <p className="text-sm text-ink-secondary">
        Sxemadagi {medicines.length} ta doridan {available} tasi dorixonangizda bor
        {similar > 0 ? `, ${similar} tasining faqat nomi o‘xshash — tekshiring` : ''}.
      </p>
      <ul className="divide-y divide-line">
        {rows.map((row) => (
          <StockRow key={row.medicine.name} row={row} />
        ))}
      </ul>
    </>
  );
}

/**
 * After the treatment text: which of the medicines it names the farm's
 * pharmacy (inventory, category MEDICINE) has. Matched by name; the scheme
 * text and the veterinarian decide what is actually given.
 */
export function TreatmentStock({ lines }: { lines: DiseaseDetails['lines'] }) {
  const headingId = useId();
  const medicines = useMemo(() => medicinesInTreatment(lines), [lines]);
  const { farmsQuery, activeFarm } = useActiveFarm();
  if (medicines.length === 0) return null;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3 rounded-[12px] border border-line p-3.5">
      <h3 id={headingId} className="flex items-center gap-2 font-semibold text-ink">
        <Pill aria-hidden className="size-[18px]" />
        Dorixonangizda bormi?
      </h3>
      {activeFarm ? (
        <StockList farmId={activeFarm.id} medicines={medicines} />
      ) : farmsQuery.isPending ? (
        <Skeleton className="h-28" />
      ) : (
        <p className="text-sm text-ink-secondary">Dorixonani ko‘rish uchun avval ferma qo‘shing.</p>
      )}
      <p className="text-[13px] text-ink-muted">
        «Bor» faqat ombordagi dori tasdiqlangan katalogdagi aynan shu doriga bog‘langan bo‘lsa chiqadi. Nomi o‘xshash dori boshqa
        konsentratsiyada bo‘lishi mumkin — veterinar bilan tekshiring; dori omboriga qo‘shishda «Katalogdagi dori»ni tanlang.
        «Bittasi tanlanadi» deyilgan joyda ulardan biri yetadi.
      </p>
      <div>
        <ButtonLink to="/medicines" variant="secondary" size="sm" icon={<Pill aria-hidden className="size-4" />}>
          Dori omboriga o‘tish
        </ButtonLink>
      </div>
    </section>
  );
}
