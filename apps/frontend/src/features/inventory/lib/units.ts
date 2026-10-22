import { Decimal } from '@/shared/lib/decimal';
import { formatDecimal } from '@/shared/lib/format';
import { decimalProblem } from '@/shared/lib/validation';

/** How a farmer may type a weight; the API always receives kilograms. */
export type WeightInputUnit = 'kg' | 't' | 'bag';

export const WEIGHT_INPUT_UNITS: readonly WeightInputUnit[] = ['kg', 't', 'bag'];

export const WEIGHT_INPUT_LABELS: Record<WeightInputUnit, string> = { kg: 'kg', t: 'tonna', bag: 'qop' };

const KG_PER_TONNE = Decimal.from(1000);
/** Backend quantities: at most 11 integer and 3 fraction digits. */
const KG_INTEGER_DIGITS = 11;
const KG_FRACTION_DIGITS = 3;
/** Fraction digits an amount may have so that it is still exact in kg. */
const AMOUNT_FRACTION_DIGITS: Record<WeightInputUnit, number> = { kg: 3, t: 6, bag: 3 };
const BAG_WEIGHT_RULE = { maxIntegerDigits: 4, maxFractionDigits: 3, positive: true, max: '1000' };

export interface WeightInput {
  amount: string;
  unit: WeightInputUnit;
  /** Kilograms in one bag; required for bags. */
  bagWeight: string;
}

export interface WeightResult {
  /** The weight in kg, or null while the input is empty or invalid. */
  kilograms: Decimal | null;
  amountError: string | null;
  bagWeightError: string | null;
}

/**
 * Converts a weight typed in kg, tonnes or bags to exact kilograms:
 * 2 t = 2 000 kg; 10 bags × 50 kg = 500 kg. Errors are field messages.
 */
export function parseWeightInput(
  { amount, unit, bagWeight }: WeightInput,
  {
    required = true,
    zeroMessage,
    allowZero = false,
  }: {
    required?: boolean;
    zeroMessage?: string;
    /** A count may be zero (an inventory finding the stock gone). */
    allowZero?: boolean;
  } = {},
): WeightResult {
  const empty = amount.trim() === '';
  let bagWeightError: string | null = null;
  let bag: Decimal | null = null;
  if (unit === 'bag') {
    if (bagWeight.trim() === '') bagWeightError = 'Bir qop necha kg ekanini kiriting';
    else {
      bagWeightError = decimalProblem(bagWeight, BAG_WEIGHT_RULE);
      if (!bagWeightError) bag = Decimal.from(bagWeight);
    }
  }
  if (empty) return { kilograms: null, amountError: required ? 'Miqdorni kiriting' : null, bagWeightError };

  const amountError = decimalProblem(amount, {
    maxIntegerDigits: KG_INTEGER_DIGITS,
    maxFractionDigits: AMOUNT_FRACTION_DIGITS[unit],
    positive: !allowZero,
    ...(zeroMessage ? { zeroMessage } : {}),
  });
  if (amountError) return { kilograms: null, amountError, bagWeightError };
  const value = Decimal.from(amount);
  const kilograms = unit === 'kg' ? value : unit === 't' ? value.mul(KG_PER_TONNE) : bag ? value.mul(bag) : null;
  if (!kilograms) return { kilograms: null, amountError: null, bagWeightError };
  if (kilograms.significantScale() > KG_FRACTION_DIGITS) {
    return { kilograms: null, amountError: 'Natija kg da ko‘pi bilan 3 ta kasr raqam bo‘lsin', bagWeightError };
  }
  if ((kilograms.toString().split('.')[0] ?? '').length > KG_INTEGER_DIGITS) {
    return { kilograms: null, amountError: 'Qiymat juda katta', bagWeightError };
  }
  return { kilograms, amountError: null, bagWeightError };
}

/** "10 qop (500 kg)", "2 tonna (2 000 kg)"; kilograms alone for kg. */
export function describeWeight({ amount, unit }: Pick<WeightInput, 'amount' | 'unit'>, kilograms: Decimal): string {
  const kg = `${formatDecimal(kilograms)} kg`;
  return unit === 'kg' ? kg : `${formatDecimal(Decimal.from(amount))} ${WEIGHT_INPUT_LABELS[unit]} (${kg})`;
}
