import { formatDecimal } from '@/shared/lib/format';
import type { AdministrationRoute, DoseUnit, TreatmentDose, TreatmentStatus } from '../api/treatments.api';

export const ROUTE_LABELS: Record<AdministrationRoute, string> = {
  IM: 'mushak ichiga (m/i)',
  IV: 'vena ichiga (v/i)',
  SC: 'teri ostiga (t/o)',
  ORAL: 'og‘iz orqali',
  TOPICAL: 'sirtdan surtiladi',
  INTRAMAMMARY: 'yelin ichiga',
  OTHER: 'boshqa usulda',
};

export const DOSE_UNIT_LABELS: Record<DoseUnit, string> = { MG: 'mg', ML: 'ml' };

export const TREATMENT_STATUS_LABELS: Record<TreatmentStatus, string> = {
  ACTIVE: 'Davom etmoqda',
  COMPLETED: 'Tugallangan',
  CANCELLED: 'Bekor qilingan',
};

/** "45 ml · mushak ichiga (m/i) · kuniga 1 marta · 3 kun" — the dose the server computed. */
export function describeDose(
  dose: Pick<TreatmentDose, 'singleDose' | 'doseUnit' | 'route' | 'frequencyPerDay' | 'durationDays'>,
): string {
  return [
    `${formatDecimal(dose.singleDose, { maxFractionDigits: 4 })} ${DOSE_UNIT_LABELS[dose.doseUnit]}`,
    ROUTE_LABELS[dose.route],
    `kuniga ${dose.frequencyPerDay} marta`,
    `${dose.durationDays} kun`,
  ].join(' · ');
}
