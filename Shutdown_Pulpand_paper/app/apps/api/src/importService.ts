import { createHash } from 'node:crypto';
import { parseShutdownForm, ShutdownFormError, type ParseResult } from '@shutdown/parser';
import { tx, type Db } from './db.js';
import { isPage, nameKey, suggestPage, type Page } from './mapping.js';

export const SHUTDOWN_ID = 1;

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) { super(message); }
}

type Row = Record<string, any>;
const now = () => new Date().toISOString();
const ISO_LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function ensureShutdown(db: Db, name: string) {
  const row = db.prepare('SELECT id FROM shutdown WHERE id = ?').get(SHUTDOWN_ID);
  if (!row) db.prepare('INSERT INTO shutdown (id, name, created_at) VALUES (?, ?, ?)').run(SHUTDOWN_ID, name, now());
}

function activeImportId(db: Db): number | null {
  const r = db.prepare('SELECT active_import_id AS id FROM shutdown WHERE id = ?').get(SHUTDOWN_ID) as Row | undefined;
  return r?.id ?? null;
}

function statsOf(p: ParseResult) {
  const byPhase: Record<string, number> = {};
  for (const j of p.jobs) byPhase[j.phase] = (byPhase[j.phase] ?? 0) + 1;
  const sev = { error: 0, warn: 0, info: 0 };
  for (const i of p.issues) sev[i.severity]++;
  return {
    groups: p.groups.length, jobs: p.jobs.length,
    scheduled: p.jobs.filter((j) => j.scheduled).length,
    unscheduled: p.jobs.filter((j) => !j.scheduled).length,
    milestones: p.jobs.filter((j) => j.type === 'milestone').length,
    byPhase, issues: sev,
  };
}

// ---------------------------------------------------------------- stage
export async function stageImport(db: Db, opts: { filename: string; buffer: Buffer; uploadedBy?: string }) {
  const { filename, buffer } = opts;
  if (!/\.xlsx$/i.test(filename)) throw new HttpError(400, 'Only .xlsx files are accepted (macro-enabled .xlsm and legacy .xls are rejected).');
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) throw new HttpError(400, 'File is not a valid .xlsx (missing ZIP signature).');

  let parse: ParseResult;
  try { parse = await parseShutdownForm(buffer); }
  catch (e) {
    if (e instanceof ShutdownFormError) throw new HttpError(422, e.message);
    throw e;
  }

  const remembered = new Map((db.prepare('SELECT name_key, page FROM group_mapping').all() as Row[]).map((r) => [r.name_key, r.page as Page]));
  const mapping: Record<string, Page | null> = {};
  for (const g of parse.groups) mapping[g.key] = remembered.get(nameKey(g.name)) ?? suggestPage(g.name);

  const sha256 = createHash('sha256').update(buffer).digest('hex');
  return tx(db, () => {
    ensureShutdown(db, filename.replace(/\.xlsx$/i, ''));
    const info = db.prepare(
      `INSERT INTO import_run (shutdown_id, filename, sha256, uploaded_by, uploaded_at, status, stats_json, parse_json, mapping_json, window_start, window_end)
       VALUES (?, ?, ?, ?, ?, 'staged', ?, ?, ?, ?, ?)`,
    ).run(SHUTDOWN_ID, filename, sha256, opts.uploadedBy ?? null, now(), JSON.stringify(statsOf(parse)), JSON.stringify(parse), JSON.stringify(mapping), parse.window?.start ?? null, parse.window?.end ?? null);
    const id = Number(info.lastInsertRowid);
    const ins = db.prepare('INSERT INTO import_issue (import_id, source_row, code, severity, message) VALUES (?, ?, ?, ?, ?)');
    for (const i of parse.issues) ins.run(id, i.row, i.code, i.severity, i.message);
    return id;
  });
}

// ---------------------------------------------------------------- review
function loadRun(db: Db, id: number): Row {
  const r = db.prepare('SELECT * FROM import_run WHERE id = ?').get(id) as Row | undefined;
  if (!r) throw new HttpError(404, `Import ${id} not found`);
  return r;
}

function computeDiff(db: Db, parse: ParseResult) {
  const activeId = activeImportId(db);
  const prev = new Map<string, Row>();
  if (activeId != null)
    for (const r of db.prepare('SELECT stable_key, description, group_key, planned_start, planned_finish, duration_hrs FROM job WHERE import_id = ?').all(activeId) as Row[]) prev.set(r.stable_key, r);
  const changed: Array<Record<string, unknown>> = [];
  let added = 0, unchanged = 0;
  const next = new Set<string>();
  for (const j of parse.jobs) {
    next.add(j.stableKey);
    const p = prev.get(j.stableKey);
    if (!p) { added++; continue; }
    if (p.planned_start !== j.plannedStart || p.planned_finish !== j.plannedFinish || p.duration_hrs !== j.durationHrs)
      changed.push({ stableKey: j.stableKey, group: j.groupKey, description: j.description, before: { start: p.planned_start, finish: p.planned_finish }, after: { start: j.plannedStart, finish: j.plannedFinish } });
    else unchanged++;
  }
  const removed = [...prev.keys()].filter((k) => !next.has(k));
  const progressKeys = (db.prepare('SELECT stable_key FROM job_progress WHERE shutdown_id = ?').all(SHUTDOWN_ID) as Row[]).map((r) => r.stable_key as string);
  return {
    baselineImportId: activeId, added, removed: removed.length, changed: changed.length, unchanged,
    preservedProgress: progressKeys.filter((k) => next.has(k)).length,
    orphanedProgress: progressKeys.filter((k) => !next.has(k)).length,
    changedSample: changed.slice(0, 200),
  };
}

export function getReview(db: Db, id: number) {
  const run = loadRun(db, id);
  const base = {
    id, filename: run.filename, status: run.status as string, uploadedAt: run.uploaded_at, committedAt: run.committed_at,
    stats: JSON.parse(run.stats_json),
    issues: (db.prepare('SELECT source_row AS row, code, severity, message FROM import_issue WHERE import_id = ? ORDER BY source_row, rowid').all(id) as Row[]),
    duplicateOfActive: (() => { const a = activeImportId(db); return a != null && (db.prepare('SELECT sha256 FROM import_run WHERE id = ?').get(a) as Row).sha256 === run.sha256; })(),
  };
  if (run.status !== 'staged') return { ...base, window: run.window_start ? { start: run.window_start, end: run.window_end } : null };

  const parse: ParseResult = JSON.parse(run.parse_json);
  const mapping: Record<string, Page | null> = JSON.parse(run.mapping_json);
  const counts = new Map<string, number>();
  for (const j of parse.jobs) counts.set(j.groupKey, (counts.get(j.groupKey) ?? 0) + 1);
  return {
    ...base,
    window: { start: run.window_start, end: run.window_end, detectedFrom: parse.window?.source ?? null, days: parse.window ? Math.ceil((Date.parse(run.window_end + 'Z') - Date.parse(run.window_start + 'Z')) / 86400000) : null },
    extent: parse.extent,
    groups: parse.groups.map((g) => ({ key: g.key, name: g.name, jobs: counts.get(g.key) ?? 0, plannedStart: g.plannedStart, plannedFinish: g.plannedFinish, page: mapping[g.key], suggested: suggestPage(g.name) })),
    unmappedGroups: parse.groups.filter((g) => !mapping[g.key]).map((g) => g.key),
    diff: computeDiff(db, parse),
  };
}

// ---------------------------------------------------------------- mapping / window
export function setMapping(db: Db, id: number, patch: Record<string, unknown>) {
  const run = loadRun(db, id);
  if (run.status !== 'staged') throw new HttpError(409, 'Only a staged import can be edited');
  const mapping: Record<string, Page | null> = JSON.parse(run.mapping_json);
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in mapping)) throw new HttpError(400, `Unknown group key "${k}"`);
    if (!isPage(v)) throw new HttpError(400, `Invalid page "${String(v)}" for group "${k}"`);
    mapping[k] = v;
  }
  db.prepare('UPDATE import_run SET mapping_json = ? WHERE id = ?').run(JSON.stringify(mapping), id);
}

export function setWindow(db: Db, id: number, start: unknown, end: unknown) {
  const run = loadRun(db, id);
  if (run.status !== 'staged') throw new HttpError(409, 'Only a staged import can be edited');
  if (typeof start !== 'string' || typeof end !== 'string' || !ISO_LOCAL.test(start) || !ISO_LOCAL.test(end) || end <= start)
    throw new HttpError(400, 'Window needs start < end as local "YYYY-MM-DDTHH:mm"');
  db.prepare('UPDATE import_run SET window_start = ?, window_end = ? WHERE id = ?').run(start, end, id);
}

// ---------------------------------------------------------------- commit / discard / activate
export function commitImport(db: Db, id: number, opts: { acknowledgeErrors?: boolean }) {
  const run = loadRun(db, id);
  if (run.status !== 'staged') throw new HttpError(409, `Import is ${run.status}, not staged`);
  const parse: ParseResult = JSON.parse(run.parse_json);
  const mapping: Record<string, Page | null> = JSON.parse(run.mapping_json);
  const unmapped = parse.groups.filter((g) => !mapping[g.key]).map((g) => g.key);
  if (unmapped.length) throw new HttpError(409, 'Every group must be assigned to a page before commit', { unmappedGroups: unmapped });
  const errors = parse.issues.filter((i) => i.severity === 'error').length;
  if (errors && !opts.acknowledgeErrors) throw new HttpError(409, `${errors} error-level issue(s) must be acknowledged (acknowledgeErrors: true)`, { errors });
  if (!run.window_start || !run.window_end) throw new HttpError(409, 'No shutdown window could be detected; set one before commit');

  const diff = computeDiff(db, parse);
  tx(db, () => {
    const prev = activeImportId(db);
    if (prev != null) db.prepare("UPDATE import_run SET status = 'superseded' WHERE id = ?").run(prev);
    const g = db.prepare('INSERT INTO grp (import_id, key, name, source_row, ord, page, planned_start, planned_finish) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const x of parse.groups) g.run(id, x.key, x.name, x.sourceRow, x.order, mapping[x.key]!, x.plannedStart, x.plannedFinish);
    const j = db.prepare(
      `INSERT INTO job (import_id, group_key, stable_key, source_row, parent_row, depth, description, unit, teams, priority, phase, type, is_marker, planned_start, planned_finish, duration_hrs, scheduled, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const x of parse.jobs)
      j.run(id, x.groupKey, x.stableKey, x.sourceRow, x.parentRow, x.depth, x.description, x.unit, JSON.stringify(x.teams), x.priority, x.phase, x.type, x.isMarker ? 1 : 0, x.plannedStart, x.plannedFinish, x.durationHrs, x.scheduled ? 1 : 0, x.note);
    const d = db.prepare('INSERT INTO job_dependency (import_id, job_row, depends_on_row, kind, cross_group) VALUES (?, ?, ?, ?, ?)');
    for (const x of parse.dependencies) d.run(id, x.jobRow, x.dependsOnRow, x.kind, x.crossGroup ? 1 : 0);
    const m = db.prepare('INSERT INTO group_mapping (name_key, page) VALUES (?, ?) ON CONFLICT(name_key) DO UPDATE SET page = excluded.page');
    for (const x of parse.groups) m.run(nameKey(x.name), mapping[x.key]!);
    db.prepare("UPDATE import_run SET status = 'committed', committed_at = ?, parse_json = NULL WHERE id = ?").run(now(), id);
    db.prepare('UPDATE shutdown SET active_import_id = ?, window_start = ?, window_end = ? WHERE id = ?').run(id, run.window_start, run.window_end, SHUTDOWN_ID);
  });
  return { id, status: 'committed', diff: { ...diff, changedSample: undefined } };
}

export function discardImport(db: Db, id: number) {
  const run = loadRun(db, id);
  if (run.status !== 'staged') throw new HttpError(409, `Import is ${run.status}, not staged`);
  db.prepare("UPDATE import_run SET status = 'discarded', parse_json = NULL WHERE id = ?").run(id);
}

/** Rollback: make a previously committed (now superseded) import the active one again. */
export function activateImport(db: Db, id: number) {
  const run = loadRun(db, id);
  if (run.status !== 'superseded') throw new HttpError(409, `Only a superseded import can be re-activated (this one is ${run.status})`);
  tx(db, () => {
    const prev = activeImportId(db);
    if (prev != null) db.prepare("UPDATE import_run SET status = 'superseded' WHERE id = ?").run(prev);
    db.prepare("UPDATE import_run SET status = 'committed' WHERE id = ?").run(id);
    db.prepare('UPDATE shutdown SET active_import_id = ?, window_start = ?, window_end = ? WHERE id = ?').run(id, run.window_start, run.window_end, SHUTDOWN_ID);
  });
}

export function listImports(db: Db) {
  return (db.prepare('SELECT id, filename, status, uploaded_by AS uploadedBy, uploaded_at AS uploadedAt, committed_at AS committedAt, stats_json FROM import_run ORDER BY id DESC').all() as Row[])
    .map(({ stats_json, ...r }) => ({ ...r, stats: JSON.parse(stats_json), active: r.id === activeImportId(db) }));
}

// ---------------------------------------------------------------- read model
export function getCurrent(db: Db) {
  const sh = db.prepare('SELECT * FROM shutdown WHERE id = ?').get(SHUTDOWN_ID) as Row | undefined;
  const active = sh?.active_import_id as number | undefined;
  if (!sh || active == null) return null;
  const jobs = (db.prepare(
    `SELECT j.*, p.status AS p_status, p.progress AS p_progress, p.actual_start AS p_astart, p.actual_finish AS p_afinish, p.note AS p_note, p.updated_at AS p_updated
       FROM job j LEFT JOIN job_progress p ON p.shutdown_id = ? AND p.stable_key = j.stable_key
      WHERE j.import_id = ? ORDER BY j.source_row`,
  ).all(SHUTDOWN_ID, active) as Row[]).map((r) => ({
    stableKey: r.stable_key, sourceRow: r.source_row, groupKey: r.group_key, parentRow: r.parent_row, depth: r.depth,
    description: r.description, unit: r.unit, teams: JSON.parse(r.teams), priority: r.priority, phase: r.phase, type: r.type,
    plannedStart: r.planned_start, plannedFinish: r.planned_finish, durationHrs: r.duration_hrs, scheduled: !!r.scheduled, note: r.note,
    progress: { status: r.p_status ?? null, percent: r.p_progress ?? 0, actualStart: r.p_astart ?? null, actualFinish: r.p_afinish ?? null, note: r.p_note ?? null, updatedAt: r.p_updated ?? null },
  }));
  return {
    shutdown: { id: sh.id, name: sh.name, activeImportId: active },
    window: { start: sh.window_start as string, end: sh.window_end as string, days: Math.ceil((Date.parse(sh.window_end + 'Z') - Date.parse(sh.window_start + 'Z')) / 86400000) },
    groups: (db.prepare('SELECT key, name, ord AS "order", page, planned_start AS plannedStart, planned_finish AS plannedFinish FROM grp WHERE import_id = ? ORDER BY ord').all(active) as Row[]),
    jobs,
    dependencies: (db.prepare('SELECT job_row AS jobRow, depends_on_row AS dependsOnRow, kind, cross_group AS crossGroup FROM job_dependency WHERE import_id = ?').all(active) as Row[]).map((d) => ({ ...d, crossGroup: !!d.crossGroup })),
  };
}

// Operator progress (full API + UI arrive in step 5; kept here so import carry-over is testable now).
export function setProgress(db: Db, stableKey: string, patch: { status?: string | null; progress?: number; actualStart?: string | null; actualFinish?: string | null; note?: string | null }, by = 'system') {
  const cur = db.prepare('SELECT * FROM job_progress WHERE shutdown_id = ? AND stable_key = ?').get(SHUTDOWN_ID, stableKey) as Row | undefined;
  const next = {
    status: patch.status !== undefined ? patch.status : cur?.status ?? null,
    progress: patch.progress ?? cur?.progress ?? 0,
    actual_start: patch.actualStart !== undefined ? patch.actualStart : cur?.actual_start ?? null,
    actual_finish: patch.actualFinish !== undefined ? patch.actualFinish : cur?.actual_finish ?? null,
    note: patch.note !== undefined ? patch.note : cur?.note ?? null,
  };
  tx(db, () => {
    db.prepare(
      `INSERT INTO job_progress (shutdown_id, stable_key, status, progress, actual_start, actual_finish, note, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(shutdown_id, stable_key) DO UPDATE SET status = excluded.status, progress = excluded.progress, actual_start = excluded.actual_start,
         actual_finish = excluded.actual_finish, note = excluded.note, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    ).run(SHUTDOWN_ID, stableKey, next.status, next.progress, next.actual_start, next.actual_finish, next.note, by, now());
    db.prepare('INSERT INTO job_event (shutdown_id, stable_key, at, by, change_json) VALUES (?, ?, ?, ?, ?)').run(SHUTDOWN_ID, stableKey, now(), by, JSON.stringify({ from: cur ?? null, to: next }));
  });
}
