import { useState } from 'react';
import { usePlan } from './PlanContext';
import { authMode } from '../auth';
import type { Job } from '../lib/model';

const STATUS_OPTIONS = ['', 'On track', 'At risk', 'Delayed', 'Completed'] as const;

export function ProgressEditor({ job }: { job: Job }) {
  const { saveProgress, user, setUser, asOfIso } = usePlan();
  const p = job.progress;
  const [status, setStatus] = useState(p.status ?? '');
  const [percent, setPercent] = useState(p.percent);
  const [start, setStart] = useState(p.actualStart ?? '');
  const [finish, setFinish] = useState(p.actualFinish ?? '');
  const [note, setNote] = useState(p.note ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const dirty = (p.status ?? '') !== status || p.percent !== percent || (p.actualStart ?? '') !== start || (p.actualFinish ?? '') !== finish || (p.note ?? '') !== note;

  function validate(): string | null {
    if (!Number.isInteger(percent) || percent < 0 || percent > 100) return 'Progress must be a whole number from 0 to 100.';
    if (status === 'Completed' && percent !== 100) return 'A Completed job must be at 100 %.';
    if (finish && !start) return 'Enter the actual start before the actual finish.';
    if (start && finish && finish < start) return 'Actual finish cannot be before actual start.';
    if ((percent === 100 || status === 'Completed') && !finish) return 'Enter the actual finish time to complete a job.';
    if (finish && percent < 100) return 'A job with an actual finish must be at 100 %.';
    return null;
  }

  async function save() {
    const err = validate();
    if (err) return setMsg({ kind: 'err', text: err });
    setBusy(true); setMsg(null);
    try {
      await saveProgress(job.stableKey, { status, percent, actualStart: start || null, actualFinish: finish || null, note, expectedUpdatedAt: p.updatedAt });
      setMsg({ kind: 'ok', text: 'Saved.' });
    } catch (e) { setMsg({ kind: 'err', text: (e as Error).message }); }
    finally { setBusy(false); }
  }

  function markComplete() {
    setStatus('Completed'); setPercent(100);
    if (!start) setStart(job.plannedStart && job.plannedStart <= asOfIso ? job.plannedStart : asOfIso);
    if (!finish) setFinish(asOfIso);
  }

  const inp = 'block mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm';
  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }} aria-label="Update progress" className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-extrabold">Update progress</h3>
        <button type="button" onClick={markComplete} className="px-2.5 py-1 rounded-md text-xs font-semibold bg-emerald-600 text-white">Mark complete (as of now)</button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs font-medium text-slate-600">Status
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={inp}>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s || 'Automatic (from plan vs. progress)'}</option>)}
          </select></label>
        <label className="text-xs font-medium text-slate-600">Progress %
          <div className="flex items-center gap-2 mt-1">
            <input type="range" min={0} max={100} value={Number.isFinite(percent) ? percent : 0} onChange={(e) => setPercent(Number(e.target.value))} className="flex-1" aria-label="Progress slider" />
            <input type="number" min={0} max={100} value={Number.isFinite(percent) ? percent : ''} onChange={(e) => setPercent(e.target.value === '' ? NaN : Number(e.target.value))} aria-label="Progress percent" className="w-16 rounded-lg border border-slate-300 px-2 py-1 text-sm font-mono" />
          </div></label>
        <label className="text-xs font-medium text-slate-600">Actual start
          <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} aria-label="Actual start" className={inp + ' font-mono'} /></label>
        <label className="text-xs font-medium text-slate-600">Actual finish
          <input type="datetime-local" value={finish} onChange={(e) => setFinish(e.target.value)} aria-label="Actual finish" className={inp + ' font-mono'} /></label>
      </div>
      <label className="block text-xs font-medium text-slate-600">Note
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000} aria-label="Progress note" className={inp} /></label>
      <div className="flex flex-wrap items-end gap-3">
        {authMode === 'none' && <label className="text-xs font-medium text-slate-600">Your name (for the audit trail)
          <input value={user} onChange={(e) => setUser(e.target.value)} placeholder="e.g. Somchai" aria-label="Your name" className="block mt-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm w-48" /></label>}
        <button type="submit" disabled={busy || !dirty} className="ml-auto px-4 py-2 rounded-lg text-sm font-bold bg-blue-600 text-white disabled:opacity-40">{busy ? 'Saving…' : 'Save'}</button>
      </div>
      {msg && <p role={msg.kind === 'err' ? 'alert' : 'status'} className={`text-sm rounded-lg px-3 py-2 border ${msg.kind === 'err' ? 'bg-red-50 text-red-800 border-red-200' : 'bg-emerald-50 text-emerald-800 border-emerald-200'}`}>{msg.text}</p>}
      {p.updatedAt && <p className="text-[11px] text-slate-400">Last saved {new Date(p.updatedAt).toLocaleString()}</p>}
    </form>
  );
}
