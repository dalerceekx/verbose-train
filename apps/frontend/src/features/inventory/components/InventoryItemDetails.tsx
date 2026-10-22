import { Archive, ArrowLeft, History, Minus, PackageOpen, Pencil, Plus, Scale, ShoppingCart } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useCurrentUser } from '@/features/auth/hooks/useCurrentUser';
import { FEED_STATUS_LABELS, type FeedAvailability } from '@/features/rations/lib/feed-availability';
import { useFeedAvailability } from '@/features/rations/model/useFeedAvailability';
import { errorMessage } from '@/shared/api/errors';
import { cn } from '@/shared/lib/cn';
import { Decimal } from '@/shared/lib/decimal';
import { formatDate, formatDateTime, formatDecimal, formatInteger, formatMoney } from '@/shared/lib/format';
import {
  Alert,
  AsyncContent,
  Badge,
  Button,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  DataTable,
  DescriptionList,
  EmptyState,
  Pagination,
  SegmentedTabs,
  toast,
  type Column,
} from '@/shared/ui';
import type { InventoryItem, StockMovement } from '../api/inventory.api';
import { expiryStatus, EXPIRY_LABELS } from '../lib/expiry';
import {
  CATEGORY_LABELS,
  formatQuantity,
  isIncoming,
  MOVEMENT_KIND_LABELS,
  movementKind,
  UNIT_NAMES,
  UNIT_SHORT,
  type MovementKind,
} from '../lib/labels';
import { isLowStock, stockValue } from '../lib/stock-math';
import { MOVEMENTS_PAGE_SIZE, useAllItemMovements, useInventoryItem, useOpenItem } from '../model/inventory.queries';
import { ArchiveItemDialog } from './ArchiveItemDialog';
import { ItemFormDialog } from './ItemFormDialog';
import { INTENT_BUTTON_LABELS, MovementDialog, type MovementIntent } from './MovementDialog';

type HistoryFilter = 'all' | 'purchase' | 'ration' | 'adjustment';

const FILTER_KINDS: Record<Exclude<HistoryFilter, 'all'>, readonly MovementKind[]> = {
  purchase: ['purchase'],
  ration: ['ration'],
  adjustment: ['adjustment-in', 'adjustment-out'],
};

const KIND_TONES: Record<MovementKind, 'success' | 'warning' | 'neutral' | 'primary'> = {
  purchase: 'success',
  intake: 'success',
  opening: 'primary',
  ration: 'warning',
  consumption: 'warning',
  'adjustment-in': 'neutral',
  'adjustment-out': 'neutral',
};

function MovementHistory({ item }: { item: InventoryItem }) {
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const movements = useAllItemMovements(item.id);
  const { data: user } = useCurrentUser();
  const rows = useMemo(() => {
    const all = movements.data?.items ?? [];
    return filter === 'all' ? all : all.filter((movement) => FILTER_KINDS[filter].includes(movementKind(movement)));
  }, [movements.data, filter]);

  const columns: Column<StockMovement>[] = [
    { key: 'date', header: 'Sana', cell: (movement) => formatDateTime(movement.createdAt) },
    {
      key: 'type',
      header: 'Turi',
      cell: (movement) => {
        const kind = movementKind(movement);
        return <Badge tone={KIND_TONES[kind]}>{MOVEMENT_KIND_LABELS[kind]}</Badge>;
      },
    },
    {
      key: 'quantity',
      header: 'Miqdor',
      align: 'right',
      cell: (movement) => (
        <span className={cn('font-semibold', isIncoming(movement.type) ? 'text-success' : 'text-ink')}>
          {isIncoming(movement.type) ? '+' : '−'}
          {formatQuantity(movement.quantity, item.unit)}
        </span>
      ),
    },
    { key: 'balance', header: 'Qoldiq', align: 'right', cell: (movement) => formatQuantity(movement.balanceAfter, item.unit) },
    {
      key: 'sum',
      header: 'Summa',
      align: 'right',
      cell: (movement) =>
        movement.unitCost ? formatMoney(Decimal.from(movement.quantity).mul(Decimal.from(movement.unitCost))) : '—',
    },
    // Ration issues carry "Ratsion: <name> — <N> kun"; a farmer's note is shown as typed.
    { key: 'reason', header: 'Sabab / izoh', cell: (movement) => movement.reason ?? '—' },
    {
      key: 'actor',
      header: 'Kim',
      hideOnMobile: true,
      cell: (movement) => (user && movement.actorId === user.id ? 'Siz' : 'Boshqa foydalanuvchi'),
    },
  ];

  return (
    <>
      <div className="border-b border-line px-4 py-3 sm:px-5">
        <SegmentedTabs<HistoryFilter>
          label="Harakatlarni saralash"
          value={filter}
          onChange={(next) => {
            setFilter(next);
            setPage(1);
          }}
          tabs={[
            { value: 'all', label: 'Barchasi' },
            { value: 'purchase', label: 'Xaridlar' },
            { value: 'ration', label: 'Ratsion sarfi' },
            { value: 'adjustment', label: 'Tuzatishlar' },
          ]}
        />
      </div>
      <AsyncContent
        query={movements}
        collection
        isEmpty={() => rows.length === 0}
        empty={
          <EmptyState
            title={filter === 'all' ? 'Hali harakatlar yo‘q' : 'Bu turdagi harakatlar yo‘q'}
            description={filter === 'all' ? 'Birinchi xarid yoki kirimni kiriting.' : 'Boshqa turni tanlang.'}
          />
        }
      >
        {(data) => (
          <>
            {data.truncated ? (
              <Alert tone="warning" className="m-4">
                Tarix juda uzun — eng so‘nggi {formatInteger(data.items.length)} ta yozuv ko‘rsatilmoqda.
              </Alert>
            ) : null}
            <DataTable
              caption="Ombor harakatlari tarixi"
              columns={columns}
              rows={rows.slice((page - 1) * MOVEMENTS_PAGE_SIZE, page * MOVEMENTS_PAGE_SIZE)}
              rowKey={(movement) => movement.id}
            />
            <Pagination page={page} limit={MOVEMENTS_PAGE_SIZE} total={rows.length} onPageChange={setPage} />
          </>
        )}
      </AsyncContent>
    </>
  );
}

/** "4 kunga yetadi · kuniga jami 100 kg (Otkorm: 100 kg)" — only when saved rations use the feed. */
function Coverage({ item, availability }: { item: InventoryItem; availability: FeedAvailability }) {
  if (!availability.dailyNeed || !availability.daysCovered) {
    return availability.demands.length === 0 ? (
      <p className="text-sm text-ink-secondary">
        Bu yem saqlangan ratsionlarda ishlatilmaydi — “Kam qoldi” faqat minimal qoldiq bo‘yicha.
      </p>
    ) : null;
  }
  return (
    <p className="text-sm text-ink-secondary">
      <strong className="text-ink">{formatInteger(availability.daysCovered.toNumber())} kunga yetadi</strong> · kuniga jami{' '}
      {formatQuantity(availability.dailyNeed.toString(), item.unit)} (
      {availability.demands
        .map((demand) => `${demand.rationName}: ${formatDecimal(demand.daily)} ${UNIT_SHORT[item.unit]}`)
        .join(', ')}
      )
    </p>
  );
}

function FeedStatus({ item }: { item: InventoryItem }) {
  const feed = useFeedAvailability(item.farmId);
  const availability = feed.of(item);
  const days = availability.daysCovered && availability.status !== 'empty' ? availability.daysCovered.toNumber() : null;
  return (
    <>
      <Badge tone={availability.status === 'empty' ? 'danger' : availability.status === 'low' ? 'warning' : 'success'}>
        {FEED_STATUS_LABELS[availability.status]}
        {days !== null ? ` · ${formatInteger(days)} kunga yetadi` : ''}
      </Badge>
      {feed.daysKnown ? (
        <div className="basis-full">
          <Coverage item={item} availability={availability} />
        </div>
      ) : null}
    </>
  );
}

export function InventoryItemDetails({ itemId, backTo, backLabel }: { itemId: string; backTo: string; backLabel: string }) {
  const navigate = useNavigate();
  const item = useInventoryItem(itemId);
  const openItem = useOpenItem();
  const [movement, setMovement] = useState<MovementIntent | null>(null);
  const [editing, setEditing] = useState(false);
  const [opening, setOpening] = useState(false);
  const [archiving, setArchiving] = useState(false);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <ButtonLink to={backTo} variant="ghost" size="sm" icon={<ArrowLeft aria-hidden className="size-4" />}>
          {backLabel}
        </ButtonLink>
      </div>
      <AsyncContent query={item}>
        {(data) => {
          const empty = Decimal.parse(data.quantity)?.isZero() ?? true;
          const isFeed = data.category === 'FEED';
          const expiry = expiryStatus(data);
          const value = stockValue(data);
          return (
            <>
              <Card>
                <CardHeader
                  title={
                    <span className="flex flex-wrap items-center gap-2">
                      {data.name}
                      {data.archivedAt ? <Badge tone="neutral">Arxivda</Badge> : null}
                    </span>
                  }
                  description={`${CATEGORY_LABELS[data.category]} · ${UNIT_NAMES[data.unit]}`}
                  icon={<Scale className="size-5" />}
                  actions={
                    data.archivedAt ? null : (
                      <>
                        <Button icon={<ShoppingCart aria-hidden className="size-4" />} onClick={() => setMovement('purchase')}>
                          {INTENT_BUTTON_LABELS.purchase}
                        </Button>
                        <Button
                          variant="secondary"
                          icon={<Plus aria-hidden className="size-4" />}
                          onClick={() => setMovement('intake')}
                        >
                          {INTENT_BUTTON_LABELS.intake}
                        </Button>
                        <Button
                          variant="secondary"
                          icon={<Minus aria-hidden className="size-4" />}
                          disabled={empty}
                          onClick={() => setMovement('consumption')}
                        >
                          {INTENT_BUTTON_LABELS.consumption}
                        </Button>
                      </>
                    )
                  }
                />
                <CardBody className="flex flex-col gap-5">
                  {data.archivedAt ? (
                    <Alert tone="info" title={`Arxivlangan · ${formatDate(data.archivedAt)}`}>
                      Bu mahsulot faol omborda hisoblanmaydi (omborda 0) va ratsiondan berib bo‘lmaydi. Arxivlangan paytdagi
                      qoldiq: {formatQuantity(data.quantity, data.unit)} — faqat tarix uchun.
                    </Alert>
                  ) : (
                    <div className="flex flex-wrap items-end gap-x-8 gap-y-2">
                      <div>
                        <p className="text-sm text-ink-secondary">Hozirgi qoldiq</p>
                        <p className="text-3xl font-semibold tabular">{formatQuantity(data.quantity, data.unit)}</p>
                      </div>
                      {isFeed ? (
                        <FeedStatus item={data} />
                      ) : isLowStock(data) ? (
                        <Badge tone={empty ? 'danger' : 'warning'}>{empty ? 'Tugagan' : 'Kam qoldi'}</Badge>
                      ) : null}
                      {expiry !== 'NONE' && !isFeed ? (
                        <Badge tone={expiry === 'OK' ? 'success' : expiry === 'SOON' ? 'warning' : 'danger'}>
                          {EXPIRY_LABELS[expiry]}
                        </Badge>
                      ) : null}
                    </div>
                  )}
                  {expiry === 'EXPIRED' && !data.archivedAt ? (
                    <Alert tone="danger" title="Muddati o‘tgan" urgent>
                      Bu mahsulotni ishlatmang. Qoldiqni “Inventarizatsiya tuzatishi” orqali hisobdan chiqaring.
                    </Alert>
                  ) : null}
                  <DescriptionList
                    items={[
                      {
                        label: `1 ${UNIT_SHORT[data.unit]} narxi`,
                        value: data.unitPrice ? `${formatMoney(data.unitPrice)} (oxirgi xarid narxi)` : 'Kiritilmagan',
                      },
                      ...(data.archivedAt
                        ? []
                        : [
                            {
                              label: 'Ombor qiymati',
                              value: value ? `${formatMoney(value)} (oxirgi xarid narxida)` : 'Narx kiritilmagan',
                            },
                          ]),
                      {
                        label: 'Minimal qoldiq',
                        value: data.minQuantity ? formatQuantity(data.minQuantity, data.unit) : 'Belgilanmagan',
                      },
                      // Batch, expiry and opening belong to medicines, not to feed.
                      ...(isFeed
                        ? []
                        : [
                            { label: 'Partiya', value: data.batchNumber ?? '—' },
                            { label: 'Yaroqlilik muddati', value: formatDate(data.expiresOn) },
                            { label: 'Ochilgan', value: data.openedAt ? formatDateTime(data.openedAt) : 'Ochilmagan' },
                            {
                              label: 'Ochilgandan keyin',
                              value: data.useWithinDaysAfterOpening ? `${data.useWithinDaysAfterOpening} kun ichida` : '—',
                            },
                          ]),
                      { label: 'Yaratilgan', value: formatDateTime(data.createdAt) },
                      { label: 'Yangilangan', value: formatDateTime(data.updatedAt) },
                    ]}
                  />
                  {data.archivedAt ? null : (
                    <div className="flex flex-wrap gap-2 border-t border-line pt-4">
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<Scale aria-hidden className="size-4" />}
                        onClick={() => setMovement('adjustment')}
                      >
                        Inventarizatsiya tuzatishi
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<Pencil aria-hidden className="size-4" />}
                        onClick={() => setEditing(true)}
                      >
                        Tahrirlash
                      </Button>
                      {data.category === 'MEDICINE' && !data.openedAt ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={<PackageOpen aria-hidden className="size-4" />}
                          onClick={() => setOpening(true)}
                        >
                          Idish ochildi
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<Archive aria-hidden className="size-4" />}
                        onClick={() => setArchiving(true)}
                      >
                        Arxivlash
                      </Button>
                    </div>
                  )}
                </CardBody>
              </Card>

              <Card>
                <CardHeader
                  title="Harakatlar tarixi"
                  description="Har bir yozuvdan keyingi qoldiq"
                  icon={<History className="size-5" />}
                />
                <MovementHistory item={data} />
              </Card>

              {movement ? (
                <MovementDialog item={data} intent={movement} onClose={() => setMovement(null)} onSwitchIntent={setMovement} />
              ) : null}
              <ItemFormDialog
                open={editing}
                onClose={() => setEditing(false)}
                farmId={data.farmId}
                category={data.category}
                item={data}
                onAdjustQuantity={() => setMovement('adjustment')}
              />
              <ArchiveItemDialog
                item={archiving ? data : null}
                onClose={() => setArchiving(false)}
                onArchived={() => navigate(backTo)}
                onAdjust={() => setMovement('adjustment')}
              />
              <ConfirmDialog
                open={opening}
                title="Idish ochilganini belgilash"
                message="Ochilgan sana bir marta belgilanadi va o‘zgartirib bo‘lmaydi."
                confirmLabel="Ha, ochildi"
                tone="primary"
                loading={openItem.isPending}
                error={openItem.error ? errorMessage(openItem.error) : null}
                onCancel={() => {
                  setOpening(false);
                  openItem.reset();
                }}
                onConfirm={() => {
                  if (openItem.isPending) return;
                  openItem.mutate(data.id, {
                    onSuccess: () => {
                      toast.success('Ochilgan sana belgilandi');
                      setOpening(false);
                    },
                  });
                }}
              />
            </>
          );
        }}
      </AsyncContent>
    </div>
  );
}
