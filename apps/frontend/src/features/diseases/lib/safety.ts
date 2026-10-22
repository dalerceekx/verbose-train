import type { DiseaseDetails, DiseaseSummary } from '../api/diseases.api';

/**
 * Diseases that need a veterinarian at once — the examples named in the QA
 * report of 22.10.2026: post-partum paresis ("Sut isitmasi", 7), severe
 * diarrhoea of calves and lambs (9) and tick-borne blood parasites (12).
 * The API has no such flag yet; the final list is to be confirmed by the
 * owner and a veterinarian. Marking a disease urgent only adds a warning to
 * call the vet — it never adds treatment advice.
 */
export const EMERGENCY_DISEASES: ReadonlySet<number> = new Set([7, 9, 12]);

export function isEmergency(disease: Pick<DiseaseSummary, 'number'>): boolean {
  return EMERGENCY_DISEASES.has(disease.number);
}

/**
 * Whether a veterinarian approved the scheme. The reference text the API
 * serves today is always "SOURCE_TEXT" — never approved — so its doses are
 * kept behind an explicit "show" step.
 */
export function isSchemeApproved(disease: Pick<DiseaseSummary, 'status'>): boolean {
  return disease.status !== 'SOURCE_TEXT';
}

/** "v/i" (vena ichiga) or "vena ichiga" in a treatment line: an injection into a vein. */
const INTRAVENOUS = /(^|[^\p{L}])v\/i([^\p{L}]|$)|vena ichiga|vena \(qon tomir\) ichiga/iu;

export function isIntravenous(text: string): boolean {
  return INTRAVENOUS.test(text);
}

/**
 * A disease's lines split in two: the description shown to everyone (the
 * symptoms) and the treatment scheme with its doses, which starts at the
 * first "Davolash sxemasi" line. The title line is the card heading.
 */
export function splitDiseaseLines(lines: DiseaseDetails['lines']): {
  description: DiseaseDetails['lines'];
  scheme: DiseaseDetails['lines'];
} {
  const body = lines.slice(1);
  const start = body.findIndex((line) => line.kind === 'scheme');
  if (start === -1) return { description: body, scheme: [] };
  return { description: body.slice(0, start), scheme: body.slice(start) };
}
