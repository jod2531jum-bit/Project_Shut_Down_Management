// Pure time/progress model for the Command Center. All timestamps are naive plant-local "YYYY-MM-DDTHH:mm";
// they are compared as if UTC (consistently), so there is no timezone or DST drift.

export type Status = 'Completed' | 'On track' | 'At risk' | 'Delayed' | 'Upcoming';
export const STATUSES: Status[] = ['Completed', 'On track', 'At risk', 'Delayed', 'Upcoming'];
export type Phase = 'shutdown' | 'maintenance' | 'critical' | 'startup' | 'other';
export type PageKey = 'major' | 'minor' | 'common' | 'paper' | 'boiler';

export interface JobProgress { status: string | null; percent: number; actualStart: string | null; actualFinish: string | null; note: string | null; updatedAt: string | null }
export interface Job {
  stableKey: string; sourceRow: number; groupKey: string; parentRow: number | null; depth: number;
  description: string; unit: string; teams: string[]; priority: number; phase: Phase; type: 'activity' | 'milestone' | 'summary';
  plannedStart: string | null; plannedFinish: string | null; durationHrs: number | null; scheduled: boolean; note: string | null;
  progress: JobProgress;
}
export interface Group { key: string; name: string; order: number; page: PageKey; plannedStart: string | null; plannedFinish: string | null }
export interface Dependency { jobRow: number; dependsOnRow: number; kind: 'start-link' | 'finish-link'; crossGroup: boolean }
export interface Plan {
  shutdown: { id: number; name: string; activeImportId: number };
  window: { start: string; end: string; days: number };
  groups: Group[]; jobs: Job[]; dependencies: Dependency[];
}

export const MS_H = 3_600_000;
export const MS_D = 86_400_000;
/** Behind-plan thresholds (percentage points) for derived status. */
export const AT_RISK_GAP = 15;
export const DELAYED_GAP = 35;

export const toMs = (iso: string) => Date.parse(iso + 'Z');
export const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 16);
export const nowLocalIso = (d = new Date()) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export const isLeaf = (j: Job) => j.type !== 'summary';

export function span(j: Job): { s: number; f: number } | null {
  if (!j.scheduled) return null;
  const a = j.plannedStart ?? j.plannedFinish, b = j.plannedFinish ?? j.plannedStart;
  if (!a || !b) return null;
  return { s: toMs(a), f: toMs(b) };
}

export const weight = (j: Job) => { const sp = span(j); return Math.max(1, j.durationHrs ?? (sp ? (sp.f - sp.s) / MS_H : 1)); };

export const percentOf = (j: Job) => (j.progress.status === 'Completed' ? 100 : Math.max(0, Math.min(100, j.progress.percent)));

/** Planned completion (0..100) of a job at time t (ms). */
export function plannedPct(j: Job, t: number): number {
  const sp = span(j);
  if (!sp) return 0;
  if (sp.f <= sp.s) return t >= sp.s ? 100 : 0;
  return Math.max(0, Math.min(100, ((t - sp.s) / (sp.f - sp.s)) * 100));
}

export function statusOf(j: Job, t: number): Status {
  const pct = percentOf(j);
  if (pct >= 100) return 'Completed';
  const manual = j.progress.status;
  if (manual === 'On track' || manual === 'At risk' || manual === 'Delayed') return manual;
  const sp = span(j);
  if (!sp) return 'Upcoming';
  if (t < sp.s) return 'Upcoming';
  if (t >= sp.f) return 'Delayed';
  const gap = plannedPct(j, t) - pct;
  return gap >= DELAYED_GAP ? 'Delayed' : gap >= AT_RISK_GAP ? 'At risk' : 'On track';
}

export interface Aggregate {
  total: number; unscheduled: number; counts: Record<Status, number>;
  actual: number; planned: number; start: string | null; finish: string | null;
}

/** Leaf-only, duration-weighted roll-up so parents and duplicate rows never inflate progress. */
export function aggregate(jobs: Job[], t: number): Aggregate {
  const leaves = jobs.filter(isLeaf);
  const sched = leaves.filter((j) => span(j));
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<Status, number>;
  let w = 0, a = 0, p = 0, lo = Infinity, hi = -Infinity;
  for (const j of sched) {
    counts[statusOf(j, t)]++;
    const wt = weight(j); w += wt; a += wt * percentOf(j); p += wt * plannedPct(j, t);
    const sp = span(j)!; lo = Math.min(lo, sp.s); hi = Math.max(hi, sp.f);
  }
  return {
    total: sched.length, unscheduled: leaves.length - sched.length, counts,
    actual: w ? Math.round(a / w) : 0, planned: w ? Math.round(p / w) : 0,
    start: sched.length ? toIso(lo) : null, finish: sched.length ? toIso(hi) : null,
  };
}

export type DayInfo =
  | { kind: 'before'; daysTo: number; label: string }
  | { kind: 'during'; day: number; of: number; label: string }
  | { kind: 'after'; daysSince: number; label: string };

export function dayInfo(w: Plan['window'], t: number): DayInfo {
  const s = toMs(w.start), e = toMs(w.end);
  if (t < s) { const n = Math.ceil((s - t) / MS_D); return { kind: 'before', daysTo: n, label: `PRE-SHUTDOWN · T-${n}d` }; }
  if (t >= e) { const n = Math.floor((t - e) / MS_D) + 1; return { kind: 'after', daysSince: n, label: `POST-WINDOW · +${n}d` }; }
  const day = Math.floor((t - s) / MS_D) + 1;
  return { kind: 'during', day, of: w.days, label: `DAY ${day} OF ${w.days}` };
}

export interface CurvePoint { day: number; at: string; planned: number }
/** Planned cumulative % at each day boundary of the window. */
export function plannedCurve(jobs: Job[], w: Plan['window']): CurvePoint[] {
  const s = toMs(w.start);
  const sched = jobs.filter((j) => isLeaf(j) && span(j));
  const total = sched.reduce((acc, j) => acc + weight(j), 0) || 1;
  return Array.from({ length: w.days + 1 }, (_, d) => {
    const t = s + d * MS_D;
    const planned = sched.reduce((acc, j) => acc + weight(j) * plannedPct(j, t), 0) / total;
    return { day: d, at: toIso(t), planned: Math.round(planned) };
  });
}

export const pageGroups = (plan: Plan, page: PageKey) => plan.groups.filter((g) => g.page === page).map((g) => g.key);
export const jobsOfPage = (plan: Plan, page: PageKey) => { const keys = new Set(pageGroups(plan, page)); return plan.jobs.filter((j) => keys.has(j.groupKey)); };

export const PHASE_LABEL: Record<Phase, string> = { shutdown: 'Shutdown', maintenance: 'Maintenance', critical: 'Critical Tasks', startup: 'Start-up', other: 'Other' };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fmtShort = (iso: string | null) => (iso ? `${MONTHS[+iso.slice(5, 7) - 1]} ${+iso.slice(8, 10)}, ${iso.slice(11, 16)}` : '—');
export const fmtRange = (a: string | null, b: string | null) => (a && b ? (a === b ? fmtShort(a) : `${fmtShort(a)} – ${fmtShort(b)}`) : a || b ? `${fmtShort(a || b)} (point)` : '—');

// ---- hierarchy helpers (parent links are by sourceRow, unique per plan) ----
export interface Tree { byRow: Map<number, Job>; children: Map<number, Job[]> }
export function buildTree(jobs: Job[]): Tree {
  const byRow = new Map(jobs.map((j) => [j.sourceRow, j]));
  const children = new Map<number, Job[]>();
  for (const j of jobs) if (j.parentRow != null) (children.get(j.parentRow) ?? children.set(j.parentRow, []).get(j.parentRow)!).push(j);
  return { byRow, children };
}
export function leavesUnder(job: Job, tree: Tree): Job[] {
  if (job.type !== 'summary') return [job];
  return (tree.children.get(job.sourceRow) ?? []).flatMap((c) => leavesUnder(c, tree));
}
/** Status of any row: leaves use their own; summaries roll up their descendants. */
export function rowStatus(job: Job, tree: Tree, t: number): { status: Status; actual: number } {
  const leaves = leavesUnder(job, tree).filter((l) => span(l));
  if (!leaves.length) return { status: 'Upcoming', actual: 0 };
  if (job.type !== 'summary') return { status: statusOf(job, t), actual: percentOf(job) };
  const st = leaves.map((l) => statusOf(l, t));
  const a = aggregate(leaves, t).actual;
  const status: Status = st.every((s) => s === 'Completed') ? 'Completed' : st.includes('Delayed') ? 'Delayed' : st.includes('At risk') ? 'At risk' : st.some((s) => s !== 'Upcoming') ? 'On track' : 'Upcoming';
  return { status, actual: a };
}
export const isTimelineRow = (j: Job) => !!span(j) && (j.depth === 0 || j.type === 'summary' || (j.phase === 'critical' && j.depth <= 1));
