import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';
import type { Dependency, Group, ImportIssue, Job, ParseResult, Phase, SummaryRow } from './types.js';
import { ShutdownFormError } from './types.js';
export * from './types.js';

type Raw =
  | { kind: 'date'; iso: string }
  | { kind: 'num'; n: number }
  | { kind: 'text'; s: string }
  | { kind: 'error'; e: string }
  | { kind: 'empty' };

const MIN = 60000;
// ExcelJS returns dates as UTC Date objects whose UTC fields equal the sheet's wall-clock time.
// We keep them as naive plant-local "YYYY-MM-DDTHH:mm" strings (rounded to the minute).
const toIso = (ms: number) => new Date(Math.round(ms / MIN) * MIN).toISOString().slice(0, 16);

function raw(cell: ExcelJS.Cell): Raw {
  let v: any = cell.value;
  if (v && typeof v === 'object' && !(v instanceof Date) && ('formula' in v || 'sharedFormula' in v)) v = v.result ?? null;
  if (v == null || v === '') return { kind: 'empty' };
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? { kind: 'error', e: 'invalid date' } : { kind: 'date', iso: toIso(v.getTime()) };
  if (typeof v === 'number') return { kind: 'num', n: v };
  if (typeof v === 'string') return v.trim() === '' ? { kind: 'empty' } : { kind: 'text', s: v.trim() };
  if (typeof v === 'object' && 'error' in v) return { kind: 'error', e: String(v.error) };
  if (typeof v === 'object' && 'richText' in v) return { kind: 'text', s: v.richText.map((r: any) => r.text).join('').trim() };
  return { kind: 'text', s: String(v) };
}
const text = (c: ExcelJS.Cell) => {
  const r = raw(c);
  return r.kind === 'text' ? r.s : r.kind === 'num' ? String(r.n) : '';
};
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const slug = (s: string) => norm(s).toLowerCase().replace(/[^a-z0-9฀-๿]+/g, '-').replace(/^-|-$/g, '');
const sha = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 16);

// Phase markers inside a group: [pattern, phase, nesting level]
const MARKERS: Array<[RegExp, Phase, number]> = [
  [/^stop sequence/i, 'shutdown', 1],
  [/^stop (?!lmf|burner|wl|gl)/i, 'shutdown', 1],
  [/^ma[i]?ntenance time/i, 'maintenance', 1],
  [/^critical/i, 'critical', 2],
  [/^start sequence/i, 'startup', 1],
  [/^แผนหยุด/, 'shutdown', 1], // แผนหยุด (steam stop plan)
  [/^แผนเริ่ม/, 'startup', 1], // แผนเริ่ม (steam start plan)
];

function noteOf(row: ExcelJS.Row): string | null {
  const out: string[] = [];
  for (let c = 1; c <= 8; c++) {
    const n: any = row.getCell(c).note;
    if (!n) continue;
    const t = typeof n === 'string' ? n : (n.texts ?? []).map((x: any) => x.text).join('');
    const cleaned = t.replace(/^[^\n:]+:\s*\n?/, '').trim(); // drop the "Author:" prefix
    if (cleaned) out.push(cleaned.replace(/\s*\n\s*/g, '; '));
  }
  return out.length ? out.join(' | ') : null;
}

function parseTeams(a: string) {
  const stars = (a.match(/\*+$/) ?? [''])[0].length;
  const teams = a.replace(/\*+$/, '').split(/[+,]/).map(norm).filter(Boolean);
  return { teams, priority: stars };
}

/** Formulas like `D15`, `+D118+7/24`, `$E$22` -> {col,row}; null for anything else. */
function simpleRef(f: unknown): { col: string; row: number } | null {
  if (typeof f !== 'string') return null;
  const m = /^\+?\$?([DE])\$?(\d+)(?:[+-][\d/().]+)?$/.exec(f.replace(/\s/g, ''));
  return m ? { col: m[1], row: Number(m[2]) } : null;
}

export async function parseShutdownForm(input: Buffer | string): Promise<ParseResult> {
  const wb = new ExcelJS.Workbook();
  try {
    if (typeof input === 'string') await wb.xlsx.readFile(input);
    else await wb.xlsx.load(input as any);
  } catch (e) {
    throw new ShutdownFormError(`Cannot read the file as .xlsx: ${(e as Error).message}`);
  }

  // Locate sheet + header row by labels, not fixed addresses.
  let ws: ExcelJS.Worksheet | undefined;
  let headerRow = 0;
  const candidates = [...wb.worksheets.filter((w) => w.name === 'OCT2026'), ...wb.worksheets.filter((w) => w.state === 'visible')];
  for (const w of candidates) {
    for (let r = 1; r <= Math.min(w.rowCount, 40); r++) {
      const row = w.getRow(r);
      if (/^section$/i.test(text(row.getCell(1))) && /^description$/i.test(text(row.getCell(3)))) {
        ws = w;
        headerRow = r;
        break;
      }
    }
    if (ws) break;
  }
  if (!ws) throw new ShutdownFormError('Not a Shutdown Form: no sheet with "Section / Location / Description / Date & Time" headers was found.');
  const firstData = headerRow + 3; // two header rows + the hour-axis row

  const issues: ImportIssue[] = [];
  const issue = (row: number, code: string, severity: ImportIssue['severity'], message: string) => issues.push({ row, code, severity, message });
  const dateOf = (cell: ExcelJS.Cell, row: number, label: string): string | null => {
    const r = raw(cell);
    if (r.kind === 'date') return r.iso;
    if (r.kind === 'error') { issue(row, 'REF_ERROR', 'error', `${label} is not a valid date (Excel error such as #REF!)`); return null; }
    if (r.kind === 'text') { issue(row, 'TEXT_DATE', 'warn', `${label} contains text "${r.s}" instead of a date`); return null; }
    if (r.kind === 'num') { issue(row, 'NUMERIC_DATE', 'warn', `${label} is a number (${r.n}), not a date`); return null; }
    return null;
  };

  // Summary block above the header.
  const summary: SummaryRow[] = [];
  for (let r = 1; r < headerRow - 1; r++) {
    const row = ws.getRow(r);
    const label = norm(text(row.getCell(3)));
    if (!label) continue;
    const s = raw(row.getCell(4)), f = raw(row.getCell(5)), h = raw(row.getCell(8));
    if (s.kind !== 'date') continue;
    summary.push({ row: r, label, start: s.iso, finish: f.kind === 'date' ? f.iso : null, hours: h.kind === 'num' ? Math.round(h.n * 24 * 100) / 100 : null });
  }

  const groups: Group[] = [];
  const jobs: Job[] = [];
  const rowToJob = new Map<number, Job>();
  const formulas: Array<{ row: number; col: 'D' | 'E'; ref: { col: string; row: number } }> = [];
  let group: Group | null = null;
  let stack: Array<{ level: number; job: Job }> = [];
  let phase: Phase = 'other';
  const seen = new Map<string, number>();

  for (let r = firstData; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const A = norm(text(row.getCell(1))), B = norm(text(row.getCell(2)));
    const rawC = text(row.getCell(3));
    const C = norm(rawC);
    const startCell = row.getCell(4), finCell = row.getCell(5);
    const hasDates = raw(startCell).kind !== 'empty' || raw(finCell).kind !== 'empty';
    if (!A && !B && !C && !hasDates) continue;

    if (A === '**') {
      const gs = dateOf(startCell, r, 'Group start'), ge = dateOf(finCell, r, 'Group finish');
      let key = slug(C) || `group-${r}`;
      if (groups.some((g) => g.key === key)) key += `-${r}`;
      group = { key, name: C, sourceRow: r, order: groups.length, plannedStart: gs, plannedFinish: ge };
      groups.push(group);
      stack = [];
      phase = 'other';
      continue;
    }
    if (!group) { issue(r, 'ORPHAN_ROW', 'warn', 'Task row found before any group header (**); skipped'); continue; }
    if (!C) issue(r, 'EMPTY_DESCRIPTION', 'warn', 'Row has dates but no description');

    const { teams, priority } = parseTeams(A);
    const leading = rawC.length - rawC.trimStart().length;
    const bold = !!row.getCell(3).font?.bold;
    const indented = leading >= 2 || (row.getCell(3).alignment?.indent ?? 0) > 0;
    let marker: [Phase, number] | null = null;
    if (!indented || bold) for (const [re, ph, lv] of MARKERS) if (re.test(C)) { marker = [ph, lv]; break; }

    let level = 99;
    if (marker) {
      phase = marker[0];
      level = marker[1];
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    }
    const parent = stack.length ? stack[stack.length - 1].job : null;

    let start = dateOf(startCell, r, 'Start');
    let finish = dateOf(finCell, r, 'Finish');
    const hRaw = raw(row.getCell(8));
    let hours = hRaw.kind === 'num' ? Math.round(hRaw.n * 100) / 100 : null;
    if (hRaw.kind === 'error') issue(r, 'REF_ERROR', 'error', `Duration is an Excel error (${hRaw.e})`);
    if (hours !== null && (hours < 0 || hours > 24 * 60)) { issue(r, 'BAD_HOURS', 'warn', `Duration ${hours} h is implausible; ignored`); hours = null; }

    let scheduled = true;
    if (start && finish) {
      if (finish < start) { issue(r, 'NEGATIVE_DURATION', 'error', `Finish (${finish}) is before start (${start})`); scheduled = false; }
    } else if (!start && !finish) {
      scheduled = false;
      issue(r, 'UNSCHEDULED', 'warn', 'No usable start or finish; listed under Needs attention');
    } else {
      issue(r, start ? 'MISSING_FINISH' : 'MISSING_START', 'info', `Only ${start ? 'start' : 'finish'} given; treated as a milestone`);
    }
    if (!scheduled) { start = null; finish = null; }
    if (scheduled && hours === null && start && finish) {
      hours = Math.round(((Date.parse(finish + 'Z') - Date.parse(start + 'Z')) / 3600000) * 100) / 100;
    }

    const type = !scheduled ? 'activity' : !start || !finish || start === finish ? 'milestone' : 'activity';
    const k = `${group.key}|${phase}|${C.toLowerCase()}`;
    const nth = seen.get(k) ?? 0;
    seen.set(k, nth + 1);
    const job: Job = {
      stableKey: sha(`${k}|${nth}`), sourceRow: r, groupKey: group.key, parentRow: parent?.sourceRow ?? null,
      depth: parent ? parent.depth + 1 : 0, description: C, unit: B, teams, priority, phase, type, isMarker: !!marker,
      plannedStart: start, plannedFinish: finish, durationHrs: hours, scheduled, note: noteOf(row),
    };
    jobs.push(job);
    rowToJob.set(r, job);
    if (marker) stack.push({ level, job });

    for (const col of ['D', 'E'] as const) {
      const v: any = row.getCell(col).value;
      const ref = v && typeof v === 'object' && 'formula' in v ? simpleRef(v.formula) : null;
      if (ref && ref.row !== r) formulas.push({ row: r, col, ref });
    }
  }

  // Parents with children become summaries (roll-ups use leaf jobs only).
  const hasChild = new Set(jobs.map((j) => j.parentRow).filter((x): x is number => x != null));
  for (const j of jobs) if (hasChild.has(j.sourceRow)) j.type = 'summary';
  // Undated parents (pure label rows like "Start sequence") take min/max of their scheduled children, bottom-up.
  for (let i = jobs.length - 1; i >= 0; i--) {
    const j = jobs[i];
    if (j.type !== 'summary' || j.scheduled) continue;
    const kids = jobs.filter((k) => k.parentRow === j.sourceRow && k.scheduled);
    if (!kids.length) continue;
    const ds = kids.flatMap((k) => [k.plannedStart, k.plannedFinish]).filter((x): x is string => !!x).sort();
    j.plannedStart = ds[0]; j.plannedFinish = ds[ds.length - 1]; j.scheduled = true;
    j.durationHrs = Math.round(((Date.parse(j.plannedFinish + 'Z') - Date.parse(j.plannedStart + 'Z')) / 3600000) * 100) / 100;
    const ix = issues.findIndex((x) => x.row === j.sourceRow && x.code === 'UNSCHEDULED');
    if (ix >= 0) issues.splice(ix, 1);
    issue(j.sourceRow, 'ROLLED_UP', 'info', 'No dates on this label row; schedule taken from its child rows');
  }

  // Dependencies: formula links that are not simple parent<->child roll-ups.
  const ancestors = (j: Job) => {
    const s = new Set<number>();
    let p = j.parentRow;
    while (p != null) { s.add(p); p = rowToJob.get(p)?.parentRow ?? null; }
    return s;
  };
  const dependencies: Dependency[] = [];
  for (const f of formulas) {
    const me = rowToJob.get(f.row), tgt = rowToJob.get(f.ref.row);
    if (!me || !tgt) continue;
    if (tgt.parentRow === me.sourceRow || ancestors(tgt).has(me.sourceRow) || ancestors(me).has(tgt.sourceRow)) continue;
    dependencies.push({ jobRow: me.sourceRow, dependsOnRow: tgt.sourceRow, kind: f.col === 'D' ? 'start-link' : 'finish-link', crossGroup: me.groupKey !== tgt.groupKey });
  }

  // Window: first group named "...Production Shutdown", else first group with dates.
  const pg = groups.find((g) => /production shutdown/i.test(g.name) && g.plannedStart && g.plannedFinish) ?? groups.find((g) => g.plannedStart && g.plannedFinish);
  let window: ParseResult['window'] = null;
  if (pg) {
    const ms = Date.parse(pg.plannedFinish + 'Z') - Date.parse(pg.plannedStart + 'Z');
    window = { start: pg.plannedStart!, end: pg.plannedFinish!, days: Math.ceil(ms / 86400000), source: pg.name };
  }
  // Outliers: scheduled jobs entirely more than 21 days outside the window.
  if (window) {
    const lo = Date.parse(window.start + 'Z') - 21 * 86400000;
    const hi = Date.parse(window.end + 'Z') + 21 * 86400000;
    const dropped = new Map<string, Job[]>();
    for (const j of jobs) {
      if (!j.scheduled) continue;
      const s = j.plannedStart ?? j.plannedFinish!, f = j.plannedFinish ?? j.plannedStart!;
      if (Date.parse(f + 'Z') < lo || Date.parse(s + 'Z') > hi) {
        dropped.set(j.groupKey, [...(dropped.get(j.groupKey) ?? []), j]);
        j.scheduled = false; j.plannedStart = null; j.plannedFinish = null;
      }
    }
    for (const [key, js] of dropped) {
      const g = groups.find((x) => x.key === key)!;
      issue(js[0].sourceRow, 'OUT_OF_WINDOW', 'error',
        `${js.length} row(s) in "${g.name}" (rows ${js[0].sourceRow}-${js[js.length - 1].sourceRow}) are dated far outside the shutdown window (more than 21 days); treated as unscheduled. Likely a stale plan.`);
    }
  }
  const dates = jobs.filter((j) => j.scheduled).flatMap((j) => [j.plannedStart, j.plannedFinish]).filter((x): x is string => !!x).sort();
  const extent = dates.length ? { start: dates[0], end: dates[dates.length - 1] } : null;
  issues.sort((a, b) => a.row - b.row);
  return { sheet: ws.name, headerRow, summary, groups, jobs, dependencies, issues, window, extent };
}
