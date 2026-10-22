import { useQueries } from '@tanstack/react-query';
import { CalendarCheck, CheckCircle2, ChevronLeft, ChevronRight, Wheat } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { Farm } from '@/features/farms/api/farms.api';
import { formatQuantity } from '@/features/inventory/lib/labels';
import { queuedIssueFor, useOfflineQueue } from '@/features/offline/queue';
import { cn } from '@/shared/lib/cn';
import { formatDate, formatDateTime, formatInteger } from '@/shared/lib/format';
import { todayInTashkent } from '@/shared/lib/dates';
import { Decimal } from '@/shared/lib/decimal';
import { AsyncContent, Badge, Button, ButtonLink, Card, CardHeader, EmptyState, IconButton, Skeleton } from '@/shared/ui';
import type { Ration } from '../api/rations.api';
import { coverageFromIssues, dailyStatus, type DailyStatus } from '../lib/daily';
import { summarizeRation } from '../lib/ration-math';
import { issuesQuery, useRations } from '../model/rations.queries';
import { ISSUE_ACTION_LABEL, IssueRationDialog } from './IssueRationDialog';

function Slide({
  ration,
  status,
  today,
  queued,
  onConfirm,
}: {
  ration: Ration;
  status: DailyStatus;
  today: string;
  /** "Berildi" pressed offline, waiting in the queue — not saved yet. */
  queued: boolean;
  onConfirm: () => void;
}) {
  const enough = summarizeRation({ ...ration, days: 1 }).sufficient;
  const archived = ration.items.filter((line) => line.item.archivedAt !== null);
  const perDay = ration.items
    .map((line) => {
      const amount = Decimal.from(line.dailyPerAnimal).mul(Decimal.from(ration.animalCount));
      return `${line.item.name} ${formatQuantity(amount.toString(), line.item.unit)}`;
    })
    .join(' · ');
  return (
    <div
      className={cn(
        'flex h-full flex-col gap-2.5 rounded-[14px] border p-3.5 sm:gap-3 sm:p-4',
        status.given ? 'border-success/30 bg-success-light/60' : 'border-line bg-background',
      )}
    >
      <div className="min-w-0">
        <Link to={`/feed-calculator/rations/${ration.id}`} className="block truncate font-semibold text-ink hover:underline">
          {ration.name}
        </Link>
        <p className="text-[13px] text-ink-secondary">
          {ration.animalType.name} · {formatInteger(ration.animalCount)} bosh
        </p>
      </div>
      <p className="text-[13px] text-ink">
        <span className="text-ink-secondary">Kunlik: </span>
        {perDay}
      </p>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
        {status.given ? (
          <Badge tone="success">
            <CheckCircle2 aria-hidden className="size-4" />
            {status.coveredUntil && status.coveredUntil > today
              ? `Berildi · ${formatDate(status.coveredUntil)} gacha`
              : `Bugun berildi · ${formatDateTime(status.issuedAt).split(' ').pop() ?? ''}`}
          </Badge>
        ) : queued ? (
          <Badge tone="warning">Navbatda — internet kutilmoqda (hali saqlanmagan)</Badge>
        ) : archived.length > 0 ? (
          <Badge tone="danger">Yem arxivlangan: {archived.map((line) => line.item.name).join(', ')}</Badge>
        ) : (
          <Badge tone={enough ? 'warning' : 'danger'}>{enough ? 'Hali berilmagan' : 'Omborda yetmaydi'}</Badge>
        )}
        {status.given || queued ? null : (
          <Button
            size="sm"
            icon={<CalendarCheck aria-hidden className="size-4" />}
            disabled={!enough || archived.length > 0}
            onClick={onConfirm}
          >
            {ISSUE_ACTION_LABEL}
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Dashboard's daily report: one slide per saved ration showing whether
 * today's feeding was given. "Berildi" is confirmed by issuing one day of
 * the ration from the warehouse — the issue is the record. A ration counts
 * as given while any of its issues covers today (not only the latest one).
 */
export function TodayRations({ farm }: { farm: Farm }) {
  const rations = useRations(farm.id);
  const today = todayInTashkent();
  const headingId = useId();
  const trackRef = useRef<HTMLUListElement>(null);
  const [active, setActive] = useState(0);
  const [confirming, setConfirming] = useState<Ration | null>(null);

  const list = rations.data?.items ?? [];
  const queue = useOfflineQueue((state) => state.ops);
  const histories = useQueries({ queries: list.map((ration) => issuesQuery(ration.id)) });
  // While a history is loading (or failed) the ration's latest issue decides.
  const statusOf = (ration: Ration, index: number): DailyStatus => {
    const issues = histories[index]?.data;
    return issues ? coverageFromIssues(issues.items, today) : dailyStatus(ration, today);
  };
  const given = list.filter((ration, index) => statusOf(ration, index).given).length;

  function slideWidth(): number {
    const first = trackRef.current?.firstElementChild as HTMLElement | null;
    return first ? first.offsetWidth + 12 : 1;
  }

  function goTo(index: number): void {
    const next = Math.max(0, Math.min(index, list.length - 1));
    setActive(next);
    trackRef.current?.scrollTo?.({ left: next * slideWidth(), behavior: 'smooth' });
  }

  return (
    <Card aria-labelledby={headingId}>
      <CardHeader
        title={<span id={headingId}>Bugungi ratsion</span>}
        description={
          list.length > 0
            ? `${formatDate(today)} · ${formatInteger(given)} / ${formatInteger(list.length)} ta ratsion berildi`
            : formatDate(today)
        }
        icon={<Wheat className="size-5" />}
        actions={
          list.length > 1 ? (
            <>
              <IconButton
                label="Oldingi ratsion"
                variant="secondary"
                icon={<ChevronLeft aria-hidden className="size-5" />}
                disabled={active === 0}
                onClick={() => goTo(active - 1)}
                className="size-9 max-sm:hidden"
                data-guest-ok
              />
              <IconButton
                label="Keyingi ratsion"
                variant="secondary"
                icon={<ChevronRight aria-hidden className="size-5" />}
                disabled={active >= list.length - 1}
                onClick={() => goTo(active + 1)}
                className="size-9 max-sm:hidden"
                data-guest-ok
              />
            </>
          ) : null
        }
      />
      <AsyncContent
        query={rations}
        collection
        loading={
          <div className="p-4 sm:p-5">
            <Skeleton className="h-36" />
          </div>
        }
        isEmpty={(data) => data.items.length === 0}
        empty={
          <EmptyState
            title="Ratsion hali tuzilmagan"
            description="Yem hisoblagichda ratsion tuzing — har kuni berilgan-berilmagani shu yerda ko‘rinadi."
            action={
              <ButtonLink to="/feed-calculator" variant="secondary">
                Ratsion tuzish
              </ButtonLink>
            }
          />
        }
      >
        {() => (
          <div className="py-3 sm:py-4">
            <ul
              ref={trackRef}
              aria-label="Bugungi ratsionlar"
              onScroll={(event) => setActive(Math.round(event.currentTarget.scrollLeft / slideWidth()))}
              className="flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-4 px-4 pb-1 [scrollbar-width:none] sm:scroll-px-5 sm:px-5 [&::-webkit-scrollbar]:hidden"
            >
              {list.map((ration, index) => (
                <li
                  key={ration.id}
                  aria-label={`${index + 1} / ${list.length}: ${ration.name}`}
                  className="w-[86%] shrink-0 snap-start sm:w-[calc(50%-6px)] xl:w-[calc(33.333%-8px)]"
                >
                  <Slide
                    ration={ration}
                    status={statusOf(ration, index)}
                    today={today}
                    queued={queuedIssueFor(queue, ration.id) !== undefined}
                    onConfirm={() => setConfirming(ration)}
                  />
                </li>
              ))}
            </ul>
            {list.length > 1 ? (
              <div className="mt-3 flex justify-center gap-1.5" aria-hidden>
                {list.map((ration, index) => (
                  <span
                    key={ration.id}
                    className={cn('h-1.5 rounded-full transition-all', index === active ? 'w-5 bg-primary' : 'w-1.5 bg-line')}
                  />
                ))}
              </div>
            ) : null}
          </div>
        )}
      </AsyncContent>
      {confirming ? <IssueRationDialog ration={confirming} daily onClose={() => setConfirming(null)} /> : null}
    </Card>
  );
}
