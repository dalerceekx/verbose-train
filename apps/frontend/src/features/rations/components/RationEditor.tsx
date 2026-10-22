import { ArrowLeft, Calculator, PawPrint, Plus, Save, Trash2, Users, Wheat } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useFarmAnimals } from '@/features/animals/model/animals.queries';
import { useCurrentUser } from '@/features/auth/hooks/useCurrentUser';
import type { Farm } from '@/features/farms/api/farms.api';
import { formatQuantity, UNIT_SHORT } from '@/features/inventory/lib/labels';
import { useInventoryItems } from '@/features/inventory/model/inventory.queries';
import { saveErrorMessage } from '@/shared/api/errors';
import { DraftNotice } from '@/shared/drafts/DraftNotice';
import { useFormDraft } from '@/shared/drafts/useFormDraft';
import { useSubmitGuard } from '@/shared/hooks/useSubmitGuard';
import { Decimal } from '@/shared/lib/decimal';
import { formatDecimal, formatMoney } from '@/shared/lib/format';
import { decimalProblem, normalizeDecimal, type DecimalRule } from '@/shared/lib/validation';
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Field,
  FormError,
  IconButton,
  Input,
  Select,
  Textarea,
  toast,
} from '@/shared/ui';
import type { AnimalType, FeedingPurpose, PhysiologicalState, ProfileConfig, Ration, RationInput } from '../api/rations.api';
import { belongsToType, FIELD_LABELS, PROFILE_HINTS, PURPOSE_LABELS, STATE_LABELS } from '../lib/labels';
import { useSaveRation } from '../model/rations.queries';
import { RationResultView, type ResultLine } from './RationResultView';

export type EditorAnimalType = Pick<AnimalType, 'id' | 'name' | 'profile' | 'species' | 'sex'>;

/** Backend limits (contract §4.3). */
const RULES = {
  count: { maxIntegerDigits: 7, maxFractionDigits: 0, positive: true, max: '1000000' },
  weight: { maxIntegerDigits: 6, maxFractionDigits: 2, positive: true },
  age: { maxIntegerDigits: 3, maxFractionDigits: 0, max: '600' },
  milk: { maxIntegerDigits: 4, maxFractionDigits: 2 },
  days: { maxIntegerDigits: 4, maxFractionDigits: 0, positive: true, max: '3650' },
  daily: { maxIntegerDigits: 6, maxFractionDigits: 3, positive: true },
} satisfies Record<string, DecimalRule>;

const DAY_PRESETS = ['7', '30', '90'] as const;
const MAX_LINES = 20;
/** Shown next to the descriptive parameters: the arithmetic uses only animals, days and the feed amounts. */
const NO_EFFECT_HINT = 'Hisobga ta’sir qilmaydi — ratsionni tavsiflash uchun';

interface Line {
  key: string;
  itemId: string;
  daily: string;
}

/** What the form keeps as a draft on the device (the farmer's input only). */
interface EditorDraft {
  name: string;
  count: string;
  weight: string;
  age: string;
  purpose: FeedingPurpose;
  state: PhysiologicalState | '';
  milk: string;
  days: string;
  notes: string;
  lines: Array<{ itemId: string; daily: string }>;
}

interface Parsed {
  value: Decimal | null;
  error: string | undefined;
}

/** Empty is an error once the farmer left the field (or tried to save) a required one. */
function parse(value: string, rule: DecimalRule, required: boolean, showEmpty: boolean): Parsed {
  if (value.trim() === '') return { value: null, error: required && showEmpty ? 'Qiymatni kiriting' : undefined };
  const problem = decimalProblem(value, rule);
  return problem ? { value: null, error: problem } : { value: Decimal.from(value), error: undefined };
}

const toInput = (value: string | null | undefined) => (value ? Decimal.from(value).toString() : '');
const newLine = (itemId = '', daily = ''): Line => ({ key: crypto.randomUUID(), itemId, daily });

function joinWords(words: string[]): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} va ${words[words.length - 1]}`;
}

/**
 * Ration form (spec 4.1–4.3): the animal parameters the profile asks for,
 * feeds picked from the warehouse with a per-animal daily amount, and the
 * live result. Saving stores the ration only — stock is untouched. Input
 * is kept as a draft on the device until the server has it.
 */
export function RationEditor({
  farm,
  type,
  config,
  ration,
  backTo,
}: {
  farm: Farm;
  type: EditorAnimalType;
  config: ProfileConfig;
  ration?: Ration;
  backTo: string;
}) {
  const navigate = useNavigate();
  const save = useSaveRation(farm.id);
  const guard = useSubmitGuard();
  const { data: user } = useCurrentUser();
  const feed = useInventoryItems(farm.id, 'FEED');
  const animals = useFarmAnimals(farm.id);
  const feedItems = useMemo(() => feed.data?.items ?? [], [feed.data]);
  const has = (field: ProfileConfig['fields'][number]) => config.fields.includes(field);

  const [submitted, setSubmitted] = useState(false);
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set());
  const [name, setName] = useState(ration?.name ?? '');
  const [count, setCount] = useState(ration ? String(ration.animalCount) : '');
  const [weight, setWeight] = useState(toInput(ration?.averageWeightKg));
  const [age, setAge] = useState(ration?.ageMonths != null ? String(ration.ageMonths) : '');
  const [purpose, setPurpose] = useState<FeedingPurpose>(ration?.purpose ?? config.purposes[0] ?? 'MAINTENANCE');
  const [state, setState] = useState<PhysiologicalState | ''>(ration?.physiologicalState ?? '');
  const [milk, setMilk] = useState(toInput(ration?.milkYieldLiters));
  const [days, setDays] = useState(ration ? String(ration.days) : '30');
  const [notes, setNotes] = useState(ration?.notes ?? '');
  const [lines, setLines] = useState<Line[]>(() =>
    ration?.items.length ? ration.items.map((line) => newLine(line.inventoryItemId, toInput(line.dailyPerAnimal))) : [newLine()],
  );

  const draftValues: EditorDraft = {
    name,
    count,
    weight,
    age,
    purpose,
    state,
    milk,
    days,
    notes,
    lines: lines.map(({ itemId, daily }) => ({ itemId, daily })),
  };
  // What the form showed when it opened: anything else is unsaved input.
  const [initial] = useState(() => JSON.stringify(draftValues));
  const dirty = JSON.stringify(draftValues) !== initial;
  const draft = useFormDraft<EditorDraft>({
    userId: user?.id,
    farmId: farm.id,
    formId: ration ? `ration-edit:${ration.id}` : `ration-new:${type.id}`,
    values: draftValues,
    dirty,
    version: ration?.updatedAt ?? null,
  });

  function restore(values: EditorDraft): void {
    setName(values.name);
    setCount(values.count);
    setWeight(values.weight);
    setAge(values.age);
    setPurpose(values.purpose);
    setState(values.state);
    setMilk(values.milk);
    setDays(values.days);
    setNotes(values.notes);
    setLines(values.lines.length > 0 ? values.lines.map((line) => newLine(line.itemId, line.daily)) : [newLine()]);
  }

  const touch = (key: string) => () => {
    setTouched((current) => (current.has(key) ? current : new Set(current).add(key)));
    draft.flush();
  };
  const shown = (key: string, strict: boolean) => strict || touched.has(key);

  // Herd of this category on the farm (server data) — a suggestion only.
  const herd = useMemo(() => (animals.data?.items ?? []).filter((animal) => belongsToType(animal, type)), [animals.data, type]);
  const weighed = herd.flatMap((animal) => (animal.weightKg ? [Decimal.from(animal.weightKg)] : []));
  const herdWeight = weighed.length > 0 ? Decimal.sum(weighed).div(Decimal.from(weighed.length), 2) : null;
  // Feeds of the saved ration that were archived since: named, never silently dropped.
  const archivedFeeds = new Map(
    (ration?.items ?? []).filter((line) => line.item.archivedAt !== null).map((line) => [line.inventoryItemId, line.item.name]),
  );

  function validate(strict: boolean) {
    const nameError =
      shown('name', strict) && !name.trim()
        ? 'Ratsion nomini kiriting'
        : name.trim().length > 100
          ? 'Ko‘pi bilan 100 ta belgi'
          : undefined;
    const fields = {
      count: parse(count, RULES.count, true, shown('count', strict)),
      weight: has('averageWeightKg') ? parse(weight, RULES.weight, false, false) : { value: null, error: undefined },
      age: has('ageMonths') ? parse(age, RULES.age, false, false) : { value: null, error: undefined },
      milk: has('milkYieldLiters') ? parse(milk, RULES.milk, false, false) : { value: null, error: undefined },
      days: parse(days, RULES.days, true, shown('days', strict)),
    };
    const notesError = notes.trim().length > 500 ? 'Ko‘pi bilan 500 ta belgi' : undefined;
    const rows = lines.map((line) => {
      const item = feedItems.find((candidate) => candidate.id === line.itemId) ?? null;
      const archivedName = !item && line.itemId ? archivedFeeds.get(line.itemId) : undefined;
      return {
        line,
        item,
        archivedName,
        daily: parse(line.daily, RULES.daily, true, shown(`${line.key}:daily`, strict)),
        itemError: archivedName
          ? 'Bu yem arxivlangan — boshqa yem tanlang yoki qatorni olib tashlang'
          : shown(`${line.key}:item`, strict) && !line.itemId
            ? 'Yemni tanlang'
            : undefined,
      };
    });
    const hasErrors =
      Boolean(nameError || notesError) ||
      Object.values(fields).some((field) => field.error) ||
      rows.some((row) => row.itemError || row.daily.error);
    return { nameError, notesError, fields, rows, hasErrors };
  }

  const view = validate(submitted);
  const strictCheck = validate(true);
  const chosen = new Set(lines.map((line) => line.itemId).filter(Boolean));
  const resultLines: ResultLine[] = view.rows.flatMap((row) =>
    row.item && row.daily.value
      ? [
          {
            name: row.item.name,
            unit: row.item.unit,
            dailyPerAnimal: row.daily.value,
            stock: Decimal.parse(row.item.quantity) ?? Decimal.ZERO,
            unitPrice: Decimal.parse(row.item.unitPrice),
          },
        ]
      : [],
  );
  // Lines started but not usable: left out of the result, and said so.
  const excludedLines = view.rows.filter(
    (row) => (row.line.itemId !== '' || row.line.daily.trim() !== '') && !(row.item && row.daily.value),
  ).length;
  const countValue = view.fields.count.value;
  const daysValue = view.fields.days.value;

  const missing = [
    !name.trim() ? 'ratsion nomi' : null,
    !count.trim() ? 'hayvonlar soni' : null,
    !days.trim() ? 'muddat' : null,
    !lines.some((line) => line.itemId && line.daily.trim()) ? 'kamida bitta yem va uning kunlik miqdori' : null,
  ].filter((word): word is string => word !== null);
  const saveHint = strictCheck.hasErrors
    ? missing.length > 0
      ? `Saqlash uchun kiriting: ${joinWords(missing)}`
      : 'Qizil bilan belgilangan maydonlarni tuzating'
    : null;

  function updateLine(key: string, patch: Partial<Line>): void {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function submit(event: FormEvent): void {
    event.preventDefault();
    setSubmitted(true);
    // The handler checks everything itself, not only the disabled button.
    const checked = validate(true);
    if (checked.hasErrors || save.isPending || !guard.begin()) return;
    const optional = {
      averageWeightKg: has('averageWeightKg') && weight.trim() ? normalizeDecimal(weight) : null,
      ageMonths: has('ageMonths') && age.trim() ? Number(normalizeDecimal(age)) : null,
      physiologicalState: config.states.length > 0 && state ? state : null,
      milkYieldLiters: has('milkYieldLiters') && milk.trim() ? normalizeDecimal(milk) : null,
      notes: notes.trim() || null,
    };
    const body: RationInput = {
      animalTypeId: type.id,
      name: name.trim(),
      animalCount: Number(normalizeDecimal(count)),
      purpose,
      days: Number(normalizeDecimal(days)),
      items: lines.map((line) => ({ inventoryItemId: line.itemId, dailyPerAnimal: normalizeDecimal(line.daily) })),
      // A new ration omits empty fields; an edited one clears them with null.
      ...(ration ? optional : Object.fromEntries(Object.entries(optional).filter(([, value]) => value !== null))),
    };
    save.mutate(
      { id: ration?.id, body },
      {
        onSuccess: (saved) => {
          // The server has it now: the draft goes, and leaving no longer asks.
          draft.clear();
          toast.success(ration ? 'Ratsion saytga saqlandi' : 'Ratsion yaratildi va saytga saqlandi');
          navigate(`/feed-calculator/rations/${saved.id}`);
        },
        onSettled: () => guard.end(),
      },
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      <Alert tone="info" title="Bu hisob, me’yor emas">
        Dastur oziqlantirish me’yorini tavsiya qilmaydi va ratsionni veterinariya jihatidan to‘g‘ri deb baholamaydi — miqdorlarni
        veterinar yoki zootexnik bilan kelishing. Hisoblash va saqlash ombordagi qoldiqni o‘zgartirmaydi.
      </Alert>
      {dirty || draft.offer ? (
        <div className="flex flex-col gap-2">
          {dirty ? (
            <p>
              <Badge tone="warning">O‘zgarishlar saqlanmagan</Badge>
            </p>
          ) : null}
          <DraftNotice draft={draft} onRestore={restore} />
        </div>
      ) : null}
      <div className="grid gap-6 xl:grid-cols-5">
        <div className="flex min-w-0 flex-col gap-6 xl:col-span-3">
          <Card>
            <CardHeader
              title={`1. ${type.name}: hayvonlar`}
              description={PROFILE_HINTS[type.profile]}
              icon={<PawPrint className="size-5" />}
            />
            <CardBody className="grid gap-4 sm:grid-cols-2">
              <Field label="Ratsion nomi" error={view.nameError} required className="sm:col-span-2">
                <Input
                  data-autofocus
                  autoComplete="off"
                  placeholder="Masalan: Qishki semirtirish"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  onBlur={touch('name')}
                />
              </Field>
              <Field label="Hayvonlar soni" error={view.fields.count.error} required hint="Butun son, masalan 12">
                <Input
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="Masalan: 10"
                  value={count}
                  onChange={(event) => setCount(event.target.value)}
                  onBlur={touch('count')}
                />
              </Field>
              <div className="flex items-end">
                <Button
                  variant="secondary"
                  fullWidth
                  icon={<Users aria-hidden className="size-4" />}
                  disabled={herd.length === 0}
                  onClick={() => setCount(String(herd.length))}
                >
                  Fermadagi soni: {herd.length} bosh
                </Button>
              </div>
              {has('averageWeightKg') ? (
                <Field
                  label={FIELD_LABELS.averageWeightKg}
                  error={view.fields.weight.error}
                  hint={
                    herdWeight
                      ? `Fermadagi o‘rtacha: ${formatDecimal(herdWeight)} kg. ${NO_EFFECT_HINT}`
                      : `Ixtiyoriy. ${NO_EFFECT_HINT}`
                  }
                >
                  <Input
                    inputMode="decimal"
                    autoComplete="off"
                    value={weight}
                    onChange={(event) => setWeight(event.target.value)}
                    onBlur={touch('weight')}
                  />
                </Field>
              ) : null}
              {has('ageMonths') ? (
                <Field label={FIELD_LABELS.ageMonths} error={view.fields.age.error} hint={`Ixtiyoriy. ${NO_EFFECT_HINT}`}>
                  <Input
                    inputMode="numeric"
                    autoComplete="off"
                    value={age}
                    onChange={(event) => setAge(event.target.value)}
                    onBlur={touch('age')}
                  />
                </Field>
              ) : null}
              <Field label="Boqish maqsadi" required hint={NO_EFFECT_HINT}>
                <Select value={purpose} onChange={(event) => setPurpose(event.target.value as FeedingPurpose)}>
                  {config.purposes.map((value) => (
                    <option key={value} value={value}>
                      {PURPOSE_LABELS[value]}
                    </option>
                  ))}
                </Select>
              </Field>
              {config.states.length > 0 ? (
                <Field label="Fiziologik holati" hint={`Ixtiyoriy. ${NO_EFFECT_HINT}`}>
                  <Select value={state} onChange={(event) => setState(event.target.value as PhysiologicalState | '')}>
                    <option value="">Ko‘rsatilmagan</option>
                    {config.states.map((value) => (
                      <option key={value} value={value}>
                        {STATE_LABELS[value]}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}
              {has('milkYieldLiters') ? (
                <Field label={FIELD_LABELS.milkYieldLiters} error={view.fields.milk.error} hint={`Ixtiyoriy. ${NO_EFFECT_HINT}`}>
                  <Input
                    inputMode="decimal"
                    autoComplete="off"
                    value={milk}
                    onChange={(event) => setMilk(event.target.value)}
                    onBlur={touch('milk')}
                  />
                </Field>
              ) : null}
              <Field label="Oziqlantirish muddati (kun)" error={view.fields.days.error} required>
                <Input
                  inputMode="numeric"
                  autoComplete="off"
                  value={days}
                  onChange={(event) => setDays(event.target.value)}
                  onBlur={touch('days')}
                />
              </Field>
              <div className="flex items-end gap-2">
                {DAY_PRESETS.map((preset) => (
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
              <Field label="Izoh" error={view.notesError} hint="Ixtiyoriy" className="sm:col-span-2">
                <Textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} onBlur={touch('notes')} />
              </Field>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="2. Ombordagi yemlar"
              description="Yemni tanlang va bir hayvonga kuniga qancha berilishini kiriting"
              icon={<Wheat className="size-5" />}
              actions={
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Plus aria-hidden className="size-4" />}
                  disabled={lines.length >= MAX_LINES || chosen.size >= feedItems.length}
                  onClick={() => setLines((current) => [...current, newLine()])}
                >
                  Yem qo‘shish
                </Button>
              }
            />
            <CardBody className="flex flex-col gap-3">
              {feed.isSuccess && feedItems.length === 0 ? (
                <EmptyState
                  title="Omborda hali yem yo‘q"
                  description="Ratsion ombordagi yemlardan tuziladi."
                  action={
                    <ButtonLink to="/feed?new=1" variant="secondary">
                      Yem qo‘shish
                    </ButtonLink>
                  }
                />
              ) : (
                view.rows.map((row, index) => {
                  const unit = row.item ? UNIT_SHORT[row.item.unit] : 'kg';
                  return (
                    <div
                      key={row.line.key}
                      className="grid gap-3 rounded-[12px] border border-line p-3 sm:grid-cols-[minmax(0,1fr)_170px_auto] sm:items-start"
                    >
                      <Field label={`${index + 1}-yem`} error={row.itemError} required>
                        <Select
                          value={row.line.itemId}
                          disabled={feed.isPending}
                          onChange={(event) => updateLine(row.line.key, { itemId: event.target.value })}
                          onBlur={touch(`${row.line.key}:item`)}
                        >
                          <option value="">Tanlang</option>
                          {row.archivedName ? (
                            <option value={row.line.itemId} disabled>
                              {row.archivedName} — arxivlangan
                            </option>
                          ) : null}
                          {feedItems
                            .filter((item) => item.id === row.line.itemId || !chosen.has(item.id))
                            .map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.name} — {formatQuantity(item.quantity, item.unit)}
                              </option>
                            ))}
                        </Select>
                      </Field>
                      <Field label={`Bir boshga, kuniga (${unit})`} error={row.daily.error} required>
                        <Input
                          inputMode="decimal"
                          autoComplete="off"
                          placeholder="Masalan: 8"
                          value={row.line.daily}
                          onChange={(event) => updateLine(row.line.key, { daily: event.target.value })}
                          onBlur={touch(`${row.line.key}:daily`)}
                        />
                      </Field>
                      <IconButton
                        label={`${index + 1}-yemni olib tashlash`}
                        icon={<Trash2 aria-hidden className="size-4" />}
                        disabled={lines.length === 1}
                        onClick={() => setLines((current) => current.filter((line) => line.key !== row.line.key))}
                        className="sm:mt-7"
                      />
                      {row.item ? (
                        <p className="text-[13px] text-ink-secondary sm:col-span-3">
                          Omborda: {formatQuantity(row.item.quantity, row.item.unit)} ·{' '}
                          {row.item.unitPrice ? `${formatMoney(row.item.unitPrice)}/${unit}` : '1 kg narxi kiritilmagan'}
                        </p>
                      ) : null}
                    </div>
                  );
                })
              )}
            </CardBody>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-6 xl:col-span-2">
          <Card>
            <CardHeader title="Ratsion natijalari" icon={<Calculator className="size-5" />} />
            <CardBody className="flex flex-col gap-4">
              {excludedLines > 0 ? (
                <Alert tone="warning" title={`${excludedLines} ta yem qatori noto‘g‘ri — natijaga kiritilmadi`}>
                  Yemni tanlang va bir boshga kunlik miqdorni musbat son bilan kiriting.
                </Alert>
              ) : null}
              {countValue && daysValue && resultLines.length > 0 ? (
                <RationResultView
                  typeName={type.name}
                  animalCount={countValue.toNumber()}
                  days={daysValue.toNumber()}
                  lines={resultLines}
                />
              ) : (
                <p className="py-6 text-center text-ink-secondary">
                  Hayvonlar sonini, muddatni va kamida bitta yemni kiriting — natija shu yerda hisoblanadi.
                </p>
              )}
            </CardBody>
          </Card>
          <FormError message={save.error ? saveErrorMessage(save.error, 'Ratsion') : null} />
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              <Button
                type="submit"
                loading={save.isPending}
                disabled={strictCheck.hasErrors}
                icon={<Save aria-hidden className="size-5" />}
              >
                Ratsionni saqlash
              </Button>
              <ButtonLink to={backTo} variant="secondary" icon={<ArrowLeft aria-hidden className="size-5" />}>
                Orqaga
              </ButtonLink>
            </div>
            {saveHint ? <p className="text-[13px] text-ink-secondary">{saveHint}</p> : null}
          </div>
        </div>
      </div>
    </form>
  );
}
