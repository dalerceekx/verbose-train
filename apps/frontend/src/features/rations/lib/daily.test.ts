import { describe, expect, it } from 'vitest';
import { additionalIssueIds, addDays, coverageFromIssues, dailyStatus, overlappingIssues } from './daily';

const issue = (createdAt: string, days: number) => ({ lastIssue: { id: 'i1', createdAt, days } });

describe('dailyStatus', () => {
  it('is not given when the ration was never issued', () => {
    expect(dailyStatus({ lastIssue: null }, '2026-10-19')).toEqual({ given: false, coveredUntil: null, issuedAt: null });
  });

  it('counts a 1-day issue for its own Tashkent date only', () => {
    // 20:30 UTC on the 18th is already the 19th in Tashkent (UTC+5).
    const status = dailyStatus(issue('2026-10-18T20:30:00.000Z', 1), '2026-10-19');
    expect(status).toMatchObject({ given: true, coveredUntil: '2026-10-19' });
    expect(dailyStatus(issue('2026-10-18T20:30:00.000Z', 1), '2026-10-20').given).toBe(false);
  });

  it('covers every day of a multi-day issue', () => {
    expect(dailyStatus(issue('2026-10-15T06:00:00.000Z', 7), '2026-10-21')).toMatchObject({
      given: true,
      coveredUntil: '2026-10-21',
    });
    expect(dailyStatus(issue('2026-10-15T06:00:00.000Z', 7), '2026-10-22').given).toBe(false);
  });
});

describe('addDays', () => {
  it('crosses month and year ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('issuing the same days twice', () => {
  // 10:00 in Tashkent (UTC+5).
  const at = (date: string) => `${date}T05:00:00.000Z`;
  const issues = [
    { id: 'week', createdAt: at('2026-10-20'), days: 7 },
    { id: 'today', createdAt: at('2026-10-22'), days: 1 },
    { id: 'old', createdAt: at('2026-10-10'), days: 1 },
  ];

  it('finds earlier issues that already feed the days a new issue would cover', () => {
    expect(overlappingIssues(issues, 1, '2026-10-22').map((found) => found.id)).toEqual(['week', 'today']);
    expect(overlappingIssues(issues, 1, '2026-10-27').map((found) => found.id)).toEqual([]);
    // A 3-day issue made on the 25th reaches the 26th — still inside the week.
    expect(overlappingIssues(issues, 3, '2026-10-25').map((found) => found.id)).toEqual(['week']);
  });

  it('a later extra 1-day issue does not shorten a 7-day coverage', () => {
    expect(coverageFromIssues(issues, '2026-10-22')).toEqual({
      given: true,
      coveredUntil: '2026-10-26',
      issuedAt: at('2026-10-22'),
    });
    expect(coverageFromIssues(issues, '2026-10-27').given).toBe(false);
  });

  it('marks an issue made while an earlier one still covered its day as an extra one', () => {
    expect([...additionalIssueIds(issues)]).toEqual(['today']);
  });
});
