import type { Species } from '@/features/animals/api/animals.api';
import { http } from '@/shared/api/client';
import { cleanParams } from '@/shared/api/pagination';
import type { PageQuery, Paginated } from '@/shared/types/api';

/** Backend enums (prisma: AdministrationRoute, DoseUnit, TreatmentStatus). */
export const ADMINISTRATION_ROUTES = ['IM', 'IV', 'SC', 'ORAL', 'TOPICAL', 'INTRAMAMMARY', 'OTHER'] as const;
export type AdministrationRoute = (typeof ADMINISTRATION_ROUTES)[number];

export type DoseUnit = 'MG' | 'ML';

export const TREATMENT_STATUSES = ['ACTIVE', 'COMPLETED', 'CANCELLED'] as const;
export type TreatmentStatus = (typeof TREATMENT_STATUSES)[number];

/** One medicine of an approved protocol (doses per kg are the veterinarian's). */
export interface ProtocolDrug {
  medicineId: string;
  medicineName: string;
  activeIngredient: string;
  dosePerKg: string;
  doseUnit: DoseUnit;
  maxSingleDose: string | null;
  route: AdministrationRoute;
  frequencyPerDay: number;
  durationDays: number;
  withdrawalMeatDays: number;
  withdrawalMilkDays: number;
}

/** An APPROVED, non-emergency protocol version whose medicines are all approved (GET /vet/recommendations). */
export interface Recommendation {
  protocolId: string;
  protocolCode: string;
  species: Species;
  versionId: string;
  version: number;
  title: string;
  condition: string;
  instructions: string;
  approvedAt: string | null;
  drugs: ProtocolDrug[];
}

export interface RecommendationsPage extends Paginated<Recommendation> {
  emergency: boolean;
  advice: string | null;
}

/** A dose the server computed (min(dose per kg × weight, max single dose)). */
export interface TreatmentDose {
  id: string;
  medicineId: string;
  medicineName: string;
  inventoryItemId: string | null;
  dosePerKg: string;
  doseUnit: DoseUnit;
  singleDose: string;
  route: AdministrationRoute;
  frequencyPerDay: number;
  durationDays: number;
  withdrawalMeatDays: number;
  withdrawalMilkDays: number;
  batchNumber: string | null;
  itemExpiresOn: string | null;
}

export interface Treatment {
  id: string;
  farmId: string;
  animalId: string;
  protocolVersionId: string;
  status: TreatmentStatus;
  startedAt: string;
  /** 'YYYY-MM-DD' (Tashkent) */
  endsOn: string;
  animalWeightKg: string;
  withdrawalMeatUntil: string;
  withdrawalMilkUntil: string;
  /** The server's withdrawal warning, shown as is. */
  warning: string;
  notes: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** What was approved and computed at the start (protocol title, condition, …). */
  protocolSnapshot: unknown;
  doses: TreatmentDose[];
}

export interface StartTreatmentInput {
  animalId: string;
  protocolVersionId: string;
  /** Default on the server: the animal's saved weight. */
  animalWeightKg?: string;
  /** The farm's stock item used for a protocol medicine (optional). */
  items?: Array<{ medicineId: string; inventoryItemId?: string }>;
  notes?: string;
}

export interface TreatmentListQuery extends PageQuery {
  animalId?: string;
  status?: TreatmentStatus;
}

/**
 * /api/v1/vet — treatments are FARMER only. A treatment can start only from
 * a protocol a veterinarian approved; the server computes every dose and the
 * withdrawal dates. It does not take medicine out of stock.
 */
export const treatmentsApi = {
  async list(query: TreatmentListQuery): Promise<Paginated<Treatment>> {
    const { data } = await http.get<Paginated<Treatment>>('/vet/treatments', { params: cleanParams({ ...query }) });
    return data;
  },

  /** Requires an Idempotency-Key: a retried start is applied once. */
  async start(body: StartTreatmentInput, idempotencyKey: string): Promise<Treatment> {
    const { data } = await http.post<Treatment>('/vet/treatments', body, { headers: { 'Idempotency-Key': idempotencyKey } });
    return data;
  },

  async complete(id: string): Promise<Treatment> {
    const { data } = await http.post<Treatment>(`/vet/treatments/${id}/complete`, {});
    return data;
  },

  async cancel(id: string): Promise<Treatment> {
    const { data } = await http.post<Treatment>(`/vet/treatments/${id}/cancel`, {});
    return data;
  },

  async recommendations(query: { species?: Species; condition?: string } & PageQuery): Promise<RecommendationsPage> {
    const { data } = await http.get<RecommendationsPage>('/vet/recommendations', { params: cleanParams({ ...query }) });
    return data;
  },
};

/** The protocol title kept in the treatment's snapshot (null when absent). */
export function snapshotTitle(treatment: Pick<Treatment, 'protocolSnapshot'>): string | null {
  const snapshot = treatment.protocolSnapshot;
  if (typeof snapshot !== 'object' || snapshot === null) return null;
  const protocol = (snapshot as { protocol?: unknown }).protocol;
  if (typeof protocol !== 'object' || protocol === null) return null;
  const title = (protocol as { title?: unknown }).title;
  return typeof title === 'string' && title.trim() ? title : null;
}
