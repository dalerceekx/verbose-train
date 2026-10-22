import type { ReactNode } from 'react';
import type { UseFormRegisterReturn } from 'react-hook-form';
import { Field, Input, SegmentedTabs } from '@/shared/ui';
import { WEIGHT_INPUT_LABELS, WEIGHT_INPUT_UNITS, type WeightInputUnit } from '../lib/units';

interface WeightFieldProps {
  /** e.g. "Miqdor" — the chosen unit is added in brackets. */
  label: string;
  required?: boolean;
  hint?: ReactNode;
  /** Unit of the item ("kg", "l"); kg items may also be entered in tonnes or bags. */
  unitShort: string;
  /** Offer kg / tonna / qop (feed kept in kg). */
  unitChoice: boolean;
  inputUnit: WeightInputUnit;
  onInputUnitChange: (unit: WeightInputUnit) => void;
  amount: UseFormRegisterReturn;
  amountError?: string | undefined;
  bagWeight: UseFormRegisterReturn;
  bagWeightError?: string | undefined;
  /** "= 500 kg" once the input converts. */
  converted?: string | null;
  disabled?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
}

/**
 * A quantity input that also takes tonnes and bags for feed kept in kg:
 * "2 tonna" or "10 qop × 50 kg" — the API always receives kilograms, and the
 * converted amount is shown before saving.
 */
export function WeightField({
  label,
  required,
  hint,
  unitShort,
  unitChoice,
  inputUnit,
  onInputUnitChange,
  amount,
  amountError,
  bagWeight,
  bagWeightError,
  converted,
  disabled = false,
  autoFocus = false,
  placeholder = 'Masalan: 500',
}: WeightFieldProps) {
  const shown = unitChoice ? WEIGHT_INPUT_LABELS[inputUnit] : unitShort;
  return (
    <div className="flex flex-col gap-2">
      <Field label={`${label} (${shown})`} error={amountError} required={required} hint={hint}>
        <Input
          {...(autoFocus ? { 'data-autofocus': true } : {})}
          inputMode="decimal"
          autoComplete="off"
          placeholder={placeholder}
          disabled={disabled}
          {...amount}
        />
      </Field>
      {unitChoice && !disabled ? (
        <SegmentedTabs<WeightInputUnit>
          label="Kiritish birligi: kg, tonna yoki qop"
          value={inputUnit}
          onChange={onInputUnitChange}
          tabs={WEIGHT_INPUT_UNITS.map((unit) => ({ value: unit, label: WEIGHT_INPUT_LABELS[unit] }))}
          className="self-start"
        />
      ) : null}
      {unitChoice && inputUnit === 'bag' && !disabled ? (
        <Field label="1 qop necha kg" error={bagWeightError} required hint="Masalan: 50">
          <Input inputMode="decimal" autoComplete="off" placeholder="50" {...bagWeight} />
        </Field>
      ) : null}
      {converted && !disabled ? <p className="text-[13px] font-medium text-ink tabular">= {converted}</p> : null}
    </div>
  );
}
