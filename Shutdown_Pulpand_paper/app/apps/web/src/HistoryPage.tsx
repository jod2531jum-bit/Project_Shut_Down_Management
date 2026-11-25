import { useCallback, useEffect, useState } from 'react';
import { ApiError, api, fmt, type HistoryRow } from './api';

const STATUS_STYLE: Record<string, string> = {
  committed: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  superseded: 'bg-slate-100 text-slate-700 border-slate-200',
  staged: 'bg-amber-50 text-amber-800 border-amber-200',
  discarded: 'bg-slate-50 text-slate-400 border-slate-200',
};

export function HistoryPage({ onChanged }: { onChanged?: () => void }) {
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api.history().then(setRows).catch(() => setError('Could not load history')), []);
  useEffect(() => { load(); }, [load]);

  async function activate(id: number) {
    setError(null);
    try { await api.activate(id); await load(); onChanged?.(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Rollback failed'); }
  }

  return (
    <section aria-label="Import history">
      <h2 className="text-lg font-extrabold mb-3">Import history</h2>
      {error && <p role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500"><tr>
            <th className="text-left px-4 py-2">#</th><th className="text-left px-4 py-2">File</th><th className="text-left px-4 py-2">Uploaded</th>
            <th className="text-right px-4 py-2">Jobs</th><th className="text-right px-4 py-2">Errors</th><th className="text-left px-4 py-2">Status</th><th />
          </tr></thead>
          <tbody>
            {rows?.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="px-4 py-2 font-mono">{r.id}</td>
                <td className="px-4 py-2 font-medium">{r.filename}{r.active && <span className="ml-2 px-2 py-0.5 rounded-full text-[11px] font-bold bg-blue-600 text-white">LIVE</span>}</td>
                <td className="px-4 py-2 font-mono text-xs">{new Date(r.uploadedAt).toLocaleString()}{r.uploadedBy ? ` · ${r.uploadedBy}` : ''}</td>
                <td className="px-4 py-2 text-right font-mono">{r.stats.jobs}</td>
                <td className="px-4 py-2 text-right font-mono">{r.stats.issues.error}</td>
                <td className="px-4 py-2"><span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${STATUS_STYLE[r.status]}`}>{r.status}</span></td>
                <td className="px-4 py-2 text-right">
                  {r.status === 'superseded' && <button type="button" onClick={() => activate(r.id)} className="px-2.5 py-1 rounded-md text-xs font-semibold bg-slate-100 hover:bg-slate-200 border border-slate-200">Make live again</button>}
                </td>
              </tr>
            ))}
            {rows && rows.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">Nothing imported yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
