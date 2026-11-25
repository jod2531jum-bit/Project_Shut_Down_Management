import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseShutdownForm, ShutdownFormError, type ParseResult } from '../src/index.js';

const FILE = resolve(__dirname, "../../../../Major Shutdown Schedule Oct'26 (15 days) Rev.I.xlsx");
const d = existsSync(FILE) ? describe : describe.skip;

d('Shutdown Form Rev.I golden file', () => {
  let r: ParseResult;
  const job = (row: number) => r.jobs.find((j) => j.sourceRow === row)!;
  const codes = (row: number) => r.issues.filter((i) => i.row === row).map((i) => i.code);
  beforeAll(async () => { r = await parseShutdownForm(FILE); }, 60_000);

  it('finds layout and groups', () => {
    expect(r.sheet).toBe('OCT2026');
    expect(r.headerRow).toBe(10);
    expect(r.groups).toHaveLength(27);
    expect(r.jobs).toHaveLength(404);
    expect(r.summary.map((s) => s.label)).toContain('PULP-1 (CP)');
  });

  it('derives the 15-day window from data', () => {
    expect(r.window).toMatchObject({ start: '2026-10-16T06:00', end: '2026-10-31T06:00', days: 15 });
  });

  it('builds phases and hierarchy', () => {
    expect(job(14)).toMatchObject({ phase: 'shutdown', type: 'summary', plannedStart: '2026-10-14T13:00', plannedFinish: '2026-10-15T18:00', durationHrs: 29 });
    expect(job(15)).toMatchObject({ parentRow: 14, depth: 1 });
    expect(job(24)).toMatchObject({ phase: 'critical', parentRow: 23, priority: 1, teams: ['MSRM'] });
    expect(job(165)).toMatchObject({ phase: 'critical', parentRow: 164, depth: 2 });
    expect(job(31).phase).toBe('startup');
    expect(job(23).teams).toEqual(['MMPU', 'EMPU']);
  });

  it('imports cell comments as notes', () => {
    expect(job(125).note).toContain('Sumitomo/Aegon');
    expect(job(456).note).toContain('Drain 8 hr');
  });

  it('reports known data-quality problems instead of hiding them', () => {
    for (const row of [276, 277, 278, 279, 419]) expect(codes(row)).toContain('REF_ERROR');
    expect(codes(269)).toContain('NEGATIVE_DURATION');
    expect(codes(76)).toContain('BAD_HOURS');
    expect(codes(293)).toContain('TEXT_DATE');
    expect(codes(36)).toContain('TEXT_DATE');
    expect(codes(296)).toContain('OUT_OF_WINDOW'); // TG-2 stale (March)
    expect(codes(455)).toContain('OUT_OF_WINDOW');
    expect(job(296).scheduled).toBe(false);
    expect(job(276).scheduled).toBe(false);
  });

  it('treats single-date rows as milestones and rolls up label rows', () => {
    expect(job(21)).toMatchObject({ type: 'milestone' });
    expect(job(327).scheduled).toBe(true); // label row rolled up from children
    expect(codes(327)).toContain('ROLLED_UP');
  });

  it('extracts cross-group links and keeps ids stable', async () => {
    expect(r.dependencies.some((x) => x.crossGroup)).toBe(true);
    const r2 = await parseShutdownForm(FILE);
    expect(r2.jobs.map((j) => j.stableKey)).toEqual(r.jobs.map((j) => j.stableKey));
    expect(new Set(r.jobs.map((j) => j.stableKey)).size).toBe(r.jobs.length);
  });

  it('rejects non-shutdown files with a clear error', async () => {
    await expect(parseShutdownForm(Buffer.from('not a zip'))).rejects.toBeInstanceOf(ShutdownFormError);
  });
});
