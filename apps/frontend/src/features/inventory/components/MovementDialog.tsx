import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { ShoppingCart } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { useCurrentUser } from '@/features/auth/hooks/useCurrentUser';
import { deviceOffline, useOfflineQueue } from '@/features/offline/queue';
import { saveErrorMessage, toApiError, validationFieldErrors } from '@/shared/api/errors';
import { DraftNotice } from '@/shared/drafts/DraftNotice';
import { useFormDraft } from '@/shared/drafts/useFormDraft';
import { useSubmitGuard } from '@/shared/hooks/useSubmitGuard';
import { Decimal } from '@/shared/lib/decimal';
import { formatMoney, formatSavedTime } from '@/shared/lib/format';
import { forgetIdempotencyKey, newIdempotencyKey, recoverIdempotencyKey, rememberIdempotencyKey } from '@/shared/lib/idempotency';
import { decimalProblem, normalizeDecimal } from '@/shared/lib/validation';
import { Alert, Button, ConfirmDialog, Field, FormError, Input, Modal, Textarea, toast } from '@/shared/ui';
import { inventoryApi, type CreateMovementInput, type InventoryItem, type MovementType } from '../api/inventory.api';
import { formatQuantity, UNIT_SHORT } from '../lib/labels';
import { describeWeight, parseWeightInput, WEIGHT_INPUT_UNITS, type WeightInputUnit } from '../lib/units';
import { inventoryKeys, MOVEMENTS_PAGE_SIZE, useCreateMovement, useItemMovements } from '../model/inventory.queries';
import { WeightField } from './WeightField';

export type MovementIntent = 'purchase' | 'intake' | 'consumption' | 'adjustment';

/** One name per action everywhere: the same buttons on the warehouse list and on the item page. */
export const INTENT_BUTTON_LABELS: Record<MovementIntent, string> = {
  purchase: 'Xarid',
  intake: 'Kirim (xaridsiz)',
  consumption: 'Sarf',
  adjustment: 'Inventarizatsiya',
};

const INTENTS: Record<MovementIntent, { title: string; description: string; submit: string; success: string; subject: string }> =
  {
    purchase: {
      title: 'Xarid qilish',
      description: 'Sotib olingan mahsulotni narxi bilan kiriting — xarajatlarga yoziladi.',
      submit: 'Xaridni saqlash',
      success: 'Xarid omborga kiritildi',
      subject: 'Xarid',
    },
    intake: {
      title: 'Kirim (xaridsiz)',
      description: 'Pulsiz kelgan mahsulot: o‘z hosilingiz, sovg‘a yoki boshqa joydan. Xarajatga yozilmaydi.',
      submit: 'Kirimni saqlash',
      success: 'Kirim saqlandi',
      subject: 'Kirim',
    },
    consumption: {
      title: 'Sarf',
      description: 'Ishlatilgan miqdorni ombordan chiqaring.',
      submit: 'Sarfni saqlash',
      success: 'Sarf saqlandi',
      subject: 'Sarf',
    },
    adjustment: {
      title: 'Inventarizatsiya tuzatishi',
      description: 'Omborni sanab chiqing va haqiqiy qoldiqni yozing — farq avtomatik hisoblanadi.',
      submit: 'Tuzatishni saqlash',
      success: 'Tuzatish saqlandi',
      subject: 'Tuzatish',
    },
  };

const UNIT_COST_RULE = { maxIntegerDigits: 14, maxFractionDigits: 2 };

const formSchema = z.object({
  quantity: z.string().trim(),
  quantityUnit: z.enum(WEIGHT_INPUT_UNITS),
  bagWeight: z.string().trim(),
  unitCost: z.string().trim(),
  reason: z.string().trim().max(500, 'Ko‘pi bilan 500 ta belgi'),
});
type Values = z.infer<typeof formSchema>;

function schemaFor(intent: MovementIntent, inKg: boolean) {
  return formSchema.superRefine((values, context) => {
    const weight = parseWeightInput(
      { amount: values.quantity, unit: inKg ? values.quantityUnit : 'kg', bagWeight: values.bagWeight },
      { allowZero: intent === 'adjustment' },
    );
    if (weight.amountError) context.addIssue({ code: 'custom', path: ['quantity'], message: weight.amountError });
    if (weight.bagWeightError) context.addIssue({ code: 'custom', path: ['bagWeight'], message: weight.bagWeightError });
    if (intent === 'purchase') {
      const problem = values.unitCost ? decimalProblem(values.unitCost, UNIT_COST_RULE) : 'Narxni kiriting';
      if (problem) context.addIssue({ code: 'custom', path: ['unitCost'], message: problem });
    }
    if (intent === 'adjustment' && !values.reason) {
      context.addIssue({ code: 'custom', path: ['reason'], message: 'Tuzatish sababini yozing' });
    }
  });
}

const abs = (value: Decimal) => (value.isNegative() ? Decimal.ZERO.sub(value) : value);

/** A count that moves the balance by more than half of it is confirmed separately. */
function largeChange(current: Decimal, counted: Decimal): boolean {
  if (current.isZero()) return !counted.isZero();
  return abs(counted.sub(current)).gt(current.div(Decimal.from(2), 3));
}

interface MovementDialogProps {
  item: InventoryItem | null;
  intent: MovementIntent;
  onClose: () => void;
  /** "Kirim (xaridsiz)" offers to switch to "Xarid" when the feed was actually bought. */
  onSwitchIntent?: (intent: MovementIntent) => void;
}

/**
 * Records one stock movement. The server computes the new balance and
 * rejects overdrafts (409 INSUFFICIENT_STOCK); the preview here is only an
 * estimate. One Idempotency-Key per dialog session makes retries safe; when
 * an answer is lost the key is kept for 10 minutes, so reopening the dialog
 * and sending again is replayed by the server instead of applied twice.
 */
export function MovementDialog({ item, intent, onClose, onSwitchIntent }: MovementDialogProps) {
  const queryClient = useQueryClient();
  const createMovement = useCreateMovement();
  const guard = useSubmitGuard();
  const { data: user } = useCurrentUser();
  const keyScope = `movement:${user?.id ?? 'me'}:${item?.id ?? ''}:${intent}`;
  const enqueue = useOfflineQueue((state) => state.enqueue);
  const recovered = useRef(item ? recoverIdempotencyKey(keyScope) : null);
  const sessionKey = useRef<string>(recovered.current ?? newIdempotencyKey());
  const mounted = useRef(true);
  const snapshot = useRef<Set<string> | null>(null);
  const [confirming, setConfirming] = useState<CreateMovementInput | null>(null);
  const [lostAnswer, setLostAnswer] = useState(false);
  const meta = INTENTS[intent];
  const inKg = item?.unit === 'KG' && item.category === 'FEED';
  // The latest movements before sending: a lost answer is checked against them.
  const recent = useItemMovements(item?.id ?? '', 1);
  const resolver = useMemo(() => zodResolver(schemaFor(intent, inKg)), [intent, inKg]);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    setValue,
    control,
    formState: { errors, isDirty },
  } = useForm<Values>({
    resolver,
    mode: 'onTouched',
    defaultValues: { quantity: '', quantityUnit: 'kg', bagWeight: '', unitCost: '', reason: '' },
  });
  const values = useWatch({ control }) as Values;
  const draft = useFormDraft<Values>({
    userId: user?.id,
    farmId: item?.farmId,
    formId: `movement:${item?.id ?? ''}:${intent}`,
    values,
    dirty: isDirty,
    enabled: item !== null,
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!item) return;
    recovered.current = recoverIdempotencyKey(keyScope);
    sessionKey.current = recovered.current ?? newIdempotencyKey();
    // A purchase starts from the item's current price (editable).
    const unitCost = intent === 'purchase' && item.unitPrice ? Decimal.from(item.unitPrice).toString() : '';
    reset({ quantity: '', quantityUnit: 'kg', bagWeight: '', unitCost, reason: '' });
    setLostAnswer(false);
    createMovement.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, intent]);

  if (!item) return null;

  const unit = UNIT_SHORT[item.unit];
  const current = Decimal.parse(item.quantity) ?? Decimal.ZERO;
  const weight = parseWeightInput(
    { amount: values.quantity ?? '', unit: inKg ? (values.quantityUnit ?? 'kg') : 'kg', bagWeight: values.bagWeight ?? '' },
    { allowZero: intent === 'adjustment' },
  );
  const quantity = weight.kilograms;
  const counted = intent === 'adjustment' ? quantity : null;
  const difference = counted ? counted.sub(current) : null;
  const outgoing = intent === 'consumption';
  const projected = quantity && intent !== 'adjustment' ? (outgoing ? current.sub(quantity) : current.add(quantity)) : null;
  const unitCost = Decimal.parse(values.unitCost ?? '');
  const total = intent === 'purchase' && quantity && unitCost ? quantity.mul(unitCost) : null;
  const typedNote =
    inKg && (values.quantityUnit ?? 'kg') !== 'kg' && quantity
      ? describeWeight({ amount: values.quantity, unit: values.quantityUnit }, quantity)
      : null;

  async function verifySaved(body: CreateMovementInput): Promise<void> {
    const before = snapshot.current;
    if (!before || !item) return;
    try {
      const page = await queryClient.fetchQuery({
        queryKey: inventoryKeys.movements(item.id, 1),
        queryFn: () => inventoryApi.listMovements(item.id, { page: 1, limit: MOVEMENTS_PAGE_SIZE }),
        staleTime: 0,
      });
      const saved = page.items.find(
        (movement) =>
          !before.has(movement.id) &&
          movement.type === body.type &&
          Decimal.from(movement.quantity).compare(Decimal.from(body.quantity)) === 0,
      );
      if (!saved) return;
      forgetIdempotencyKey(keyScope);
      draft.clear();
      void queryClient.invalidateQueries({ queryKey: inventoryKeys.all });
      toast.success(`${meta.subject} allaqachon saqlangan (${formatSavedTime(saved.createdAt)}) — qayta yozilmadi`);
      if (mounted.current) onClose();
    } catch {
      // Still no answer: the message in the dialog says what to do.
    }
  }

  async function send(body: CreateMovementInput): Promise<void> {
    if (!item || !guard.begin()) return;
    const key = sessionKey.current;
    // No network at all: kept on the device and sent when it is back — never shown as saved.
    // An inventory count is not queued: it is a difference from the balance the server holds now.
    if (deviceOffline()) {
      try {
        if (intent === 'adjustment') {
          setError('quantity', { message: 'Inventarizatsiya uchun internet kerak — joriy qoldiq saytda tekshiriladi' });
          return;
        }
        const saved = user
          ? await enqueue({
              kind: 'stock-movement',
              userId: user.id,
              farmId: item.farmId,
              idempotencyKey: key,
              label: `${meta.subject}: ${item.name} — ${typedNote ?? formatQuantity(body.quantity, item.unit)}`,
              request: { itemId: item.id, body },
            })
          : false;
        if (saved) {
          draft.clear();
          toast.info('Internet yo‘q: yozuv navbatga olindi va internet tiklanganda yuboriladi. Hali saytga saqlanmagan.');
          if (mounted.current) onClose();
        } else {
          toast.error('Internet yo‘q va yozuvni qurilmada saqlab bo‘lmadi — internet tiklangach qayta urining.');
        }
      } finally {
        guard.end();
      }
      return;
    }
    rememberIdempotencyKey(keyScope, key);
    snapshot.current = recent.data ? new Set(recent.data.items.map((movement) => movement.id)) : null;
    setLostAnswer(false);
    try {
      const movement = await createMovement.mutateAsync({ itemId: item.id, body, idempotencyKey: key });
      forgetIdempotencyKey(keyScope);
      draft.clear();
      toast.success(`${meta.success}: ${typedNote ?? formatQuantity(movement.quantity, item.unit)}`);
      // Closed during the request: the toast still reports the outcome.
      if (mounted.current) onClose();
    } catch (error) {
      const apiError = toApiError(error);
      const unknown =
        apiError.outcomeUnknown || apiError.code === 'IDEMPOTENCY_KEY_REUSED' || apiError.code === 'IDEMPOTENCY_KEY_IN_PROGRESS';
      if (!unknown) forgetIdempotencyKey(keyScope);
      if (!mounted.current) {
        toast.error(saveErrorMessage(error, meta.subject));
      } else if (apiError.code === 'INSUFFICIENT_STOCK') {
        const available = typeof apiError.details?.available === 'string' ? apiError.details.available : item.quantity;
        setError('quantity', { message: `Omborda yetarli emas: ${formatQuantity(available, item.unit)} bor` });
      } else if (unknown) {
        setLostAnswer(true);
        void verifySaved(body);
      } else {
        const fieldErrors = validationFieldErrors(error, ['quantity', 'unitCost', 'reason'] as const);
        for (const [field, message] of Object.entries(fieldErrors)) {
          setError(field as 'quantity' | 'unitCost' | 'reason', { message });
        }
      }
    } finally {
      guard.end();
    }
  }

  const submit = handleSubmit(async (form) => {
    const parsed = parseWeightInput(
      { amount: form.quantity, unit: inKg ? form.quantityUnit : 'kg', bagWeight: form.bagWeight },
      { allowZero: intent === 'adjustment' },
    );
    const amount = parsed.kilograms;
    if (!amount) return;
    const note =
      inKg && form.quantityUnit !== 'kg' ? describeWeight({ amount: form.quantity, unit: form.quantityUnit }, amount) : null;
    const reason = [form.reason, note].filter(Boolean).join(' · ');
    let type: MovementType = outgoing ? 'OUT' : 'IN';
    let moved = amount;
    if (intent === 'adjustment') {
      const diff = amount.sub(current);
      if (diff.isZero()) {
        setError('quantity', { message: 'Qoldiq o‘zgarmaydi — tuzatish kerak emas' });
        return;
      }
      // The API takes the difference; the farmer gives what was counted.
      type = diff.isNegative() ? 'ADJUSTMENT_OUT' : 'ADJUSTMENT_IN';
      moved = abs(diff);
    } else if (outgoing && amount.gt(current)) {
      setError('quantity', { message: `Omborda faqat ${formatQuantity(item.quantity, item.unit)} bor` });
      return;
    }
    const body: CreateMovementInput = {
      type,
      quantity: moved.toString(),
      ...(intent === 'purchase' ? { unitCost: normalizeDecimal(form.unitCost), currency: 'UZS' } : {}),
      ...(reason ? { reason } : {}),
    };
    if (intent === 'adjustment' && largeChange(current, amount)) {
      setConfirming(body);
      return;
    }
    await send(body);
  });

  const apiError = createMovement.error ? toApiError(createMovement.error) : null;
  const serverError =
    lostAnswer || !apiError || apiError.code === 'INSUFFICIENT_STOCK'
      ? null
      : saveErrorMessage(createMovement.error, meta.subject);

  return (
    <Modal
      open
      onClose={onClose}
      title={`${meta.title}: ${item.name}`}
      description={meta.description}
      footer={
        <>
          {createMovement.isPending ? (
            <p className="text-[13px] text-ink-secondary sm:mr-auto sm:self-center">
              Yuborilmoqda… Oynani yopsangiz ham so‘rov davom etadi.
            </p>
          ) : null}
          <Button variant="secondary" onClick={onClose}>
            {createMovement.isPending ? 'Yopish' : 'Bekor qilish'}
          </Button>
          <Button type="submit" form="movement-form" loading={createMovement.isPending}>
            {meta.submit}
          </Button>
        </>
      }
    >
      <form id="movement-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <DraftNotice draft={draft} onRestore={(restored) => reset(restored, { keepDefaultValues: true })} />
        <p className="rounded-[10px] bg-background px-3 py-2.5 text-sm">
          Hozirgi qoldiq: <strong className="tabular">{formatQuantity(item.quantity, item.unit)}</strong>
        </p>

        {intent === 'intake' ? (
          <Alert tone="warning" title="Bu xarid emas">
            <p>Sotib olgan bo‘lsangiz, Xarid tugmasini bosing — aks holda xarajatga tushmaydi.</p>
            {onSwitchIntent ? (
              <Button
                size="sm"
                variant="secondary"
                className="mt-2"
                icon={<ShoppingCart aria-hidden className="size-4" />}
                onClick={() => onSwitchIntent('purchase')}
              >
                Xarid sifatida kiritish
              </Button>
            ) : null}
          </Alert>
        ) : null}
        {recovered.current ? (
          <Alert tone="info" title="Oldingi urinishga javob kelmagan edi">
            Yana yuborsangiz, xavfsiz: yozuv saqlangan bo‘lsa, ikkinchi marta yozilmaydi.
          </Alert>
        ) : null}

        <WeightField
          label={intent === 'adjustment' ? 'Sanab chiqilgan haqiqiy qoldiq' : 'Miqdor'}
          required
          hint={intent === 'adjustment' ? 'Omborda hozir aslida qancha borligini yozing, farqni emas' : undefined}
          unitShort={unit}
          unitChoice={inKg}
          inputUnit={values.quantityUnit ?? 'kg'}
          onInputUnitChange={(next: WeightInputUnit) =>
            setValue('quantityUnit', next, { shouldDirty: true, shouldValidate: true })
          }
          amount={register('quantity')}
          amountError={errors.quantity?.message}
          bagWeight={register('bagWeight')}
          bagWeightError={errors.bagWeight?.message}
          converted={typedNote}
          autoFocus
          placeholder="0"
        />

        {intent === 'purchase' ? (
          <Field label={`1 ${unit} narxi (so‘m)`} error={errors.unitCost?.message} required>
            <Input inputMode="decimal" autoComplete="off" placeholder="0" {...register('unitCost')} />
          </Field>
        ) : null}

        <Field
          label={intent === 'adjustment' ? 'Sabab' : 'Izoh'}
          error={errors.reason?.message}
          required={intent === 'adjustment'}
          hint={intent === 'adjustment' ? 'Masalan: sanab chiqildi, namlikdan buzilgan' : 'Ixtiyoriy'}
        >
          <Textarea rows={2} maxLength={500} {...register('reason')} />
        </Field>

        {total ? (
          <p className="text-sm text-ink-secondary">
            Jami summa: <strong className="text-ink tabular">{formatMoney(total)}</strong>
          </p>
        ) : null}
        {difference ? (
          difference.isZero() ? (
            <p className="text-sm text-ink-secondary">Qoldiq o‘zgarmaydi — tuzatish kerak emas.</p>
          ) : (
            <p className="rounded-[10px] border border-line px-3 py-2.5 text-sm text-ink-secondary">
              Yangi qoldiq: <strong className="text-ink tabular">{formatQuantity(counted?.toString(), item.unit)}</strong> · Farq:{' '}
              <strong className={difference.isNegative() ? 'text-danger tabular' : 'text-success tabular'}>
                {difference.isNegative() ? '−' : '+'}
                {formatQuantity(abs(difference).toString(), item.unit)}
              </strong>{' '}
              ({difference.isNegative() ? 'kamayadi' : 'ko‘payadi'})
            </p>
          )
        ) : null}
        {projected ? (
          projected.isNegative() ? (
            <Alert tone="danger">Bu miqdor ombordagi qoldiqdan ko‘p.</Alert>
          ) : (
            <p className="text-sm text-ink-secondary">
              Saqlangandan keyingi qoldiq (taxminiy):{' '}
              <strong className="text-ink tabular">{formatQuantity(projected.toString(), item.unit)}</strong>
            </p>
          )
        ) : null}
        {lostAnswer ? (
          <Alert tone="warning" title="Javob kelmadi" urgent>
            {meta.subject} saqlangan bo‘lishi mumkin — shu oynada qayta urining yoki tarixni tekshiring. Qayta yuborish xavfsiz:
            ikki marta yozilmaydi.
          </Alert>
        ) : null}
        <FormError message={serverError} />
      </form>
      <ConfirmDialog
        open={confirming !== null}
        title="Katta farq"
        tone="primary"
        message={
          counted
            ? `Qoldiq ${formatQuantity(item.quantity, item.unit)} dan ${formatQuantity(counted.toString(), item.unit)} ga ${
                counted.lt(current) ? 'tushadi' : 'oshadi'
              }. To‘g‘rimi?`
            : ''
        }
        confirmLabel="Ha, to‘g‘ri"
        cancelLabel="Ortga"
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          const body = confirming;
          setConfirming(null);
          if (body) void send(body);
        }}
      />
    </Modal>
  );
}
