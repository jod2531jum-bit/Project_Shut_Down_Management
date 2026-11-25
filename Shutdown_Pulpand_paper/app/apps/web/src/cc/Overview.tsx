import { useMemo } from 'react';
import { usePlan } from './PlanContext';
import { SCurve } from './SCurve';
import { ProgressBar, StatusPill, STATUS_STYLES } from './ui';
import { PHASE_LABEL, aggregate, fmtRange, jobsOfPage, STATUSES, type PageKey, type Phase, type Status } from '../lib/model';

export const PAGE_META: Record<PageKey, { label: string }> = {
  major: { label: 'Major' }, minor: { label: 'Minor' }, common: { label: 'Common' }, paper: { label: 'Paper Major' }, boiler: { label: 'Boiler Minor' },
};
const PHASES: Phase[] = ['shutdown', 'critical', 'startup'];

export function Overview({ go }: { go: (page: PageKey) => void }) {
  const { plan, asOfMs, setOpenJob } = usePlan();
  const all = useMemo(() => (plan ? aggregate(plan.jobs, asOfMs) : null), [plan, asOfMs]);
  if (!plan || !all) return null;
  const unscheduled = plan.jobs.filter((j) => j.type !== 'summary' && !j.scheduled);
  const kpi = (s: Status | 'Total', n: number) => (
    <div key={s} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className={`text-xs font-bold uppercase tracking-wider ${s === 'Total' ? 'text-slate-500' : STATUS_STYLES[s].text}`}>{s === 'Total' ? 'Total jobs' : s === 'On track' ? 'On Track' : s === 'At risk' ? 'At Risk' : s}</div>
      <div className="text-3xl font-extrabold font-mono">{n}</div>
    </div>
  );

  return (
    <div className="space-y-6">
      <section aria-label="Turnaround status summary">
        <h2 className="text-lg font-extrabold">Turnaround Executive Overview</h2>
        <p className="text-xs text-slate-500 mb-3">Shutdown window <span className="font-mono font-semibold text-slate-700">{fmtRange(plan.window.start, plan.window.end)}</span> · schedule spans <span className="font-mono">{fmtRange(all.start, all.finish)}</span> · {all.total} scheduled jobs</p>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          {kpi('Total', all.total)}
          {STATUSES.map((s) => kpi(s, all.counts[s]))}
        </div>
        <div className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-3">
          <div className="flex justify-between text-xs mb-1.5"><span className="font-bold">Overall progress</span><span className="font-mono">Actual {all.actual}% · Planned {all.planned}%</span></div>
          <ProgressBar actual={all.actual} planned={all.planned} />
        </div>
      </section>

      <div className="grid lg:grid-cols-2 gap-4">
        <SCurve jobs={plan.jobs} window={plan.window} asOfMs={asOfMs} title="All groups" />
        <section aria-label="Needs attention" className="rounded-2xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-extrabold mb-1">Needs attention</h3>
          <p className="text-xs text-slate-500 mb-2">{unscheduled.length} job(s) have no usable dates (bad or missing in the workbook) and are not on the timeline.</p>
          <ul className="text-sm divide-y divide-slate-100 max-h-48 overflow-auto">
            {unscheduled.map((j) => (
              <li key={j.stableKey}><button type="button" onClick={() => setOpenJob(j)} className="w-full text-left py-1.5 hover:bg-slate-50 flex justify-between gap-3">
                <span className="truncate">{j.description || '(no description)'}</span><span className="font-mono text-xs text-slate-500 shrink-0">row {j.sourceRow}</span></button></li>
            ))}
            {unscheduled.length === 0 && <li className="py-3 text-slate-500">Everything is scheduled.</li>}
          </ul>
        </section>
      </div>

      <section aria-label="Groups" className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {(Object.keys(PAGE_META) as PageKey[]).map((page) => {
          const jobs = jobsOfPage(plan, page);
          if (!jobs.length) return null;
          const a = aggregate(jobs, asOfMs);
          return (
            <article key={page} className="rounded-2xl border border-slate-200 bg-white p-4 flex flex-col gap-3">
              <header className="flex items-start justify-between gap-2">
                <div><h3 className="text-base font-extrabold">{PAGE_META[page].label}</h3><p className="text-xs font-mono text-slate-500">{fmtRange(a.start, a.finish)}</p></div>
                <button type="button" onClick={() => go(page)} className="px-2.5 py-1 rounded-md text-xs font-semibold bg-slate-100 hover:bg-slate-200 border border-slate-200">Open</button>
              </header>
              <ProgressBar actual={a.actual} planned={a.planned} />
              <div className="flex flex-wrap gap-1.5">
                {STATUSES.filter((s) => a.counts[s]).map((s) => <span key={s} className="inline-flex items-center gap-1"><StatusPill status={s} compact /><b className="font-mono text-xs">{a.counts[s]}</b></span>)}
              </div>
              <table className="text-xs w-full"><tbody>
                {PHASES.map((ph) => {
                  const pj = jobs.filter((j) => j.phase === ph && j.type !== 'summary' && j.scheduled);
                  const done = pj.filter((j) => j.progress.status === 'Completed' || j.progress.percent >= 100).length;
                  return <tr key={ph} className="border-t border-slate-100"><td className="py-1 text-slate-600">{PHASE_LABEL[ph]}</td><td className="py-1 text-right font-mono">{done}/{pj.length}</td></tr>;
                })}
              </tbody></table>
            </article>
          );
        })}
      </section>
    </div>
  );
}
