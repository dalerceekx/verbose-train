import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useCurrentUser } from '@/features/auth/hooks/useCurrentUser';
import { formatQuantity } from '@/features/inventory/lib/labels';
import { inventoryKeys } from '@/features/inventory/model/inventory.queries';
import { deviceOffline, queuedIssueFor, useOfflineQueue } from '@/features/offline/queue';
import { errorMessage, saveErrorMessage, toApiError } from '@/shared/api/errors';
import { useSubmitGuard } from '@/shared/hooks/useSubmitGuard';
import { addDays, todayInTashkent } from '@/shared/lib/dates';
import { Decimal } from '@/shared/lib/decimal';
import { formatDate, formatDateTime, formatSavedTime } from '@/shared/lib/format';
import { forgetIdempotencyKey, newIdempotencyKey, recoverIdempotencyKey, rememberIdempotencyKey } from '@/shared/lib/idempotency';
import { decimalProblem } from '@/shared/lib/validation';
import { Alert, Badge, Button, Checkbox, Field, FormError, Input, Modal, toast } from '@/shared/ui';
import type { Ration, RationIssue } from '../api/rations.api';
import { coverageFromIssues, overlappingIssues } from '../lib/daily';
import { issueAmount } from '../lib/ration-math';
import { issuesQuery, rationKeys, useIssueRation, useRationIssues } from '../model/rations.queries';

/** The one name of this action on the dashboard and on the ration page. */
export const ISSUE_ACTION_LABEL = 'Berildi (ombordan chiqarish)';

const DAYS_RULE = { maxIntegerDigits: 4, maxFractionDigits: 0, positive: true, max: '3650' };

interface ShortItem {
  inventoryItemId: string;
  name: string;
  required: string;
  available: string;
}

function shortItems(error: unknown): ShortItem[] {
  const apiError = toApiError(error);
  const items = apiError.code === 'INSUFFICIENT_STOCK' ? apiError.details?.items : undefined;
  return Array.isArray(items) ? (items as ShortItem[]) : [];
}

/**
 * The real consumption of N feeding days: every feed of the ration leaves
 * the warehouse in one all-or-nothing request. `daily` is the dashboard's
 * confirmation: exactly one day. Before anything is sent the dialog checks
 * the ration's issue history: days that an earlier issue already feeds are
 * named, and issuing them again needs an explicit "qo‘shimcha berish" tick —
 * the API itself does not refuse an overlap. A lost answer keeps its
 * Idempotency-Key for 10 minutes, so sending again — even after reopening
 * the dialog — is replayed by the server, never applied twice.
 */
export function IssueRationDialog({ ration, onClose, daily = false }: { ration: Ration; onClose: () => void; daily?: boolean }) {
  const queryClient = useQueryClient();
  const issue = useIssueRation();
  const history = useRationIssues(ration.id);
  const guard = useSubmitGuard();
  const { data: user } = useCurrentUser();
  const keyScope = `issue:${user?.id ?? 'me'}:${ration.id}`;
  const enqueue = useOfflineQueue((state) => state.enqueue);
  const queued = useOfflineQueue((state) => queuedIssueFor(state.ops, ration.id));
  const [recovered] = useState(() => recoverIdempotencyKey(keyScope));
  const sessionKey = useRef<string>(recovered ?? newIdempotencyKey());
  const snapshot = useRef<Set<string> | null>(null);
  const mounted = useRef(true);
  const [days, setDays] = useState('1');
  const [additional, setAdditional] = useState(false);
  const [lostAnswer, setLostAnswer] = useState(false);
  const today = todayInTashkent();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const problem = days.trim() ? decimalProblem(days, DAYS_RULE) : 'Kunlar sonini kiriting';
  const dayCount = problem ? null : Decimal.from(days);
  const presets = [...new Set(['1', '7', String(ration.days)])];

  const archivedLines = ration.items.filter((line) => line.item.archivedAt !== null);
  const lines = ration.items.map((line) => {
    const required = dayCount ? issueAmount(Decimal.from(line.dailyPerAnimal), Decimal.from(ration.animalCount), dayCount) : null;
    // An archived feed is no longer in the warehouse.
    const available = line.item.archivedAt ? Decimal.ZERO : Decimal.from(line.item.quantity);
    return { line, required, available, short: required ? required.gt(available) : false };
  });
  const anyShort = lines.some((line) => line.short);
  const serverShort = shortItems(issue.error);
  const unitOf = (id: string) => ration.items.find((line) => line.inventoryItemId === id)?.item.unit ?? 'KG';
  const nameOf = (id: string) => ration.items.find((line) => line.inventoryItemId === id)?.item.name ?? 'Yem';

  // The whole history when it loaded; otherwise at least the latest issue the ration itself knows.
  const historyKnown = history.isSuccess;
  const historyLoading = history.isPending && history.fetchStatus === 'fetching';
  const knownIssues: Array<Pick<RationIssue, 'id' | 'createdAt' | 'days' | 'movements'>> = historyKnown
    ? history.data.items
    : ration.lastIssue
      ? [{ ...ration.lastIssue, movements: [] }]
      : [];
  const overlaps = dayCount ? overlappingIssues(knownIssues, dayCount.toNumber(), today) : [];
  const [latestOverlap] = overlaps;
  const coverage = coverageFromIssues(knownIssues, today);
  // A "Berildi" made offline and not sent yet counts as given too.
  const needsConfirmation = overlaps.length > 0 || queued !== undefined;
  const blocked = !dayCount || anyShort || archivedLines.length > 0 || historyLoading || (needsConfirmation && !additional);

  async function verifySaved(issuedDays: number): Promise<void> {
    const before = snapshot.current;
    if (!before) return;
    try {
      const page = await queryClient.fetchQuery({ ...issuesQuery(ration.id), staleTime: 0 });
      const saved = page.items.find((candidate) => !before.has(candidate.id) && candidate.days === issuedDays);
      if (!saved) return;
      forgetIdempotencyKey(keyScope);
      void queryClient.invalidateQueries({ queryKey: rationKeys.all });
      void queryClient.invalidateQueries({ queryKey: inventoryKeys.all });
      toast.success(`Sarf allaqachon saqlangan (${formatSavedTime(saved.createdAt)}) — ikkinchi marta chiqarilmadi`);
      if (mounted.current) onClose();
    } catch {
      // Still no answer: the dialog explains what to do.
    }
  }

  async function submit(): Promise<void> {
    // The handler re-checks everything the disabled button reflects.
    if (blocked || !dayCount || !guard.begin()) return;
    const issuedDays = dayCount.toNumber();
    const key = sessionKey.current;
    // No network at all: kept on the device and sent when it is back — never shown as saved.
    if (deviceOffline()) {
      try {
        const saved = user
          ? await enqueue({
              kind: 'ration-issue',
              userId: user.id,
              farmId: ration.farmId,
              idempotencyKey: key,
              label: `Berildi: ${ration.name} (${issuedDays} kun)`,
              request: { rationId: ration.id, days: issuedDays },
            })
          : false;
        if (saved) {
          toast.info('Internet yo‘q: yozuv navbatga olindi va internet tiklanganda yuboriladi. Hali saytga saqlanmagan.');
          onClose();
        } else {
          toast.error('Internet yo‘q va yozuvni qurilmada saqlab bo‘lmadi — internet tiklangach qayta urining.');
        }
      } finally {
        guard.end();
      }
      return;
    }
    rememberIdempotencyKey(keyScope, key);
    snapshot.current = historyKnown ? new Set(history.data.items.map((item) => item.id)) : null;
    setLostAnswer(false);
    try {
      const result = await issue.mutateAsync({ id: ration.id, days: issuedDays, idempotencyKey: key });
      forgetIdempotencyKey(keyScope);
      toast.success(
        result.replayed
          ? 'Bu sarf avvalroq saqlangan ekan — ombordan ikkinchi marta chiqarilmadi'
          : daily
            ? `“${ration.name}” bugun berildi — ombordan chiqarildi`
            : `Ombordan chiqarildi: ${result.issue.days} kunlik ratsion`,
      );
      if (mounted.current) onClose();
    } catch (error) {
      const apiError = toApiError(error);
      const unknown =
        apiError.outcomeUnknown || apiError.code === 'IDEMPOTENCY_KEY_REUSED' || apiError.code === 'IDEMPOTENCY_KEY_IN_PROGRESS';
      if (!unknown) forgetIdempotencyKey(keyScope);
      if (!mounted.current) {
        toast.error(saveErrorMessage(error, 'Sarf'));
      } else if (unknown) {
        setLostAnswer(true);
        void verifySaved(issuedDays);
      }
    } finally {
      guard.end();
    }
  }

  const otherError =
    issue.error && !lostAnswer && serverShort.length === 0
      ? toApiError(issue.error).code === 'ISSUE_OVERLAP'
        ? errorMessage(issue.error)
        : saveErrorMessage(issue.error, 'Sarf')
      : null;
  const issuedItems = (movements: Array<{ itemId: string; quantity: string }>) =>
    movements
      .map((movement) => `${nameOf(movement.itemId)} ${formatQuantity(movement.quantity, unitOf(movement.itemId))}`)
      .join(', ');

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={daily ? `${ISSUE_ACTION_LABEL}: bugun` : ISSUE_ACTION_LABEL}
      description={
        daily
          ? `“${ration.name}”: bir kunlik yem ombordan chiqariladi va ratsion bugun “berildi” deb belgilanadi.`
          : `“${ration.name}”: haqiqatan berilgan yem ombordan chiqariladi. Saqlangan yozuvni o‘chirib bo‘lmaydi — xato bo‘lsa, inventarizatsiya bilan tuzatiladi.`
      }
      footer={
        <>
          {issue.isPending ? (
            <p className="text-[13px] text-ink-secondary sm:mr-auto sm:self-center">
              Yuborilmoqda… Oynani yopsangiz ham so‘rov davom etadi.
            </p>
          ) : null}
          <Button variant="secondary" onClick={onClose}>
            {issue.isPending ? 'Yopish' : 'Bekor qilish'}
          </Button>
          <Button onClick={() => void submit()} loading={issue.isPending} disabled={blocked}>
            Ombordan chiqarish
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="rounded-[10px] bg-background px-3 py-2.5 text-sm text-ink-secondary">
          {coverage.given && coverage.coveredUntil ? (
            <>
              Berilgan: <strong className="text-ink">{formatDate(coverage.coveredUntil)} gacha</strong>
              {coverage.issuedAt ? ` (oxirgi berish ${formatDateTime(coverage.issuedAt)})` : ''}
            </>
          ) : ration.lastIssue ? (
            <>
              Oxirgi berish: <strong className="text-ink">{formatDateTime(ration.lastIssue.createdAt)}</strong> ·{' '}
              {ration.lastIssue.days} kunlik — bugun uchun hali berilmagan
            </>
          ) : (
            'Bu ratsion hali ombordan berilmagan'
          )}
        </p>

        {daily ? null : (
          <div className="grid gap-3 sm:grid-cols-[200px_1fr] sm:items-end">
            <Field label="Necha kunlik sarf" error={days.trim() ? (problem ?? undefined) : undefined} required>
              <Input inputMode="numeric" autoComplete="off" value={days} onChange={(event) => setDays(event.target.value)} />
            </Field>
            <div className="flex flex-wrap gap-2">
              {presets.map((preset) => (
                <Button
                  key={preset}
                  size="sm"
                  variant={days === preset ? 'primary' : 'secondary'}
                  aria-pressed={days === preset}
                  onClick={() => setDays(preset)}
                >
                  {preset} kun
                </Button>
              ))}
            </div>
          </div>
        )}
        {dayCount && !daily ? (
          <p className="text-sm text-ink-secondary">
            Qaysi kunlar uchun: {formatDate(today)} — {formatDate(addDays(today, dayCount.toNumber() - 1))}
          </p>
        ) : null}

        {latestOverlap ? (
          <Alert tone="warning" title="Bu kunlar uchun allaqachon berilgan" urgent>
            <p>
              Bu ratsion {formatDateTime(latestOverlap.createdAt)} da {latestOverlap.days} kunga berilgan
              {latestOverlap.movements.length > 0 ? ` (${issuedItems(latestOverlap.movements)})` : ''}
              {overlaps.length > 1 ? ` va yana ${overlaps.length - 1} marta` : ''}. Yana chiqarsangiz, bu kunlar uchun sarf ikki
              baravar bo‘ladi.
            </p>
            <Checkbox
              className="mt-2.5"
              label="Bu qo‘shimcha berish — ataylab yana chiqaraman"
              checked={additional}
              onChange={(event) => {
                setAdditional(event.target.checked);
                // A deliberate extra issue is a new operation: it never reuses the key of an earlier attempt.
                if (event.target.checked) sessionKey.current = newIdempotencyKey();
              }}
            />
          </Alert>
        ) : null}
        {queued ? (
          <Alert tone="warning" title="Navbatda yuborilmagan berish bor" urgent>
            <p>
              {queued.label} — {formatDateTime(queued.createdAt)} da internetsiz kiritilgan, hali saytga yetib bormagan. Yana
              chiqarsangiz, bu kun uchun sarf ikki baravar bo‘ladi.
            </p>
            {latestOverlap ? null : (
              <Checkbox
                className="mt-2.5"
                label="Bu qo‘shimcha berish — ataylab yana chiqaraman"
                checked={additional}
                onChange={(event) => {
                  setAdditional(event.target.checked);
                  if (event.target.checked) sessionKey.current = newIdempotencyKey();
                }}
              />
            )}
          </Alert>
        ) : null}
        {history.isError ? (
          <Alert tone="info" title="Berishlar tarixi yuklanmadi">
            Faqat oxirgi berish bo‘yicha tekshirildi. Bu ratsionni boshqa qurilmadan ham bergan bo‘lsangiz, tarixni tekshiring.
          </Alert>
        ) : null}
        {recovered ? (
          <Alert tone="info" title="Oldingi urinishga javob kelmagan edi">
            Yana yuborsangiz, xavfsiz: sarf saqlangan bo‘lsa, ombordan ikkinchi marta chiqarilmaydi.
          </Alert>
        ) : null}
        {archivedLines.length > 0 ? (
          <Alert tone="danger" title="Ratsionda arxivlangan yem bor">
            {archivedLines.map((line) => line.item.name).join(', ')} — omborda yo‘q (arxivlangan). Ratsionni tahrirlab, boshqa yem
            tanlang.
          </Alert>
        ) : null}

        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">Ombordan chiqariladigan yemlar</caption>
          <thead>
            <tr className="border-b border-line text-[13px] text-ink-secondary">
              <th scope="col" className="py-2 pr-3 font-semibold">
                Yem
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-semibold">
                Chiqariladi
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-semibold">
                Omborda
              </th>
              <th scope="col" className="py-2 font-semibold">
                Holat
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map(({ line, required, available, short }) => (
              <tr key={line.inventoryItemId} className="border-b border-line last:border-b-0">
                <th scope="row" className="py-2 pr-3 font-medium text-ink">
                  {line.item.name}
                </th>
                <td className="py-2 pr-3 text-right tabular">
                  {required ? formatQuantity(required.toString(), line.item.unit) : '—'}
                </td>
                <td className="py-2 pr-3 text-right tabular">{formatQuantity(available.toString(), line.item.unit)}</td>
                <td className="py-2">
                  {line.item.archivedAt ? (
                    <Badge tone="neutral">Arxivlangan</Badge>
                  ) : short ? (
                    <Badge tone="danger">Yetmaydi</Badge>
                  ) : (
                    <Badge tone="success">Yetarli</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {anyShort && archivedLines.length === 0 ? (
          <Alert tone="warning" title="Omborda yetarli yem yo‘q">
            Kunlar sonini kamaytiring yoki avval omborga xarid qiling — sarf qisman chiqarilmaydi.
          </Alert>
        ) : null}
        {lostAnswer ? (
          <Alert tone="warning" title="Javob kelmadi" urgent>
            Sarf saqlangan bo‘lishi mumkin — shu oynada qayta urining yoki tarixni tekshiring. Qayta yuborish xavfsiz: ombordan
            ikki marta chiqarilmaydi.
          </Alert>
        ) : null}
        {serverShort.length > 0 ? (
          <Alert tone="danger" title="Ombordagi qoldiq o‘zgargan">
            <ul className="mt-1 flex flex-col gap-0.5">
              {serverShort.map((item) => (
                <li key={item.inventoryItemId}>
                  {item.name}: kerak {formatQuantity(item.required, unitOf(item.inventoryItemId))}, bor{' '}
                  {formatQuantity(item.available, unitOf(item.inventoryItemId))}
                </li>
              ))}
            </ul>
          </Alert>
        ) : (
          <FormError message={otherError} />
        )}
      </div>
    </Modal>
  );
}
