import { Calculator, History, Layers, PawPrint, Plus, Receipt, Wallet, Warehouse, Wheat } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { Species } from '@/features/animals/api/animals.api';
import { SPECIES_LABELS } from '@/features/animals/lib/labels';
import { useAnimalCounts } from '@/features/animals/model/animals.queries';
import { useCurrentUser } from '@/features/auth/hooks/useCurrentUser';
import { EXPENSES_ANCHOR, ExpensesPanel } from '@/features/expenses/components/Expenses';
import { TodayRations } from '@/features/rations/components/TodayRations';
import type { Farm } from '@/features/farms/api/farms.api';
import { RecentMovements } from '@/features/inventory/components/RecentMovements';
import { formatQuantity } from '@/features/inventory/lib/labels';
import { currentMonthRange, inRange, purchasesOf, sumAmounts } from '@/features/inventory/lib/ledger';
import { formatTotals, stockValue, totalsByUnit } from '@/features/inventory/lib/stock-math';
import { useLedger } from '@/features/inventory/model/inventory.queries';
import { FEED_STATUS_LABELS, type FeedStatus } from '@/features/rations/lib/feed-availability';
import { useFeedAvailability } from '@/features/rations/model/useFeedAvailability';
import { Decimal } from '@/shared/lib/decimal';
import { formatInteger, formatMoney } from '@/shared/lib/format';
import {
  Alert,
  Badge,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  ErrorState,
  OfflineState,
  queryLoadState,
  Skeleton,
  StatCard,
} from '@/shared/ui';
import { BarList } from '@/shared/ui/charts';

const EXPENSES_LINK = `/dashboard#${EXPENSES_ANCHOR}`;
const STATUS_RANK: Record<FeedStatus, number> = { empty: 0, low: 1, ok: 2 };

/**
 * "Qoramol: 4 · Qo‘y: 4 · yana 3 tur (4 bosh)": the breakdown always adds up
 * to the total shown above it.
 */
export function speciesSummary(rows: ReadonlyArray<{ species: Species; count: number }>): string {
  const shown = rows.length <= 3 ? rows : rows.slice(0, 2);
  const rest = rows.slice(shown.length);
  const parts = shown.map((row) => `${SPECIES_LABELS[row.species]}: ${formatInteger(row.count)}`);
  if (rest.length > 0) {
    parts.push(`yana ${rest.length} tur (${formatInteger(rest.reduce((sum, row) => sum + row.count, 0))} bosh)`);
  }
  return parts.join(' · ');
}

function QuickAction({ to, icon, label, description }: { to: string; icon: ReactNode; label: string; description: string }) {
  return (
    <Link
      to={to}
      className="flex min-h-14 items-center gap-2.5 rounded-[14px] border border-line bg-card px-3 py-2.5 shadow-card transition-colors hover:border-primary-hover hover:bg-primary-light/40 sm:min-h-[76px] sm:gap-3 sm:px-4 sm:py-3"
    >
      <span
        aria-hidden
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-primary text-ink sm:size-11 sm:rounded-[12px]"
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm leading-tight font-semibold text-ink sm:text-base">{label}</span>
        {/* Two actions share a row on a phone: the label alone says enough. */}
        <span className="hidden text-[13px] text-ink-secondary sm:block">{description}</span>
      </span>
    </Link>
  );
}

export function FarmerDashboard({ farm }: { farm: Farm }) {
  const { data: user } = useCurrentUser();
  const counts = useAnimalCounts(farm.id);
  const availability = useFeedAvailability(farm.id);
  const feed = availability.items;
  const ledger = useLedger(farm.id);
  const feedState = queryLoadState(feed);
  const ledgerState = queryLoadState(ledger);

  const feedItems = useMemo(() => feed.data?.items ?? [], [feed.data]);
  // Opening balances are not purchases: only real buying is this month's spending.
  const purchases = useMemo(() => purchasesOf(ledger.data?.movements ?? []), [ledger.data]);
  const monthRange = currentMonthRange();
  const monthSpend = sumAmounts(purchases.filter((purchase) => inRange(purchase.movement, monthRange)));
  let stockWorth = Decimal.ZERO;
  for (const item of feedItems) stockWorth = stockWorth.add(stockValue(item) ?? Decimal.ZERO);

  const speciesRows = counts.bySpecies.filter((row) => row.count > 0).sort((a, b) => b.count - a.count);
  // Empty and low feeds first, then those that last the fewest days or are the smallest.
  const lowFeed = [...feedItems]
    .sort((a, b) => {
      const first = availability.of(a);
      const second = availability.of(b);
      if (first.status !== second.status) return STATUS_RANK[first.status] - STATUS_RANK[second.status];
      if (first.daysCovered && second.daysCovered) return first.daysCovered.compare(second.daysCovered);
      return Decimal.from(a.quantity).compare(Decimal.from(b.quantity));
    })
    .slice(0, 5);
  const runningOut = availability.lowItems.filter((item) => availability.of(item).runsOutSoon);
  const firstName = user?.fullName.split(' ')[0] ?? '';

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <p className="text-ink-secondary">
        Assalomu alaykum{firstName ? `, ${firstName}` : ''}! <span className="text-ink">{farm.name}</span> bo‘yicha bugungi holat.
      </p>

      {/* Today's feeding is the daily task: first thing on the page. */}
      <TodayRations farm={farm} />

      {runningOut.length > 0 ? (
        <Alert tone="warning" title="Yem tez orada tugaydi">
          <ul className="mt-1 flex flex-col gap-0.5">
            {runningOut.map((item) => {
              const info = availability.of(item);
              return (
                <li key={item.id}>
                  <Link to={`/feed/${item.id}`} className="font-medium text-ink hover:underline">
                    {item.name}
                  </Link>{' '}
                  {formatInteger(info.daysCovered?.toNumber() ?? 0)} kunga yetadi (
                  {info.demands.map((demand) => demand.rationName).join(', ')})
                </li>
              );
            })}
          </ul>
        </Alert>
      ) : null}

      <section aria-label="Asosiy ko‘rsatkichlar" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard
          icon={<PawPrint className="size-5" />}
          label="Jami hayvonlar"
          value={counts.total === undefined ? '—' : formatInteger(counts.total)}
          secondary={speciesRows.length > 0 ? speciesSummary(speciesRows) : 'Hali hayvon yo‘q'}
          loading={counts.isPending && !counts.isPaused}
          failed={Boolean(counts.error) || counts.isPaused}
          to="/animals"
        />
        <StatCard icon={<Layers className="size-5" />} label="Hayvon guruhlari" value="—" unavailable to="/animal-groups" />
        <StatCard
          icon={<Warehouse className="size-5" />}
          label="Yem zaxirasi"
          value={<span className="text-[17px] sm:text-[24px]">{formatTotals(totalsByUnit(feedItems))}</span>}
          secondary={`${formatInteger(feedItems.length)} turdagi yem · qiymati ${formatMoney(stockWorth)} (oxirgi narxda)`}
          {...feedState}
          to="/feed"
        />
        <StatCard
          icon={<Wallet className="size-5" />}
          label="Oylik xarid xarajati"
          value={<span className="text-[17px] sm:text-[24px]">{formatMoney(monthSpend)}</span>}
          secondary="Shu oy narxli xaridlar · boshlang‘ich qoldiq kirmaydi"
          {...ledgerState}
          to={EXPENSES_LINK}
        />
      </section>

      <section aria-label="Tezkor amallar" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <QuickAction
          to="/animals?new=1"
          icon={<Plus className="size-5" />}
          label="Hayvon qo‘shish"
          description="Yangi bosh ro‘yxatga"
        />
        <QuickAction to="/feed?new=1" icon={<Wheat className="size-5" />} label="Yem qo‘shish" description="Yangi yem turi" />
        <QuickAction
          to="/feed-calculator"
          icon={<Calculator className="size-5" />}
          label="Yem hisoblash"
          description="Miqdor va narx"
        />
        <QuickAction
          to={EXPENSES_LINK}
          icon={<Receipt className="size-5" />}
          label="Xarid kiritish"
          description="Xaridlar va xarajatlar"
        />
      </section>

      <div className="grid gap-4 sm:gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Hayvonlar bo‘yicha qisqacha"
            icon={<PawPrint className="size-5" />}
            actions={
              <ButtonLink to="/animals" variant="ghost" size="sm">
                Barchasi
              </ButtonLink>
            }
          />
          <CardBody>
            {counts.error ? (
              <ErrorState error={counts.error} collection onRetry={counts.refetch} />
            ) : counts.isPaused ? (
              <OfflineState />
            ) : counts.isPending ? (
              <Skeleton className="h-32" />
            ) : speciesRows.length === 0 ? (
              <p className="py-6 text-center text-ink-secondary">Hali hayvon qo‘shilmagan.</p>
            ) : (
              <BarList
                label="Hayvonlar turi bo‘yicha"
                max={counts.total}
                items={speciesRows.map((row) => ({
                  key: row.species,
                  label: (
                    <Link to={`/animals?species=${row.species}`} className="hover:underline">
                      {SPECIES_LABELS[row.species]}
                    </Link>
                  ),
                  value: row.count,
                  display: `${formatInteger(row.count)} bosh`,
                }))}
              />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Yem ombori holati"
            description="Eng kam qolgan yemlar"
            icon={<Warehouse className="size-5" />}
            actions={
              <ButtonLink to="/feed" variant="ghost" size="sm">
                Omborga o‘tish
              </ButtonLink>
            }
          />
          <CardBody>
            {feed.isError ? (
              <ErrorState error={feed.error} collection onRetry={() => void feed.refetch()} />
            ) : feedState.failed ? (
              <OfflineState />
            ) : feed.isPending ? (
              <Skeleton className="h-32" />
            ) : lowFeed.length === 0 ? (
              <p className="py-6 text-center text-ink-secondary">Omborda hali yem yo‘q.</p>
            ) : (
              <ul className="divide-y divide-line">
                {lowFeed.map((item) => {
                  const info = availability.of(item);
                  return (
                    <li key={item.id}>
                      <Link to={`/feed/${item.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:text-ink">
                        <span className="font-medium">{item.name}</span>
                        <span className="flex flex-wrap items-center justify-end gap-2 tabular">
                          {info.status !== 'ok' ? (
                            <Badge tone={info.status === 'empty' ? 'danger' : 'warning'}>
                              {FEED_STATUS_LABELS[info.status]}
                              {info.status === 'low' && info.daysCovered
                                ? ` · ${formatInteger(info.daysCovered.toNumber())} kunga`
                                : ''}
                            </Badge>
                          ) : null}
                          {formatQuantity(item.quantity, item.unit)}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>

        {/* Spans both columns so the 3-card grid leaves no empty cell. */}
        <Card className="lg:col-span-2">
          <CardHeader title="Yaqindagi ombor harakatlari" icon={<History className="size-5" />} />
          {ledger.isError ? (
            <ErrorState error={ledger.error} collection onRetry={() => void ledger.refetch()} />
          ) : ledgerState.failed ? (
            <OfflineState />
          ) : ledger.isPending ? (
            <div className="p-4 sm:p-5">
              <Skeleton className="h-32" />
            </div>
          ) : (
            <RecentMovements movements={ledger.data.movements.slice(0, 6)} />
          )}
        </Card>
      </div>

      <ExpensesPanel farm={farm} />
    </div>
  );
}
