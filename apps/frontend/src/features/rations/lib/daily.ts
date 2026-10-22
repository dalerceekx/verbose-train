import { todayInTashkent } from '@/shared/lib/dates';
import type { Ration, RationIssue } from '../api/rations.api';

/** 'YYYY-MM-DD' shifted by `days` calendar days. */
export function addDays(date: string, days: number): string {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export interface DailyStatus {
  /** Today's feeding has been taken from the warehouse. */
  given: boolean;
  /** Last day covered by the latest issue ('YYYY-MM-DD'); null when never issued. */
  coveredUntil: string | null;
  /** When the latest issue was recorded. */
  issuedAt: string | null;
}

/**
 * An issue of N feeding days counts as "given" from its own date
 * (Tashkent) for N days: a 1-day issue covers that day only.
 */
export function dailyStatus(ration: Pick<Ration, 'lastIssue'>, today = todayInTashkent()): DailyStatus {
  const last = ration.lastIssue;
  if (!last) return { given: false, coveredUntil: null, issuedAt: null };
  const from = todayInTashkent(new Date(last.createdAt));
  const coveredUntil = addDays(from, last.days - 1);
  return { given: from <= today && today <= coveredUntil, coveredUntil, issuedAt: last.createdAt };
}

type IssueLike = Pick<RationIssue, 'createdAt' | 'days'>;

/** Days an issue feeds ('YYYY-MM-DD', Tashkent, inclusive): its date and the N − 1 days after. */
export interface IssuePeriod {
  from: string;
  to: string;
}

export function issuePeriod(issue: IssueLike): IssuePeriod {
  const from = todayInTashkent(new Date(issue.createdAt));
  return { from, to: addDays(from, issue.days - 1) };
}

function overlaps(a: IssuePeriod, b: IssuePeriod): boolean {
  return a.from <= b.to && b.from <= a.to;
}

/**
 * Earlier issues that already feed some of the days a new issue of `days`
 * days made today would cover: [today; today + days − 1] ∩ [date; date +
 * days − 1]. Newest first, like the history.
 */
export function overlappingIssues<T extends IssueLike>(issues: readonly T[], days: number, today = todayInTashkent()): T[] {
  const wanted: IssuePeriod = { from: today, to: addDays(today, Math.max(days, 1) - 1) };
  return issues.filter((issue) => overlaps(issuePeriod(issue), wanted));
}

/**
 * "Given today?" from the whole issue history, not only the latest issue:
 * a 7-day issue keeps the ration given until its last day even when an
 * extra 1-day issue was made in between. `coveredUntil` is the latest day
 * any issue covering today reaches.
 */
export function coverageFromIssues(issues: readonly IssueLike[], today = todayInTashkent()): DailyStatus {
  let coveredUntil: string | null = null;
  let issuedAt: string | null = null;
  for (const issue of issues) {
    const period = issuePeriod(issue);
    if (period.from > today || period.to < today) continue;
    if (coveredUntil === null || period.to > coveredUntil) coveredUntil = period.to;
    if (issuedAt === null || issue.createdAt > issuedAt) issuedAt = issue.createdAt;
  }
  return { given: coveredUntil !== null, coveredUntil, issuedAt };
}

/** Issues given while an earlier one still covered their first day — an extra issue ("qo‘shimcha berish"). */
export function additionalIssueIds(issues: readonly (IssueLike & { id: string })[]): Set<string> {
  const ordered = [...issues].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  const result = new Set<string>();
  ordered.forEach((issue, index) => {
    const day = issuePeriod(issue).from;
    const coveredBefore = ordered.slice(0, index).some((earlier) => {
      const period = issuePeriod(earlier);
      return period.from <= day && day <= period.to;
    });
    if (coveredBefore) result.add(issue.id);
  });
  return result;
}
