import { useEffect, useMemo } from 'react';
import { usePlan } from './PlanContext';
import { StatusPill } from './ui';
import { ProgressEditor } from './ProgressEditor';
import { PHASE_LABEL, buildTree, fmtRange, rowStatus } from '../lib/model';

export function JobModal() {
  const { plan, openJob: job, setOpenJob, asOfMs, me } = usePlan();
  const tree = useMemo(() => buildTree(plan?.jobs ?? []), [plan]);
  useEffect(() => {
    if (!job) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && setOpenJob(null);
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [job, setOpenJob]);
  if (!plan || !job) return null;

  const group = plan.groups.find((g) => g.key === job.groupKey);
  const rs = rowStatus(job, tree, asOfMs);
  const kids = tree.children.get(job.sourceRow) ?? [];
  const parent = job.parentRow != null ? tree.byRow.get(job.parentRow) : null;
  const dependsOn = plan.dependencies.filter((d) => d.jobRow === job.sourceRow).map((d) => ({ d, j: tree.byRow.get(d.dependsOnRow) })).filter((x) => x.j);
  const neededBy = plan.dependencies.filter((d) => d.dependsOnRow === job.sourceRow).map((d) => ({ d, j: tree.byRow.get(d.jobRow) })).filter((x) => x.j);
  const field = (label: string, value: React.ReactNode) => <div><dt className="text-xs text-slate-500">{label}</dt><dd className="font-semibold text-sm mt-0.5">{value}</dd></div>;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-4 overflow-auto" onClick={() => setOpenJob(null)}>
      <div role="dialog" aria-modal="true" aria-label="Job details" onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl shadow-xl w-full max-w-2xl my-8">
        <div className="p-5 border-b border-slate-100 flex items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-1.5">
              <span className="px-2 py-0.5 rounded-md text-xs font-mono font-bold bg-slate-800 text-white">Row {job.sourceRow}</span>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">{group?.name}</span>
              <span className="px-2 py-0.5 rounded-md text-xs bg-slate-200/70 text-slate-700 capitalize">{job.type}</span>
              {job.priority > 0 && <span className="px-2 py-0.5 rounded-md text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200">★ Critical</span>}
            </div>
            <h2 className="text-lg font-bold leading-snug">{job.description || '(no description)'}</h2>
          </div>
          <button type="button" aria-label="Close" onClick={() => setOpenJob(null)} className="text-slate-400 hover:text-slate-700 text-xl leading-none">×</button>
        </div>
        <div className="p-5 space-y-4">
          {!job.scheduled && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">This job has no usable dates in the workbook, so it is not on the timeline. Fix the dates in the Shutdown Form and re-import.</p>}
          <dl className="grid grid-cols-2 gap-4">
            {field('Unit', job.unit || '—')}
            {field('Phase', PHASE_LABEL[job.phase])}
            {field('Planned', <span className="font-mono">{fmtRange(job.plannedStart, job.plannedFinish)}</span>)}
            {field('Duration', job.durationHrs != null ? `${job.durationHrs} h` : '—')}
            {field('Responsible', job.teams.length ? job.teams.join(' + ') : '—')}
            {field('Status', <span className="inline-flex items-center gap-2"><StatusPill status={rs.status} compact /><span className="font-mono">{rs.actual}%</span></span>)}
          </dl>
          {job.note && <p className="text-sm rounded-lg bg-slate-50 border border-slate-200 px-3 py-2"><b>Note from workbook:</b> {job.note}</p>}
          {parent && <p className="text-xs text-slate-500">Part of: <button type="button" className="underline" onClick={() => setOpenJob(parent)}>{parent.description}</button></p>}
          {kids.length > 0 && (
            <div><h3 className="text-xs font-bold text-slate-500 mb-1">Steps ({kids.length})</h3>
              <ul className="text-sm divide-y divide-slate-100 max-h-40 overflow-auto border border-slate-100 rounded-lg">
                {kids.map((k) => <li key={k.stableKey}><button type="button" onClick={() => setOpenJob(k)} className="w-full text-left px-3 py-1 hover:bg-slate-50 flex justify-between gap-3"><span className="truncate">{k.description}</span><span className="font-mono text-xs text-slate-500 shrink-0">{k.plannedStart?.slice(5, 16).replace('T', ' ') ?? '—'}</span></button></li>)}
              </ul></div>
          )}
          {(dependsOn.length > 0 || neededBy.length > 0) && (
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><h3 className="text-xs font-bold text-slate-500 mb-1">Depends on</h3>{dependsOn.length ? dependsOn.map(({ d, j }) => <button type="button" key={d.dependsOnRow + d.kind} onClick={() => setOpenJob(j!)} className="block text-left underline truncate max-w-full">{j!.description}{d.crossGroup ? ' ↗' : ''}</button>) : <span className="text-slate-400">—</span>}</div>
              <div><h3 className="text-xs font-bold text-slate-500 mb-1">Needed by</h3>{neededBy.length ? neededBy.map(({ d, j }) => <button type="button" key={d.jobRow + d.kind} onClick={() => setOpenJob(j!)} className="block text-left underline truncate max-w-full">{j!.description}{d.crossGroup ? ' ↗' : ''}</button>) : <span className="text-slate-400">—</span>}</div>
            </div>
          )}
          {job.type === 'summary'
            ? <p className="text-xs text-slate-500">This is a summary row: its status and progress roll up from its steps. Update the individual steps.</p>
            : me?.role === 'viewer' || !me?.role
              ? <p className="text-xs text-slate-500">You have view-only access. The Editor role is needed to update progress.</p>
              : <ProgressEditor key={job.stableKey + (job.progress.updatedAt ?? '')} job={job} />}
        </div>
      </div>
    </div>
  );

}
