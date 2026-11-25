import { useMemo, useState } from 'react';
import { ApiError, PAGES, PAGE_LABEL, api, fmt, type Issue, type Page, type Review } from './api';

const SEV_STYLE: Record<Issue['severity'], string> = {
  error: 'bg-red-50 text-red-800 border-red-200',
  warn: 'bg-amber-50 text-amber-800 border-amber-200',
  info: 'bg-blue-50 text-blue-800 border-blue-200',
};

function Card({ label, value, tone = 'text-slate-900' }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={`text-2xl font-extrabold font-mono ${tone}`}>{value}</div>
    </div>
  );
}

export function ReviewPanel({ review, onChange, onDone }: { review: Review; onChange: (r: Review) => void; onDone: (committed: boolean) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ack, setAck] = useState(false);
  const [sev, setSev] = useState<Issue['severity'] | 'all'>('all');
  const [q, setQ] = useState('');
  const [win, setWin] = useState({ start: review.window?.start ?? '', end: review.window?.end ?? '' });

  const stats = review.stats;
  const unmapped = review.unmappedGroups ?? [];
  const errors = stats.issues.error;
  const winDirty = review.window != null && (win.start !== review.window.start || win.end !== review.window.end);
  const canCommit = !busy && unmapped.length === 0 && (errors === 0 || ack) && !winDirty && !!review.window?.start;

  const issues = useMemo(() => review.issues.filter((i) => (sev === 'all' || i.severity === sev) && (!q || `${i.row} ${i.code} ${i.message}`.toLowerCase().includes(q.toLowerCase()))), [review.issues, sev, q]);

  async function run<T>(fn: () => Promise<T>, then?: (v: T) => void) {
    setError(null); setBusy(true);
    try { const v = await fn(); then?.(v); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Request failed'); }
    finally { setBusy(false); }
  }

  const diff = review.diff;
  return (
    <section aria-label="Import review" className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold">Review import</h2>
          <p className="text-sm text-slate-600"><span className="font-mono font-semibold">{review.filename}</span> · staged, not yet live</p>
        </div>
        <button type="button" disabled={busy} onClick={() => run(() => api.discard(review.id), () => onDone(false))}
          className="px-3 py-1.5 rounded-lg text-sm font-medium bg-slate-100 hover:bg-slate-200 border border-slate-200">Discard upload</button>
      </div>

      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {review.duplicateOfActive && <p className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">This file is identical to the plan that is currently live.</p>}

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <Card label="Groups" value={stats.groups} />
        <Card label="Jobs" value={stats.jobs} />
        <Card label="Scheduled" value={stats.scheduled} tone="text-emerald-700" />
        <Card label="Unscheduled" value={stats.unscheduled} tone={stats.unscheduled ? 'text-amber-600' : undefined} />
        <Card label="Milestones" value={stats.milestones} />
        <Card label="Errors" value={errors} tone={errors ? 'text-red-600' : 'text-emerald-700'} />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-extrabold mb-1">Shutdown window</h3>
        <p className="text-xs text-slate-500 mb-3">
          Detected from “{review.window?.detectedFrom ?? 'n/a'}” ({review.window?.days ?? '–'} days). Data spans {fmt(review.extent?.start)} → {fmt(review.extent?.end)}. Day counts in the Command Center come from this window.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-medium text-slate-600">Start
            <input type="datetime-local" aria-label="Window start" value={win.start} onChange={(e) => setWin({ ...win, start: e.target.value })} className="block mt-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm font-mono" /></label>
          <label className="text-xs font-medium text-slate-600">End
            <input type="datetime-local" aria-label="Window end" value={win.end} onChange={(e) => setWin({ ...win, end: e.target.value })} className="block mt-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm font-mono" /></label>
          <button type="button" disabled={!winDirty || busy} onClick={() => run(() => api.setWindow(review.id, win.start, win.end), onChange)}
            className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-slate-900 text-white disabled:opacity-40">Apply window</button>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <h3 className="text-sm font-extrabold">Group → Command Center page</h3>
          <p className="text-xs text-slate-500">Defaults are inferred from the workbook; your choices are remembered for the next upload.</p>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="text-left px-4 py-2">Section</th><th className="text-right px-4 py-2">Jobs</th><th className="text-left px-4 py-2">Planned window</th><th className="text-left px-4 py-2">Page</th></tr></thead>
          <tbody>
            {review.groups?.map((g) => (
              <tr key={g.key} className={`border-t border-slate-100 ${!g.page ? 'bg-amber-50' : ''}`}>
                <td className="px-4 py-1.5 font-medium">{g.name}</td>
                <td className="px-4 py-1.5 text-right font-mono">{g.jobs}</td>
                <td className="px-4 py-1.5 font-mono text-xs text-slate-600">{fmt(g.plannedStart)} → {fmt(g.plannedFinish)}</td>
                <td className="px-4 py-1.5">
                  <select aria-label={`Page for ${g.name}`} value={g.page ?? ''} disabled={busy}
                    onChange={(e) => run(() => api.setMapping(review.id, { [g.key]: e.target.value as Page }), onChange)}
                    className="rounded-md border border-slate-300 px-2 py-1 text-sm bg-white">
                    {!g.page && <option value="">Choose…</option>}
                    {PAGES.map((p) => <option key={p} value={p}>{PAGE_LABEL[p]}</option>)}
                  </select>
                  {g.page && g.suggested && g.page !== g.suggested && <span className="ml-2 text-xs text-slate-500">(suggested {PAGE_LABEL[g.suggested]})</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {diff && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-extrabold mb-2">{diff.baselineImportId == null ? 'First import' : 'Changes vs. current plan'}</h3>
          <div className="flex flex-wrap gap-6 text-sm">
            <span><b className="font-mono">{diff.added}</b> added</span>
            <span><b className="font-mono">{diff.changed}</b> dates changed</span>
            <span><b className="font-mono">{diff.removed}</b> removed</span>
            <span><b className="font-mono">{diff.unchanged}</b> unchanged</span>
            <span><b className="font-mono">{diff.preservedProgress}</b> progress records kept</span>
            {diff.orphanedProgress > 0 && <span className="text-amber-700"><b className="font-mono">{diff.orphanedProgress}</b> progress records no longer match a job</span>}
          </div>
          {diff.changedSample.length > 0 && (
            <ul className="mt-3 text-xs space-y-1 max-h-48 overflow-auto">
              {diff.changedSample.map((c) => (
                <li key={c.stableKey} className="font-mono">{c.description.slice(0, 50)}: {fmt(c.before.start)} → {fmt(c.after.start)} … {fmt(c.before.finish)} → {fmt(c.after.finish)}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-extrabold mr-2">Issues ({review.issues.length})</h3>
          {(['all', 'error', 'warn', 'info'] as const).map((s) => (
            <button key={s} type="button" onClick={() => setSev(s)} aria-pressed={sev === s}
              className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${sev === s ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-300'}`}>
              {s === 'all' ? 'All' : `${s} (${stats.issues[s]})`}
            </button>
          ))}
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search row, code, text" aria-label="Search issues" className="ml-auto rounded-lg border border-slate-300 px-2 py-1 text-xs w-56" />
        </div>
        <div className="max-h-80 overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 sticky top-0"><tr><th className="text-left px-4 py-2 w-16">Row</th><th className="text-left px-4 py-2 w-28">Severity</th><th className="text-left px-4 py-2 w-44">Code</th><th className="text-left px-4 py-2">Message</th></tr></thead>
            <tbody>
              {issues.map((i, n) => (
                <tr key={n} className="border-t border-slate-100">
                  <td className="px-4 py-1.5 font-mono">{i.row}</td>
                  <td className="px-4 py-1.5"><span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${SEV_STYLE[i.severity]}`}>{i.severity}</span></td>
                  <td className="px-4 py-1.5 font-mono text-xs">{i.code}</td>
                  <td className="px-4 py-1.5 text-slate-700">{i.message}</td>
                </tr>
              ))}
              {issues.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-500">No issues match.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 flex flex-wrap items-center gap-4">
        {errors > 0 && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            I have reviewed the {errors} error(s). Affected rows are imported as unscheduled.
          </label>
        )}
        {unmapped.length > 0 && <span className="text-sm text-amber-700">{unmapped.length} group(s) still need a page.</span>}
        {winDirty && <span className="text-sm text-amber-700">Apply the window change first.</span>}
        <button type="button" disabled={!canCommit}
          onClick={() => run(() => api.commit(review.id, ack), () => onDone(true))}
          className="ml-auto px-5 py-2 rounded-lg text-sm font-bold bg-blue-600 text-white disabled:opacity-40">
          {busy ? 'Working…' : 'Commit to Command Center'}
        </button>
      </div>
    </section>
  );
}
