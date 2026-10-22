import { describe, expect, it } from 'vitest';
import { describeWeight, parseWeightInput, type WeightInput } from './units';

const kg = (input: Partial<WeightInput>) =>
  parseWeightInput({ amount: '', unit: 'kg', bagWeight: '', ...input }).kilograms?.toString() ?? null;

describe('weights typed in kg, tonnes or bags', () => {
  it('2 tonnes are 2 000 kg', () => {
    expect(kg({ amount: '2', unit: 't' })).toBe('2000');
    expect(kg({ amount: '0.5', unit: 't' })).toBe('500');
    expect(kg({ amount: '1.2345', unit: 't' })).toBe('1234.5');
  });

  it('10 bags of 50 kg are 500 kg', () => {
    expect(kg({ amount: '10', unit: 'bag', bagWeight: '50' })).toBe('500');
    expect(kg({ amount: '3', unit: 'bag', bagWeight: '25.5' })).toBe('76.5');
  });

  it('kilograms stay as typed', () => {
    expect(kg({ amount: '250.5' })).toBe('250.5');
  });

  it('a bag needs its weight', () => {
    const result = parseWeightInput({ amount: '10', unit: 'bag', bagWeight: '' });
    expect(result.kilograms).toBeNull();
    expect(result.bagWeightError).toBe('Bir qop necha kg ekanini kiriting');
    expect(parseWeightInput({ amount: '10', unit: 'bag', bagWeight: '0' }).bagWeightError).not.toBeNull();
  });

  it('empty, zero, negative and malformed amounts are field errors', () => {
    expect(parseWeightInput({ amount: '', unit: 'kg', bagWeight: '' }).amountError).toBe('Miqdorni kiriting');
    expect(parseWeightInput({ amount: '', unit: 'kg', bagWeight: '' }, { required: false }).amountError).toBeNull();
    for (const amount of ['0', '-5', 'abc', '1.2.3']) {
      const result = parseWeightInput({ amount, unit: 'kg', bagWeight: '' });
      expect(result.kilograms).toBeNull();
      expect(result.amountError).not.toBeNull();
    }
  });

  it('a stock count may be zero when asked for', () => {
    expect(parseWeightInput({ amount: '0', unit: 'kg', bagWeight: '' }, { allowZero: true }).kilograms?.toString()).toBe('0');
  });

  it('refuses a result the backend cannot store exactly (more than 3 decimals in kg)', () => {
    const result = parseWeightInput({ amount: '0.5', unit: 'bag', bagWeight: '0.333' });
    expect(result.kilograms).toBeNull();
    expect(result.amountError).toBe('Natija kg da ko‘pi bilan 3 ta kasr raqam bo‘lsin');
  });

  it('describes the converted weight for the confirmation', () => {
    const tonnes = parseWeightInput({ amount: '2', unit: 't', bagWeight: '' }).kilograms;
    const bags = parseWeightInput({ amount: '10', unit: 'bag', bagWeight: '50' }).kilograms;
    if (!tonnes || !bags) throw new Error('not parsed');
    expect(describeWeight({ amount: '2', unit: 't' }, tonnes)).toMatch(/^2 tonna \(2\s000 kg\)$/u);
    expect(describeWeight({ amount: '10', unit: 'bag' }, bags)).toBe('10 qop (500 kg)');
  });
});
