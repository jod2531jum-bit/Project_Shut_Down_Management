import { useState } from 'react';
import { ImportPage } from './ImportPage';
import { HistoryPage } from './HistoryPage';
import { PlanProvider, usePlan } from './cc/PlanContext';
import { Overview, PAGE_META } from './cc/Overview';
import { GroupPage } from './cc/GroupPage';
import { JobModal } from './cc/JobModal';
import { authMode, signOut } from './auth';
import { aggregate, fmtRange, jobsOfPage, type PageKey } from './lib/model';

type Tab = 'overview' | PageKey | 'import' | 'history';
const PAGE_TABS: PageKey[] = ['major', 'minor', 'common', 'paper', 'boiler'];

function Shell() {
  const [tab, setTab] = useState<Tab>('overview');
  const { plan, loading, error, reload, info, asOfIso, override, setOverride, asOfMs, me } = usePlan();
  const canImport = me?.role === 'importer';
  const delayed = plan ? aggregate(plan.jobs, asOfMs).counts.Delayed : 0;

  const btn = (t: Tab, label: string, badge?: number | string) => (
    <button key={t} type="button" onClick={() => setTab(t)} aria-pressed={tab === t}
      className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap flex items-center gap-1.5 transition ${tab === t ? 'bg-white text-blue-700 shadow-sm ring-1 ring-slate-200' : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'}`}>
      {label}{badge !== undefined && <span className="px-1.5 rounded-full text-[10px] font-mono font-bold bg-slate-200 text-slate-700">{badge}</span>}
    </button>
  );

  const hasPlan = !!plan;
  let body;
  if ((tab === 'import' || tab === 'history') && !canImport) body = <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">Importing and import history need the Importer role. Ask an administrator if you should have it.</p>;
  else if (tab === 'import') body = <ImportPage onCommitted={() => { reload(); setTab('overview'); }} />;
  else if (tab === 'history') body = <HistoryPage onChanged={reload} />;
  else if (loading && !plan) body = <p className="text-sm text-slate-500">Loading plan…</p>;
  else if (error) body = <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>;
  else if (!plan) body = (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
      <h2 className="text-lg font-extrabold mb-1">No shutdown plan yet</h2>
      <p className="text-sm text-slate-600 mb-4">Upload the Shutdown Form workbook to populate the Command Center.</p>
      <button type="button" onClick={() => setTab('import')} className="px-4 py-2 rounded-lg text-sm font-bold bg-blue-600 text-white">Import workbook</button>
    </div>
  );
  else if (tab === 'overview') body = <Overview go={setTab} />;
  else body = <GroupPage key={tab} page={tab} />;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-[1480px] mx-auto px-6 py-3 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-900 text-amber-400 flex items-center justify-center font-extrabold shrink-0">SD</div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-base font-extrabold tracking-tight">PLANT SHUTDOWN COMMAND CENTER</h1>
                {info && <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold bg-blue-50 text-blue-700 border border-blue-200"><span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-pulse" />{info.label} · {asOfIso.replace('T', ' ')}</span>}
              </div>
              <p className="text-xs text-slate-500">{plan ? <>Window: <span className="font-mono font-semibold text-slate-700">{fmtRange(plan.window.start, plan.window.end)}</span> · {plan.shutdown.name}</> : 'Import the Shutdown Form to begin'}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 overflow-x-auto">
            {hasPlan && (
              <label className="text-xs text-slate-600 flex items-center gap-1.5 shrink-0">As of
                <input type="datetime-local" aria-label="As-of time" value={asOfIso} onChange={(e) => e.target.value && setOverride(e.target.value)} className="rounded-md border border-slate-300 px-1.5 py-1 font-mono text-xs" />
                {override && <button type="button" onClick={() => setOverride(null)} className="px-2 py-1 rounded-md bg-slate-100 hover:bg-slate-200 border border-slate-200 font-semibold">Real clock</button>}
              </label>
            )}
            <nav aria-label="Views" className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200/80 shrink-0">
              {hasPlan && btn('overview', 'Overview', delayed || undefined)}
              {hasPlan && PAGE_TABS.filter((p) => jobsOfPage(plan!, p).length).map((p) => btn(p, PAGE_META[p].label))}
              {canImport && btn('import', 'Import')}
              {canImport && btn('history', 'History')}
            </nav>
            {me && <div className="text-xs text-slate-600 shrink-0 text-right"><div className="font-semibold">{me.name}</div><div className="capitalize">{me.role ?? 'no role'}</div></div>}
            {authMode === 'entra' && <button type="button" onClick={() => signOut()} className="px-2 py-1 rounded-md bg-slate-100 hover:bg-slate-200 border border-slate-200 text-xs font-semibold shrink-0">Sign out</button>}
          </div>
        </div>
      </header>
      <main className="max-w-[1480px] w-full mx-auto px-6 py-6 flex-1">{body}</main>
      <JobModal />
    </div>
  );
}

export function App() { return <PlanProvider><Shell /></PlanProvider>; }
