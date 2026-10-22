import { zodResolver } from '@hookform/resolvers/zod';
import { Archive, ExternalLink, Scale } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { z } from 'zod';
import { useCurrentUser } from '@/features/auth/hooks/useCurrentUser';
import { useMedicineCatalog } from '@/features/medicines/model/medicines.queries';
import { saveErrorMessage, validationFieldErrors } from '@/shared/api/errors';
import { DraftNotice } from '@/shared/drafts/DraftNotice';
import { useFormDraft } from '@/shared/drafts/useFormDraft';
import { useSubmitGuard } from '@/shared/hooks/useSubmitGuard';
import { isValidIsoDate } from '@/shared/lib/dates';
import { Decimal } from '@/shared/lib/decimal';
import { formatDate, formatDecimal } from '@/shared/lib/format';
import { newIdempotencyKey } from '@/shared/lib/idempotency';
import {
  decimalProblem,
  normalizeDecimal,
  OPTIONAL_POSITIVE_MESSAGE,
  optionalText,
  requiredText,
  type DecimalRule,
} from '@/shared/lib/validation';
import { Alert, Button, Checkbox, Field, FormError, Input, Modal, Select, toast } from '@/shared/ui';
import {
  INVENTORY_UNITS,
  type CreateItemInput,
  type InventoryCategory,
  type InventoryItem,
  type InventoryUnit,
} from '../api/inventory.api';
import { findSameName } from '../lib/item-names';
import { CATEGORY_LABELS, formatQuantity, UNIT_NAMES, UNIT_SHORT, unitsFor } from '../lib/labels';
import { describeWeight, parseWeightInput, WEIGHT_INPUT_UNITS } from '../lib/units';
import { useCreateItem, useCreateMovement, useInventoryItems, useUpdateItem } from '../model/inventory.queries';
import { WeightField } from './WeightField';

/** Backend limit for useWithinDaysAfterOpening. */
const MAX_OPEN_DAYS = 3650;
/** Backend limits: unitPrice Decimal(16,2); minQuantity / initialQuantity Decimal(14,3). */
const PRICE_RULE: DecimalRule = { maxIntegerDigits: 14, maxFractionDigits: 2 };
const QUANTITY_RULE: DecimalRule = { maxIntegerDigits: 11, maxFractionDigits: 3 };

/** Optional decimal typed by a person ("1 234,5"); empty means "not given". */
function optionalDecimalInput(rule: DecimalRule) {
  return z
    .string()
    .trim()
    .superRefine((value, context) => {
      const problem = value ? decimalProblem(value, rule) : null;
      if (problem) context.addIssue({ code: 'custom', message: problem });
    });
}

const baseSchema = z.object({
  name: requiredText('Mahsulot nomini kiriting', 120),
  unit: z.enum(INVENTORY_UNITS),
  medicineId: z.string(),
  batchNumber: optionalText(64),
  expiresOn: z
    .string()
    .trim()
    .refine((value) => value === '' || isValidIsoDate(value), 'Sana noto‘g‘ri'),
  useWithinDaysAfterOpening: z
    .string()
    .trim()
    .refine(
      (value) => value === '' || (/^\d{1,4}$/.test(value) && Number(value) >= 1 && Number(value) <= MAX_OPEN_DAYS),
      `1 dan ${MAX_OPEN_DAYS} gacha kun kiriting`,
    ),
  /** Feed: added now, bought later — no quantity, no price. */
  noStock: z.boolean(),
  initialQuantity: z.string().trim(),
  quantityUnit: z.enum(WEIGHT_INPUT_UNITS),
  bagWeight: z.string().trim(),
  /** Feed: the starting stock was bought this month — recorded as a purchase (an expense). */
  purchasedNow: z.boolean(),
  unitPrice: optionalDecimalInput(PRICE_RULE),
  minQuantity: optionalDecimalInput(QUANTITY_RULE),
});
type Values = z.infer<typeof baseSchema>;

/** Feed kept in kg may be entered in tonnes or bags. */
const weighsInKg = (category: InventoryCategory, unit: InventoryUnit) => category === 'FEED' && unit === 'KG';

/**
 * A new feed needs its name, unit, quantity (> 0) and price — unless it is
 * explicitly "not in stock yet". Other categories keep quantity and price
 * optional. Editing never touches the quantity (movements do).
 */
function schemaFor(category: InventoryCategory, editing: boolean) {
  return baseSchema.superRefine((values, context) => {
    if (editing) return;
    const strict = category === 'FEED' && !values.noStock;
    if (category === 'FEED' && values.noStock) return;
    const weight = parseWeightInput(
      {
        amount: values.initialQuantity,
        unit: weighsInKg(category, values.unit) ? values.quantityUnit : 'kg',
        bagWeight: values.bagWeight,
      },
      strict ? {} : { required: false, zeroMessage: OPTIONAL_POSITIVE_MESSAGE },
    );
    if (weight.amountError) context.addIssue({ code: 'custom', path: ['initialQuantity'], message: weight.amountError });
    if (weight.bagWeightError) context.addIssue({ code: 'custom', path: ['bagWeight'], message: weight.bagWeightError });
    if (strict && !values.unitPrice) {
      context.addIssue({ code: 'custom', path: ['unitPrice'], message: `1 ${UNIT_SHORT[values.unit]} narxini kiriting` });
    }
  });
}

const DEFAULT_UNIT: Record<InventoryCategory, InventoryUnit> = { FEED: 'KG', MEDICINE: 'ML', EQUIPMENT: 'PIECE', OTHER: 'PIECE' };

function defaultsFor(category: InventoryCategory): Values {
  return {
    name: '',
    unit: DEFAULT_UNIT[category],
    medicineId: '',
    batchNumber: '',
    expiresOn: '',
    useWithinDaysAfterOpening: '',
    noStock: false,
    initialQuantity: '',
    quantityUnit: 'kg',
    bagWeight: '',
    purchasedNow: false,
    unitPrice: '',
    minQuantity: '',
  };
}

/** "3400.00" → "3400" for the input; empty when not set. */
const inputValue = (value: string | null | undefined) => (value ? Decimal.from(value).toString() : '');

function joinWords(words: string[]): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} va ${words[words.length - 1]}`;
}

interface ItemFormDialogProps {
  open: boolean;
  onClose: () => void;
  farmId: string;
  category: InventoryCategory;
  /** Edit mode (metadata only — quantity changes only through movements). */
  item?: InventoryItem | null;
  /** Edit mode: offers "Miqdorni tuzatish" (an inventory adjustment movement). */
  onAdjustQuantity?: () => void;
}

export function ItemFormDialog({ open, onClose, farmId, category, item, onAdjustQuantity }: ItemFormDialogProps) {
  const navigate = useNavigate();
  const create = useCreateItem();
  const update = useUpdateItem();
  const createMovement = useCreateMovement();
  const mutation = item ? update : create;
  const pending = create.isPending || update.isPending || createMovement.isPending;
  const guard = useSubmitGuard();
  const purchaseKey = useRef(newIdempotencyKey());
  const isMedicine = category === 'MEDICINE';
  const isFeed = category === 'FEED';
  const noun = isFeed ? 'yem' : 'mahsulot';
  const medicines = useMedicineCatalog(open && isMedicine && !item);
  const approved = (medicines.data ?? []).filter((medicine) => medicine.status === 'APPROVED');
  // Archived items too: a name is checked against everything the farm ever had.
  const existing = useInventoryItems(farmId, category, true, open);
  const { data: user } = useCurrentUser();

  const resolver = useMemo(() => zodResolver(schemaFor(category, Boolean(item))), [category, item]);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    setValue,
    control,
    formState: { errors, isValid, isDirty },
  } = useForm<Values>({ resolver, mode: 'onTouched', defaultValues: defaultsFor(category) });
  const values = useWatch({ control }) as Values;
  const unit = values.unit ?? DEFAULT_UNIT[category];
  const unitShort = UNIT_SHORT[unit];
  const inKg = weighsInKg(category, unit);
  const weight = parseWeightInput(
    {
      amount: values.initialQuantity ?? '',
      unit: inKg ? (values.quantityUnit ?? 'kg') : 'kg',
      bagWeight: values.bagWeight ?? '',
    },
    { required: false },
  );

  const draft = useFormDraft<Values>({
    userId: user?.id,
    farmId,
    formId: `item-create:${category}`,
    values,
    dirty: isDirty,
    enabled: open && !item,
  });

  useEffect(() => {
    if (!open) return;
    reset(
      item
        ? {
            ...defaultsFor(category),
            name: item.name,
            unit: item.unit,
            medicineId: item.medicineId ?? '',
            batchNumber: item.batchNumber ?? '',
            expiresOn: item.expiresOn ?? '',
            useWithinDaysAfterOpening: item.useWithinDaysAfterOpening ? String(item.useWithinDaysAfterOpening) : '',
            unitPrice: inputValue(item.unitPrice),
            minQuantity: inputValue(item.minQuantity),
          }
        : defaultsFor(category),
    );
    purchaseKey.current = newIdempotencyKey();
    create.reset();
    update.reset();
    createMovement.reset();
    // Keyed by id: a background refetch of the same item must not wipe what is being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item?.id]);

  const same = useMemo(
    () => findSameName(values.name ?? '', existing.data?.items ?? [], item?.id),
    [values.name, existing.data, item?.id],
  );
  const duplicateMessage = same.active ? `«${same.active.name}» allaqachon bor` : null;
  const itemPath = (target: InventoryItem) =>
    target.category === 'MEDICINE' ? `/medicines/stock/${target.id}` : `/feed/${target.id}`;

  function openExisting(target: InventoryItem): void {
    // The farmer chose the item that already exists: this input is no longer needed.
    draft.clear();
    onClose();
    navigate(itemPath(target));
  }

  const strict = isFeed && !item && !values.noStock;
  const missing = [
    !(values.name ?? '').trim() ? 'nomini' : null,
    strict && !(values.initialQuantity ?? '').trim() ? 'miqdorini' : null,
    strict && !(values.unitPrice ?? '').trim() ? 'narxini' : null,
  ].filter((word): word is string => word !== null);
  const canSubmit = isValid && !duplicateMessage;
  const submitHint = canSubmit
    ? null
    : duplicateMessage
      ? `Bu nom band — boshqa nom yozing yoki mavjud ${noun}ni oching`
      : missing.length > 0
        ? `Saqlash uchun ${noun} ${joinWords(missing)} kiriting`
        : 'Qizil bilan belgilangan maydonlarni tuzating';

  const fieldErrors = (error: unknown) => {
    const found = validationFieldErrors(error, [
      'name',
      'unit',
      'medicineId',
      'batchNumber',
      'expiresOn',
      'useWithinDaysAfterOpening',
      'initialQuantity',
      'unitPrice',
      'minQuantity',
    ] as const);
    for (const [field, message] of Object.entries(found)) setError(field as keyof Values, { message });
  };

  const submit = handleSubmit(async (form) => {
    // The submit handler checks everything itself, not only the disabled button.
    if (same.active) {
      setError('name', { message: duplicateMessage ?? '' });
      return;
    }
    if (!guard.begin()) return;
    try {
      const optional = {
        ...(form.batchNumber ? { batchNumber: form.batchNumber } : {}),
        ...(form.expiresOn ? { expiresOn: form.expiresOn } : {}),
        ...(form.useWithinDaysAfterOpening ? { useWithinDaysAfterOpening: Number(form.useWithinDaysAfterOpening) } : {}),
        ...(form.unitPrice ? { unitPrice: normalizeDecimal(form.unitPrice) } : {}),
        ...(form.minQuantity ? { minQuantity: normalizeDecimal(form.minQuantity) } : {}),
      };
      if (item) {
        // Emptied fields are cleared with null (supported by the PATCH DTO).
        const body = {
          name: form.name,
          batchNumber: form.batchNumber || (item.batchNumber ? null : undefined),
          expiresOn: form.expiresOn || (item.expiresOn ? null : undefined),
          useWithinDaysAfterOpening: form.useWithinDaysAfterOpening
            ? Number(form.useWithinDaysAfterOpening)
            : item.useWithinDaysAfterOpening
              ? null
              : undefined,
          unitPrice: form.unitPrice ? normalizeDecimal(form.unitPrice) : item.unitPrice ? null : undefined,
          minQuantity: form.minQuantity ? normalizeDecimal(form.minQuantity) : item.minQuantity ? null : undefined,
        };
        try {
          await update.mutateAsync({
            id: item.id,
            body: Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined)),
          });
        } catch (error) {
          fieldErrors(error);
          return;
        }
        toast.success('Mahsulot ma’lumotlari saqlandi');
        onClose();
        return;
      }

      const typed = parseWeightInput(
        { amount: form.initialQuantity, unit: inKg ? form.quantityUnit : 'kg', bagWeight: form.bagWeight },
        { required: false },
      );
      const quantity = isFeed && form.noStock ? null : typed.kilograms;
      const asPurchase = isFeed && quantity !== null && form.purchasedNow;
      const body: CreateItemInput = {
        farmId,
        category,
        name: form.name,
        unit: form.unit,
        ...(isMedicine && form.medicineId ? { medicineId: form.medicineId } : {}),
        ...optional,
        // A purchase is written as its own movement below (an expense); otherwise
        // the starting stock is recorded by the API as "Boshlang‘ich qoldiq".
        ...(quantity && !asPurchase ? { initialQuantity: quantity.toString() } : {}),
      };
      let created: InventoryItem;
      try {
        created = await create.mutateAsync(body);
      } catch (error) {
        fieldErrors(error);
        return;
      }
      draft.clear();
      const amount = quantity
        ? describeWeight({ amount: form.initialQuantity, unit: inKg ? form.quantityUnit : 'kg' }, quantity)
        : null;
      if (asPurchase && quantity) {
        try {
          await createMovement.mutateAsync({
            itemId: created.id,
            body: {
              type: 'IN',
              quantity: quantity.toString(),
              unitCost: normalizeDecimal(form.unitPrice),
              currency: 'UZS',
              ...(inKg && form.quantityUnit !== 'kg' && amount ? { reason: amount } : {}),
            },
            idempotencyKey: purchaseKey.current,
          });
          toast.success(`“${created.name}” omborga qo‘shildi: ${amount ?? ''} xarid sifatida xarajatga yozildi`);
        } catch (error) {
          toast.error(
            `“${created.name}” qo‘shildi, lekin xarid yozilmadi. ${saveErrorMessage(error, 'Xarid')} Yem sahifasida “Xarid”ni bosing.`,
          );
        }
      } else {
        toast.success(amount ? `“${created.name}” omborga qo‘shildi: ${amount}` : `“${created.name}” omborga qo‘shildi`);
      }
      onClose();
    } finally {
      guard.end();
    }
  });

  const label = CATEGORY_LABELS[category].toLowerCase();
  const serverError = mutation.error ? saveErrorMessage(mutation.error, 'Mahsulot') : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={item ? `${item.name}: tahrirlash` : `Yangi ${label}`}
      description={
        item
          ? 'Miqdor faqat xarid, kirim, sarf yoki inventarizatsiya orqali o‘zgaradi.'
          : isFeed
            ? 'Hozir omborda bor yemni kiriting. Boshlang‘ich qoldiq xarid emas — xarajatga qo‘shilmaydi.'
            : 'Boshlang‘ich miqdorni kiritsangiz, u omborga boshlang‘ich qoldiq sifatida yoziladi.'
      }
      footer={
        <>
          {submitHint ? <p className="text-[13px] text-ink-secondary sm:mr-auto sm:self-center">{submitHint}</p> : null}
          <Button variant="secondary" onClick={onClose}>
            Bekor qilish
          </Button>
          <Button type="submit" form="item-form" loading={pending} disabled={!canSubmit}>
            Saqlash
          </Button>
        </>
      }
    >
      <form id="item-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        {item ? null : (
          <DraftNotice
            draft={draft}
            className="sm:col-span-2"
            onRestore={(restored) => reset({ ...defaultsFor(category), ...restored }, { keepDefaultValues: true })}
          />
        )}
        <Field label="Nomi" error={errors.name?.message ?? duplicateMessage ?? undefined} required className="sm:col-span-2">
          <Input
            data-autofocus
            autoComplete="off"
            placeholder={isMedicine ? 'Masalan: dori nomi va hajmi' : 'Masalan: Arpa'}
            {...register('name')}
          />
        </Field>
        {same.active ? (
          <Alert tone="warning" className="sm:col-span-2" title={`«${same.active.name}» omborda allaqachon bor`}>
            <p>
              Bir xil nomli ikkinchi {noun} qoldiqni ikkiga bo‘lib yuboradi. Mavjud {noun}ga xarid yoki kirim qiling.
            </p>
            <Button
              size="sm"
              variant="secondary"
              className="mt-2"
              icon={<ExternalLink aria-hidden className="size-4" />}
              onClick={() => same.active && openExisting(same.active)}
            >
              Mavjud {noun}ni ochish
            </Button>
          </Alert>
        ) : same.archived ? (
          <Alert tone="info" className="sm:col-span-2" title={`«${same.archived.name}» arxivda bor`}>
            <p>
              {formatDate(same.archived.archivedAt)} da arxivlangan. Arxivdan tiklash hozircha mavjud emas — yangisini
              qo‘shishingiz mumkin.
            </p>
            <Button
              size="sm"
              variant="secondary"
              className="mt-2"
              icon={<Archive aria-hidden className="size-4" />}
              onClick={() => same.archived && openExisting(same.archived)}
            >
              Arxivdagini ko‘rish
            </Button>
          </Alert>
        ) : null}
        <Field
          label="O‘lchov birligi"
          error={errors.unit?.message}
          required
          hint={
            item
              ? 'Yaratilgandan keyin o‘zgartirib bo‘lmaydi'
              : isFeed
                ? 'Tonna va qopda kiritsangiz, kg ga aylantiriladi'
                : undefined
          }
        >
          <Select disabled={Boolean(item)} {...register('unit')}>
            {(item ? INVENTORY_UNITS : unitsFor(category)).map((value) => (
              <option key={value} value={value}>
                {UNIT_NAMES[value]}
              </option>
            ))}
          </Select>
        </Field>
        {item ? null : (
          <div className="flex flex-col gap-3 sm:col-span-2">
            {isFeed ? <Checkbox label="Hozircha omborda yo‘q (miqdor va narxsiz qo‘shish)" {...register('noStock')} /> : null}
            <WeightField
              label="Boshlang‘ich miqdor"
              required={strict}
              hint={
                isFeed
                  ? values.noStock
                    ? 'Yem “Tugagan” holatida qo‘shiladi; keyin “Xarid” bilan kiriting'
                    : 'Hozir omborda bor miqdor'
                  : 'Ixtiyoriy: hozir omborda bor miqdor'
              }
              unitShort={unitShort}
              unitChoice={inKg}
              inputUnit={values.quantityUnit ?? 'kg'}
              onInputUnitChange={(next) => setValue('quantityUnit', next, { shouldDirty: true, shouldValidate: true })}
              amount={register('initialQuantity')}
              amountError={errors.initialQuantity?.message}
              bagWeight={register('bagWeight')}
              bagWeightError={errors.bagWeight?.message}
              converted={
                inKg && (values.quantityUnit ?? 'kg') !== 'kg' && weight.kilograms
                  ? `${formatDecimal(weight.kilograms)} kg`
                  : null
              }
              disabled={isFeed && values.noStock}
            />
            {isFeed && !values.noStock ? (
              <div className="rounded-[10px] bg-background px-3 py-2.5">
                <Checkbox label="Shu oy sotib oldim — xarajatga qo‘sh" {...register('purchasedNow')} />
                <p className="mt-1 pl-[30px] text-[13px] text-ink-secondary">
                  {values.purchasedNow
                    ? 'Miqdor “Xarid” sifatida yoziladi va shu oy xarajatiga qo‘shiladi.'
                    : 'Belgilanmasa: boshlang‘ich qoldiq — ombor qiymatiga kiradi, xarajatga emas.'}
                </p>
              </div>
            ) : null}
          </div>
        )}
        <Field
          label={`1 ${unitShort} narxi (so‘m)`}
          error={errors.unitPrice?.message}
          required={strict}
          hint={strict ? 'Har bir narxli xarid uni yangilaydi' : 'Ixtiyoriy: har bir narxli xarid uni yangilaydi'}
        >
          <Input inputMode="decimal" autoComplete="off" placeholder="Masalan: 3500" {...register('unitPrice')} />
        </Field>
        <Field
          label={`Minimal qoldiq (${unitShort})`}
          error={errors.minQuantity?.message}
          hint="Ixtiyoriy: shundan kam qolsa ogohlantiradi"
        >
          <Input inputMode="decimal" autoComplete="off" placeholder="Masalan: 100" {...register('minQuantity')} />
        </Field>
        {item && onAdjustQuantity ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] bg-background px-3 py-2.5 sm:col-span-2">
            <p className="text-sm">
              Hozirgi miqdor: <strong className="tabular">{formatQuantity(item.quantity, item.unit)}</strong>
            </p>
            <Button
              variant="secondary"
              size="sm"
              icon={<Scale aria-hidden className="size-4" />}
              onClick={() => {
                onClose();
                onAdjustQuantity();
              }}
            >
              Miqdorni tuzatish
            </Button>
          </div>
        ) : null}
        {isMedicine && !item ? (
          <Field label="Katalogdagi dori" error={errors.medicineId?.message} hint="Faqat tasdiqlangan dorilar">
            <Select {...register('medicineId')} disabled={medicines.isPending}>
              <option value="">Bog‘lanmagan</option>
              {approved.map((medicine) => (
                <option key={medicine.id} value={medicine.id}>
                  {medicine.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        {isMedicine ? (
          <>
            <Field label="Partiya raqami" error={errors.batchNumber?.message} hint="Ixtiyoriy">
              <Input autoComplete="off" {...register('batchNumber')} />
            </Field>
            <Field label="Yaroqlilik muddati" error={errors.expiresOn?.message} hint="Ixtiyoriy">
              <Input type="date" {...register('expiresOn')} />
            </Field>
            <Field
              label="Ochilgandan keyin (kun)"
              error={errors.useWithinDaysAfterOpening?.message}
              hint="Ixtiyoriy: idish ochilgach necha kun ishlatiladi"
            >
              <Input inputMode="numeric" autoComplete="off" {...register('useWithinDaysAfterOpening')} />
            </Field>
          </>
        ) : null}
        <div className="sm:col-span-2">
          <FormError message={serverError ?? (createMovement.error ? saveErrorMessage(createMovement.error, 'Xarid') : null)} />
        </div>
      </form>
    </Modal>
  );
}
