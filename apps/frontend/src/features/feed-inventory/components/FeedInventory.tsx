import {
  Archive,
  Calculator,
  Coins,
  History,
  Minus,
  Package,
  Pencil,
  Plus,
  ShoppingCart,
  TriangleAlert,
  Warehouse,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import type { Farm } from '@/features/farms/api/farms.api';
import type { InventoryItem } from '@/features/inventory/api/inventory.api';
import { ArchiveItemDialog } from '@/features/inventory/components/ArchiveItemDialog';
import { ItemFormDialog } from '@/features/inventory/components/ItemFormDialog';
import { INTENT_BUTTON_LABELS, MovementDialog, type MovementIntent } from '@/features/inventory/components/MovementDialog';
import { RecentMovements } from '@/features/inventory/components/RecentMovements';
import { formatQuantity, UNIT_SHORT } from '@/features/inventory/lib/labels';
import { formatTotals, stockValue, totalsByUnit } from '@/features/inventory/lib/stock-math';
import { useLedger } from '@/features/inventory/model/inventory.queries';
import { FEED_STATUS_LABELS, LOW_STOCK_DAYS, type FeedAvailability } from '@/features/rations/lib/feed-availability';
import { useFeedAvailability } from '@/features/rations/model/useFeedAvailability';
import { Decimal } from '@/shared/lib/decimal';
import { formatInteger, formatMoney } from '@/shared/lib/format';
import {
  Alert,
  AsyncContent,
  Badge,
  Button,
  ButtonLink,
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  ErrorState,
  IconButton,
  OfflineState,
  queryLoadState,
  Skeleton,
  StatCard,
  type Column,
} from '@/shared/ui';

const RECENT_LIMIT = 8;

const isEmpty = (item: InventoryItem) => Decimal.parse(item.quantity)?.isZero() ?? true;

const STATUS_TONES = { empty: 'danger', low: 'warning', ok: 'success' } as const;

function StockBadge({ availability }: { availability: FeedAvailability }) {
  return <Badge tone={STATUS_TONES[availability.status]}>{FEED_STATUS_LABELS[availability.status]}</Badge>;
}

/** Why a feed is low, in the farmer's words. */
function lowReason(item: InventoryItem, availability: FeedAvailability): string {
  const parts: string[] = [];
  if (availability.runsOutSoon && availability.daysCovered) {
    parts.push(
      `${formatInteger(availability.daysCovered.toNumber())} kunga yetadi (${availability.demands.map((demand) => demand.rationName).join(', ')})`,
    );
  }
  if (availability.belowMinimum && item.minQuantity) parts.push(`minimal ${formatQuantity(item.minQuantity, item.unit)}`);
  return parts.length > 0 ? ` — ${parts.join('; ')}` : '';
}

/**
 * "Yem — omborni boshqarish": every feed with its balance, how many days it
 * lasts for the saved rations, unit price and value; purchase, intake (no
 * purchase), consumption, edit and archive with confirmation.
 */
export function FeedInventory({ farm }: { farm: Farm }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const feed = useFeedAvailability(farm.id);
  const items = feed.items;
  const feedItems = useMemo(() => items.data?.items ?? [], [items.data]);
  const ledger = useLedger(farm.id, 'FEED');
  const [movement, setMovement] = useState<{ item: InventoryItem; intent: MovementIntent } | null>(null);
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [archiving, setArchiving] = useState<InventoryItem | null>(null);
  const creating = params.get('new') === '1';
  const itemsState = queryLoadState(items);

  function setCreating(open: boolean): void {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (open) next.set('new', '1');
      else next.delete('new');
      return next;
    });
  }

  let totalValue = Decimal.ZERO;
  let unpriced = 0;
  for (const item of feedItems) {
    const value = stockValue(item);
    if (value) totalValue = totalValue.add(value);
    else unpriced += 1;
  }

  const columns: Column<InventoryItem>[] = [
    { key: 'name', header: 'Yem nomi', cell: (item) => <span className="font-semibold">{item.name}</span> },
    { key: 'quantity', header: 'Miqdori', align: 'right', cell: (item) => formatQuantity(item.quantity, item.unit) },
    {
      key: 'days',
      header: 'Necha kunga',
      align: 'right',
      cell: (item) => {
        const days = feed.of(item).daysCovered;
        return days ? `${formatInteger(days.toNumber())} kun` : '—';
      },
    },
    {
      key: 'price',
      header: '1 kg narxi',
      align: 'right',
      cell: (item) => (item.unitPrice ? `${formatMoney(item.unitPrice)}/${UNIT_SHORT[item.unit]}` : '—'),
    },
    {
      key: 'value',
      header: 'Qiymati',
      align: 'right',
      cell: (item) => {
        const value = stockValue(item);
        return value ? formatMoney(value) : '—';
      },
    },
    { key: 'status', header: 'Holat', cell: (item) => <StockBadge availability={feed.of(item)} /> },
    {
      key: 'actions',
      header: <span className="sr-only">Amallar</span>,
      align: 'right',
      mobileFooter: true,
      cell: (item) => (
        <div className="flex flex-wrap items-center gap-1.5 md:justify-end">
          <Button
            size="sm"
            icon={<ShoppingCart aria-hidden className="size-4" />}
            onClick={() => setMovement({ item, intent: 'purchase' })}
          >
            {INTENT_BUTTON_LABELS.purchase}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon={<Plus aria-hidden className="size-4" />}
            onClick={() => setMovement({ item, intent: 'intake' })}
          >
            {INTENT_BUTTON_LABELS.intake}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon={<Minus aria-hidden className="size-4" />}
            onClick={() => setMovement({ item, intent: 'consumption' })}
            disabled={isEmpty(item)}
          >
            {INTENT_BUTTON_LABELS.consumption}
          </Button>
          <IconButton
            label={`${item.name}: tahrirlash`}
            icon={<Pencil aria-hidden className="size-4" />}
            onClick={() => setEditing(item)}
          />
          <IconButton
            label={`${item.name}: arxivlash`}
            icon={<Archive aria-hidden className="size-4" />}
            onClick={() => setArchiving(item)}
          />
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* Compact cards: 2 × 2 on a phone, one row on a wide screen. */}
      <section aria-label="Yem ombori ko‘rsatkichlari" className="grid grid-cols-2 gap-2.5 lg:grid-cols-4 lg:gap-4">
        <StatCard
          compact
          icon={<Package className="size-5" />}
          label="Yem turlari"
          value={formatInteger(feedItems.length)}
          {...itemsState}
        />
        <StatCard
          compact
          icon={<Warehouse className="size-5" />}
          label="Umumiy qoldiq"
          value={formatTotals(totalsByUnit(feedItems))}
          {...itemsState}
        />
        <StatCard
          compact
          icon={<Coins className="size-5" />}
          label="Ombor qiymati"
          value={formatMoney(totalValue)}
          secondary={unpriced > 0 ? `Oxirgi xarid narxida · ${unpriced} ta narxsiz` : 'Oxirgi xarid narxida'}
          {...itemsState}
        />
        <StatCard
          compact
          icon={<TriangleAlert className="size-5" />}
          label="Kam qolgan yemlar"
          value={formatInteger(feed.lowItems.length)}
          secondary={feed.daysKnown ? `${LOW_STOCK_DAYS} kundan kam yoki minimaldan past` : 'Minimal qoldiq bo‘yicha'}
          {...itemsState}
        />
      </section>

      {feed.lowItems.length > 0 ? (
        <Alert tone="warning" title={`${feed.lowItems.length} ta yem kam qoldi`}>
          <ul className="mt-1 flex flex-col gap-0.5">
            {feed.lowItems.map((item) => (
              <li key={item.id}>
                {item.name}: <strong className="tabular">{formatQuantity(item.quantity, item.unit)}</strong>
                {isEmpty(item) ? ' — tugagan' : lowReason(item, feed.of(item))}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <Card>
        <CardHeader
          title="Yem mahsulotlari"
          description={`Ferma: ${farm.name}`}
          icon={<Warehouse className="size-5" />}
          actions={
            <>
              <ButtonLink to="/feed-calculator" variant="secondary" icon={<Calculator aria-hidden className="size-5" />}>
                Ratsion hisoblash
              </ButtonLink>
              <Button icon={<Plus aria-hidden className="size-5" />} onClick={() => setCreating(true)}>
                Yem qo‘shish
              </Button>
            </>
          }
        />
        <AsyncContent
          query={items}
          collection
          isEmpty={() => feedItems.length === 0}
          empty={
            <EmptyState
              title="Omborda hali yem yo‘q"
              description="Yem nomi, miqdori va 1 kg narxini kiriting — istalgancha yem turi qo‘shish mumkin."
              action={
                <Button icon={<Plus aria-hidden className="size-5" />} onClick={() => setCreating(true)}>
                  Yem qo‘shish
                </Button>
              }
            />
          }
        >
          {() => (
            <DataTable
              caption="Yem mahsulotlari"
              columns={columns}
              rows={feedItems}
              rowKey={(item) => item.id}
              onRowClick={(item) => navigate(`/feed/${item.id}`)}
            />
          )}
        </AsyncContent>
      </Card>

      <Card>
        <CardHeader title="Yaqindagi ombor harakatlari" icon={<History className="size-5" />} />
        {ledger.isError ? (
          <ErrorState error={ledger.error} collection onRetry={() => void ledger.refetch()} />
        ) : ledger.isPending && ledger.fetchStatus === 'paused' ? (
          <OfflineState />
        ) : ledger.isPending ? (
          <div className="flex flex-col gap-3 p-5">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : (
          <RecentMovements movements={ledger.data.movements.slice(0, RECENT_LIMIT)} />
        )}
      </Card>

      <ItemFormDialog open={creating} onClose={() => setCreating(false)} farmId={farm.id} category="FEED" />
      <ItemFormDialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        farmId={farm.id}
        category="FEED"
        item={editing}
        onAdjustQuantity={() => editing && setMovement({ item: editing, intent: 'adjustment' })}
      />
      {movement ? (
        <MovementDialog
          item={movement.item}
          intent={movement.intent}
          onClose={() => setMovement(null)}
          onSwitchIntent={(intent) => setMovement({ item: movement.item, intent })}
        />
      ) : null}
      <ArchiveItemDialog
        item={archiving}
        onClose={() => setArchiving(null)}
        onAdjust={() => archiving && setMovement({ item: archiving, intent: 'adjustment' })}
      />
    </div>
  );
}
