import { useMemo, useState } from 'react';
import { usePlan } from './PlanContext';
import { SCurve } from './SCurve';
import { Timeline } from './Timeline';
import { ProgressBar, StatusPill, STATUS_STYLES } from './ui';
import { PAGE_META } from './Overview';
import { PHASE_LABEL, STATUSES, aggregate, buildTree, fmtRange, jobsOfPage, leavesUnder, rowStatus, statusOf, type Job, type PageKey, type Phase, type Status } from '../lib/model';

const PAGE_SIZE = 100;

export function GroupPage({ page }: { page: PageKey }) {
  const { plan, asOfMs, setOpenJob } = usePlan();
  const [phase, setPhase] = useState<Phase | 'all'>('all');
  const [status, setStatus] = useState<Status | 'all'>('all');
  const [group, setGroup] = useState('all');
  const [q, setQ] = useState('');
  const [shown, setShown] = useState(PAGE_SIZE);

  const groups = useMemo(() => plan?.groups.filter((g) => g.page === page) ?? [], [plan, page]);
  const jobs = useMemo(() => (plan ? jobsOfPage(plan, page) : []), [plan, page]);
  const tree = useMemo(() => buildTree(plan?.jobs ?? []), [plan]);
  const agg = useMemo(() => aggregate(jobs, asOfMs), [jobs, asOfMs]);

  const rows = useMemo(() => jobs.filter((j) => j.type !== 'summary' && j.scheduled).filter((j) =>
    (phase === 'all' || j.phase === phase) && (group === 'all' || j.groupKey === group) &&
    (status === 'all' || statusOf(j, asOfMs) === status) &&
    (!q || `${j.description} ${j.unit} ${j.teams.join(' ')}`.toLowerCase().includes(q.toLowerCase()))), [jobs, phase, group, status, q, asOfMs]);

  // Start-up series: each group's start-up phase in chronological order, with the groups it waits on.
  const series = useMemo(() => {
    if (!plan) return [];
    const groupName = new Map(plan.groups.map((g) => [g.key, g.name]));
    return jobs.filter((j) => j.phase === 'startup' && j.type === 'summary' && j.depth === 0 && j.plannedStart)
      .sort((a, b) => a.plannedStart!.localeCompare(b.plannedStart!))
      .map((j) => {
        const rowsIn = new Set<number>([j.sourceRow, ...leavesUnder(j, tree).map((l) => l.sourceRow)]);
        const waits = new Set<string>();
        for (const d of plan.dependencies) if (d.crossGroup && rowsIn.has(d.jobRow)) { const t = tree.byRow.get(d.dependsOnRow); if (t && t.groupKey !== j.groupKey) waits.add(groupName.get(t.groupKey) ?? t.groupKey); }
        return { job: j, group: groupName.get(j.groupKey) ?? j.groupKey, waits: [...waits], rs: rowStatus(j, tree, asOfMs) };
      });
  }, [plan, jobs, tree, asOfMs]);

  if (!plan) return null;
  if (!jobs.length) return <p className="text-sm text-slate-500">No sections are assigned to {PAGE_META[page].label}. Assign them in the import review.</p>;

  const pill = (active: boolean) => `px-2.5 py-0.5 rounded-full text-xs font-semibold border ${active ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-300'}`;
  return (
    <div className="space-y-6">
      <section aria-label={`${PAGE_META[page].label} summary`}>
        <h2 className="text-lg font-extrabold">{PAGE_META[page].label} · {groups.length} section{groups.length > 1 ? 's' : ''}</h2>
        <p className="text-xs text-slate-500 mb-3 font-mono">{fmtRange(agg.start, agg.finish)} · {agg.total} scheduled jobs{agg.unscheduled ? ` · ${agg.unscheduled} unscheduled` : ''}</p>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-3">
          {STATUSES.map((s) => (
            <button key={s} type="button" onClick={() => setStatus(status === s ? 'all' : s)} aria-pressed={status === s}
              className={`text-left rounded-xl border bg-white px-4 py-3 ${status === s ? 'ring-2 ring-slate-900' : 'border-slate-200'}`}>
              <div className={`text-xs font-bold uppercase tracking-wider ${STATUS_STYLES[s].text}`}>{s}</div>
              <div className="text-2xl font-extrabold font-mono">{agg.counts[s]}</div>
            </button>
          ))}
        </div>
        <ProgressBar actual={agg.actual} planned={agg.planned} />
      </section>

      <div className="grid lg:grid-cols-2 gap-4">
        <SCurve jobs={jobs} window={plan.window} asOfMs={asOfMs} title={PAGE_META[page].label} />
        <section aria-label="Start-up series" className="rounded-2xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-extrabold mb-1">Start-up series</h3>
          <p className="text-xs text-slate-500 mb-3">Each section’s start-up in time order; “waits on” comes from cross-section links in the workbook formulas.</p>
          <ol className="relative space-y-3 pl-6 max-h-56 overflow-auto before:absolute before:left-[7px] before:top-1 before:bottom-1 before:w-[3px] before:rounded-full before:bg-gradient-to-b before:from-emerald-600 before:to-blue-600">
            {series.map((s) => (
              <li key={s.job.stableKey} className="relative">
                <span className={`absolute -left-6 top-1 w-4 h-4 rounded-full border-2 border-white ${STATUS_STYLES[s.rs.status].dot}`} />
                <button type="button" onClick={() => setOpenJob(s.job)} className="text-left w-full">
                  <div className="flex items-center justify-between gap-2"><span className="text-sm font-semibold truncate">{s.group}</span><StatusPill status={s.rs.status} compact /></div>
                  <div className="text-[11px] font-mono text-slate-500">{fmtRange(s.job.plannedStart, s.job.plannedFinish)}{s.waits.length ? ` · waits on ${s.waits.join(', ')}` : ''}</div>
                </button>
              </li>
            ))}
            {series.length === 0 && <li className="text-sm text-slate-500">No start-up phases in this page.</li>}
          </ol>
        </section>
      </div>

      <Timeline groups={groups} jobs={jobs} />

      <section aria-label="Job list" className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-extrabold mr-2">Jobs ({rows.length})</h3>
          <button type="button" className={pill(phase === 'all')} onClick={() => { setPhase('all'); setShown(PAGE_SIZE); }}>All phases</button>
          {(['shutdown', 'maintenance', 'critical', 'startup'] as Phase[]).map((p) => <button key={p} type="button" className={pill(phase === p)} onClick={() => { setPhase(p); setShown(PAGE_SIZE); }}>{PHASE_LABEL[p]}</button>)}
          {groups.length > 1 && (
            <select aria-label="Section" value={group} onChange={(e) => { setGroup(e.target.value); setShown(PAGE_SIZE); }} className="rounded-md border border-slate-300 px-2 py-1 text-xs bg-white">
              <option value="all">All sections</option>{groups.map((g) => <option key={g.key} value={g.key}>{g.name}</option>)}
            </select>
          )}
          <input aria-label="Search jobs" value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE_SIZE); }} placeholder="Search job, unit, team" className="ml-auto rounded-lg border border-slate-300 px-2 py-1 text-xs w-56" />
        </div>
        <div className="overflow-auto max-h-[520px]">
          <table className="w-full min-w-[1000px] text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 sticky top-0"><tr>
              <th className="text-left px-4 py-2">Job</th><th className="text-left px-3 py-2">Unit</th><th className="text-left px-3 py-2">Phase</th><th className="text-left px-3 py-2">Team</th>
              <th className="text-left px-3 py-2">Planned</th><th className="text-right px-3 py-2">Hrs</th><th className="px-3 py-2 w-28">Progress</th><th className="text-left px-3 py-2">Status</th></tr></thead>
            <tbody>
              {rows.slice(0, shown).map((j) => <JobRow key={j.stableKey} job={j} onOpen={() => setOpenJob(j)} t={asOfMs} />)}
              {rows.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500">No jobs match the filters.</td></tr>}
            </tbody>
          </table>
        </div>
        {rows.length > shown && <div className="p-3 text-center border-t border-slate-100"><button type="button" onClick={() => setShown(shown + PAGE_SIZE)} className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-slate-100 hover:bg-slate-200 border border-slate-200">Show {Math.min(PAGE_SIZE, rows.length - shown)} more</button></div>}
      </section>
    </div>
  );
}

function JobRow({ job: j, onOpen, t }: { job: Job; onOpen: () => void; t: number }) {
  const st = statusOf(j, t);
  return (
    <tr onClick={onOpen} className="border-t border-slate-100 hover:bg-blue-50/40 cursor-pointer">
      <td className="px-4 py-1.5" style={{ paddingLeft: 16 + j.depth * 14 }}>{j.priority > 0 && <span className="text-amber-500" title="Critical">★ </span>}{j.type === 'milestone' && <span className="text-slate-400" title="Milestone">◆ </span>}{j.description}</td>
      <td className="px-3 py-1.5 font-mono text-xs text-slate-600">{j.unit}</td>
      <td className="px-3 py-1.5 text-xs text-slate-600 whitespace-nowrap">{PHASE_LABEL[j.phase]}</td>
      <td className="px-3 py-1.5 text-xs">{j.teams.map((x) => <span key={x} className="mr-1 px-1.5 py-0.5 rounded bg-slate-100 font-mono text-[10px]">{x}</span>)}</td>
      <td className="px-3 py-1.5 font-mono text-xs whitespace-nowrap">{fmtRange(j.plannedStart, j.plannedFinish)}</td>
      <td className="px-3 py-1.5 text-right font-mono text-xs">{j.durationHrs ?? '—'}</td>
      <td className="px-3 py-1.5 font-mono text-xs">{j.progress.percent}%</td>
      <td className="px-3 py-1.5"><StatusPill status={st} compact /></td>
    </tr>
  );
}
