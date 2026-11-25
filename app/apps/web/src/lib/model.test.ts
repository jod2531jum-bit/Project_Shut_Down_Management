import { describe, it, expect } from 'vitest';
import { aggregate, dayInfo, plannedCurve, plannedPct, statusOf, toMs, type Job } from './model';

const mk = (o: Partial<Job> & { s?: string | null; f?: string | null; pct?: number }): Job => ({
  stableKey: 'k' + Math.random(), sourceRow: 1, groupKey: 'g', parentRow: null, depth: 0, description: 'x', unit: 'u', teams: [], priority: 0,
  phase: 'shutdown', type: 'activity', plannedStart: o.s ?? null, plannedFinish: o.f ?? null, durationHrs: null, scheduled: o.s != null || o.f != null, note: null,
  progress: { status: null, percent: o.pct ?? 0, actualStart: null, actualFinish: null, note: null, updatedAt: null }, ...o,
});
const T = (iso: string) => toMs(iso);

describe('status derivation', () => {
  const j = mk({ s: '2026-10-20T00:00', f: '2026-10-22T00:00' }); // 48h
  it('is Upcoming before start and Delayed after finish if unfinished', () => {
    expect(statusOf(j, T('2026-10-19T00:00'))).toBe('Upcoming');
    expect(statusOf(j, T('2026-10-22T00:00'))).toBe('Delayed');
  });
  it('compares actual to planned while running', () => {
    const half = T('2026-10-21T00:00');
    expect(statusOf(mk({ s: j.plannedStart, f: j.plannedFinish, pct: 50 }), half)).toBe('On track');
    expect(statusOf(mk({ s: j.plannedStart, f: j.plannedFinish, pct: 30 }), half)).toBe('At risk'); // 20 pts behind
    expect(statusOf(mk({ s: j.plannedStart, f: j.plannedFinish, pct: 5 }), half)).toBe('Delayed'); // 45 pts behind
  });
  it('100% is Completed and manual status wins over derivation', () => {
    expect(statusOf(mk({ s: j.plannedStart, f: j.plannedFinish, pct: 100 }), T('2026-10-30T00:00'))).toBe('Completed');
    const manual = mk({ s: j.plannedStart, f: j.plannedFinish, progress: { status: 'At risk', percent: 50, actualStart: null, actualFinish: null, note: null, updatedAt: null } });
    expect(statusOf(manual, T('2026-10-21T00:00'))).toBe('At risk');
  });
  it('milestones complete at their instant', () => {
    const m = mk({ type: 'milestone', s: '2026-10-21T08:00' });
    expect(plannedPct(m, T('2026-10-21T07:00'))).toBe(0);
    expect(plannedPct(m, T('2026-10-21T08:00'))).toBe(100);
  });
});

describe('aggregate', () => {
  it('counts leaves only and weights by duration', () => {
    const parent = mk({ type: 'summary', s: '2026-10-20T00:00', f: '2026-10-30T00:00' });
    const long = mk({ s: '2026-10-20T00:00', f: '2026-10-30T00:00', durationHrs: 240, pct: 100 });
    const short = mk({ s: '2026-10-20T00:00', f: '2026-10-20T10:00', durationHrs: 10, pct: 0 });
    const noDates = mk({});
    const a = aggregate([parent, long, short, noDates], T('2026-10-31T00:00'));
    expect(a.total).toBe(2);
    expect(a.unscheduled).toBe(1);
    expect(a.counts.Completed).toBe(1);
    expect(a.counts.Delayed).toBe(1);
    expect(a.actual).toBe(96); // 240/250
    expect(a.planned).toBe(100);
  });
  it('handles empty input', () => {
    expect(aggregate([], 0)).toMatchObject({ total: 0, actual: 0, planned: 0, start: null });
  });
});

describe('window clock', () => {
  const w = { start: '2026-10-16T06:00', end: '2026-10-31T06:00', days: 15 };
  it('labels before / during / after', () => {
    expect(dayInfo(w, T('2026-10-15T06:00')).label).toBe('PRE-SHUTDOWN · T-1d');
    expect(dayInfo(w, T('2026-10-16T06:00')).label).toBe('DAY 1 OF 15');
    expect(dayInfo(w, T('2026-10-20T12:00')).label).toBe('DAY 5 OF 15');
    expect(dayInfo(w, T('2026-11-19T14:00')).kind).toBe('after');
  });
  it('plannedCurve is monotonic from 0 to 100 across the window', () => {
    const jobs = [mk({ s: '2026-10-16T06:00', f: '2026-10-31T06:00', durationHrs: 360 })];
    const c = plannedCurve(jobs, w);
    expect(c).toHaveLength(16);
    expect(c[0].planned).toBe(0);
    expect(c[15].planned).toBe(100);
    for (let i = 1; i < c.length; i++) expect(c[i].planned).toBeGreaterThanOrEqual(c[i - 1].planned);
  });
});
