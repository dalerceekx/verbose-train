import { Archive, ArrowLeft, Calculator, Copy, History, PackageMinus, Pencil, Wheat } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { formatQuantity } from '@/features/inventory/lib/labels';
import { errorMessage } from '@/shared/api/errors';
import { todayInTashkent } from '@/shared/lib/dates';
import { formatDate, formatDateTime, formatDecimal, formatInteger } from '@/shared/lib/format';
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
  DescriptionList,
  EmptyState,
  toast,
} from '@/shared/ui';
import type { Ration } from '../api/rations.api';
import { additionalIssueIds, coverageFromIssues, dailyStatus, issuePeriod } from '../lib/daily';
import { FIELD_LABELS, PURPOSE_LABELS, STATE_LABELS } from '../lib/labels';
import { rationLines } from '../lib/ration-math';
import { useArchiveRation, useCopyRation, useRation, useRationIssues } from '../model/rations.queries';
import { ISSUE_ACTION_LABEL, IssueRationDialog } from './IssueRationDialog';
import { RationResultView } from './RationResultView';

function IssueHistory({ ration }: { ration: Ration }) {
  const issues = useRationIssues(ration.id);
  const itemOf = (id: string) => ration.items.find((line) => line.inventoryItemId === id)?.item;
  return (
    <AsyncContent
      query={issues}
      collection
      isEmpty={(data) => data.items.length === 0}
      empty={
        <EmptyState
          icon={<History className="size-6" />}
          title="Hali sarf chiqarilmagan"
          description={`“${ISSUE_ACTION_LABEL}” bilan haqiqatan berilgan yemni ombordan yozing.`}
        />
      }
    >
      {(data) => {
        const additional = additionalIssueIds(data.items);
        return (
          <ul aria-label="Sarf tarixi" className="divide-y divide-line">
            {data.items.map((issue) => {
              const period = issuePeriod(issue);
              return (
                <li key={issue.id} className="px-5 py-3">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium text-ink">
                    {formatDateTime(issue.createdAt)} · {formatInteger(issue.days)} kunlik · {formatInteger(issue.animalCount)}{' '}
                    bosh
                    {additional.has(issue.id) ? <Badge tone="warning">Qo‘shimcha berish</Badge> : null}
                  </p>
                  <p className="text-[13px] text-ink-secondary">
                    Kunlar:{' '}
                    {period.from === period.to
                      ? formatDate(period.from)
                      : `${formatDate(period.from)} — ${formatDate(period.to)}`}
                  </p>
                  <p className="text-[13px] text-ink-secondary">
                    {issue.movements
                      .map((movement) => {
                        const item = itemOf(movement.itemId);
                        return `${item?.name ?? 'Yem'}: −${item ? formatQuantity(movement.quantity, item.unit) : movement.quantity}`;
                      })
                      .join(' · ')}
                  </p>
                </li>
              );
            })}
          </ul>
        );
      }}
    </AsyncContent>
  );
}

/** "Berilgan: 28.10.2026 gacha" from the whole issue history. */
function CoverageNote({ ration }: { ration: Ration }) {
  const issues = useRationIssues(ration.id);
  const today = todayInTashkent();
  const status = issues.data ? coverageFromIssues(issues.data.items, today) : dailyStatus(ration, today);
  if (!status.given || !status.coveredUntil) {
    return <Badge tone="warning">Bugun hali berilmagan</Badge>;
  }
  return (
    <Badge tone="success">
      {status.coveredUntil > today ? `Berildi · ${formatDate(status.coveredUntil)} gacha` : 'Bugun berildi'}
    </Badge>
  );
}

/** A saved ration: its results with today's stock and prices, actions and issue history. */
export function RationDetails({ rationId }: { rationId: string }) {
  const navigate = useNavigate();
  const ration = useRation(rationId);
  const copy = useCopyRation();
  const archive = useArchiveRation();
  const [issuing, setIssuing] = useState(false);
  const [removing, setRemoving] = useState(false);

  return (
    <AsyncContent query={ration}>
      {(data) => {
        const backTo = `/feed-calculator/types/${data.animalTypeId}`;
        const archived = data.archivedAt !== null;
        const archivedFeeds = data.items.filter((line) => line.item.archivedAt !== null);
        return (
          <div className="flex flex-col gap-5">
            <div>
              <ButtonLink to={backTo} variant="ghost" size="sm" icon={<ArrowLeft aria-hidden className="size-4" />}>
                {data.animalType.name} ratsionlari
              </ButtonLink>
            </div>

            <Card>
              <CardHeader
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    {data.name}
                    {archived ? <Badge tone="neutral">Arxivlangan</Badge> : <CoverageNote ration={data} />}
                  </span>
                }
                description={`${data.animalType.name} · ${PURPOSE_LABELS[data.purpose]}`}
                icon={<Wheat className="size-5" />}
              />
              <CardBody className="flex flex-col gap-5">
                {archivedFeeds.length > 0 && !archived ? (
                  <Alert tone="warning" title="Ratsionda arxivlangan yem bor">
                    {archivedFeeds.map((line) => line.item.name).join(', ')} — omborda yo‘q (arxivlangan), shuning uchun bu
                    ratsionni ombordan berib bo‘lmaydi. Ratsionni tahrirlab, boshqa yem tanlang.
                  </Alert>
                ) : null}
                <DescriptionList
                  items={[
                    { label: 'Hayvonlar soni', value: `${formatInteger(data.animalCount)} ta` },
                    { label: 'Oziqlantirish muddati', value: `${formatInteger(data.days)} kun` },
                    { label: 'Boqish maqsadi', value: PURPOSE_LABELS[data.purpose] },
                    {
                      label: 'Fiziologik holati',
                      value: data.physiologicalState ? STATE_LABELS[data.physiologicalState] : 'Ko‘rsatilmagan',
                    },
                    {
                      label: FIELD_LABELS.averageWeightKg,
                      value: data.averageWeightKg ? `${formatDecimal(data.averageWeightKg)} kg` : '—',
                    },
                    { label: FIELD_LABELS.ageMonths, value: data.ageMonths !== null ? `${data.ageMonths} oy` : '—' },
                    ...(data.milkYieldLiters
                      ? [{ label: FIELD_LABELS.milkYieldLiters, value: `${formatDecimal(data.milkYieldLiters)} l` }]
                      : []),
                    ...(data.notes ? [{ label: 'Izoh', value: data.notes }] : []),
                  ]}
                />
                <div className="flex flex-wrap gap-2 border-t border-line pt-4">
                  {archived ? null : (
                    <>
                      <ButtonLink
                        to={`/feed-calculator/rations/${data.id}/edit`}
                        icon={<Pencil aria-hidden className="size-4" />}
                      >
                        Ratsionni tahrirlash
                      </ButtonLink>
                      <Button
                        variant="secondary"
                        icon={<PackageMinus aria-hidden className="size-4" />}
                        onClick={() => setIssuing(true)}
                      >
                        {ISSUE_ACTION_LABEL}
                      </Button>
                      <Button
                        variant="secondary"
                        icon={<Copy aria-hidden className="size-4" />}
                        loading={copy.isPending}
                        onClick={() =>
                          copy.mutate(data.id, {
                            onSuccess: (created) => {
                              toast.success(`Nusxa yaratildi: “${created.name}”`);
                              navigate(`/feed-calculator/rations/${created.id}`);
                            },
                            onError: (error) => toast.error(errorMessage(error)),
                          })
                        }
                      >
                        Nusxalash
                      </Button>
                      <Button variant="ghost" icon={<Archive aria-hidden className="size-4" />} onClick={() => setRemoving(true)}>
                        Arxivlash
                      </Button>
                    </>
                  )}
                  <ButtonLink to={backTo} variant="ghost" icon={<ArrowLeft aria-hidden className="size-4" />}>
                    Orqaga
                  </ButtonLink>
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title="Ratsion natijalari"
                description="Ombor qoldig‘i va narxlar — hozirgi holat bo‘yicha"
                icon={<Calculator className="size-5" />}
              />
              <CardBody>
                <RationResultView
                  typeName={data.animalType.name}
                  animalCount={data.animalCount}
                  days={data.days}
                  lines={rationLines(data)}
                />
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title="Sarf tarixi"
                description="Ombordan haqiqatan chiqarilgan yem"
                icon={<History className="size-5" />}
              />
              <IssueHistory ration={data} />
            </Card>

            {issuing ? <IssueRationDialog ration={data} onClose={() => setIssuing(false)} /> : null}
            <ConfirmDialog
              open={removing}
              title={`“${data.name}” ratsionini arxivlash`}
              message="Ratsion ro‘yxatdan olinadi (arxivlanadi). Ombordan chiqarilgan sarf tarixi saqlanib qoladi."
              confirmLabel="Arxivlash"
              loading={archive.isPending}
              error={archive.error ? errorMessage(archive.error) : null}
              onCancel={() => {
                setRemoving(false);
                archive.reset();
              }}
              onConfirm={() => {
                if (archive.isPending) return;
                archive.mutate(data.id, {
                  onSuccess: () => {
                    toast.success('Ratsion arxivlandi');
                    navigate(backTo);
                  },
                });
              }}
            />
          </div>
        );
      }}
    </AsyncContent>
  );
}
