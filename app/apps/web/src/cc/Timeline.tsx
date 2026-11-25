import { useMemo, useState } from 'react';
import { usePlan } from './PlanContext';
import { STATUS_STYLES } from './ui';
import { MS_D, PHASE_LABEL, buildTree, fmtRange, isTimelineRow, rowStatus, span, toMs, type Group, type Job } from '../lib/model';

const ROW_H = 26, LABEL_W = 300;

export function Timeline({ groups, jobs }: { groups: Group[]; jobs: Job[] }) {
  const { plan, asOfMs, setOpenJob } = usePlan();
  const [zoom, setZoom] = useState<'day' | 'shift'>('day');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const tree = useMemo(() => buildTree(plan?.jobs ?? []), [plan]);
  const rows = useMemo(() => jobs.filter(isTimelineRow), [jobs]);
  if (!plan) return null;

  const spans = rows.map((j) => span(j)!);
  const ws = toMs(plan.window.start), we = toMs(plan.window.end);
  const lo = Math.min(ws, ...spans.map((s) => s.s)), hi = Math.max(we, ...spans.map((s) => s.f));
  const start = Math.floor(lo / MS_D) * MS_D, end = Math.ceil(hi / MS_D) * MS_D;
  const days = Math.round((end - start) / MS_D);
  const pxDay = zoom === 'day' ? 56 : 168;
  const x = (t: number) => ((t - start) / MS_D) * pxDay;
  const width = days * pxDay;
  const dayCells = Array.from({ length: days }, (_, i) => new Date(start + i * MS_D));
  const grid = `repeating-linear-gradient(to right, transparent 0, transparent ${pxDay - 1}px, #e2e8f0 ${pxDay - 1}px, #e2e8f0 ${pxDay}px)`;

  return (
    <section aria-label="Timeline" className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center gap-3">
        <h3 className="text-sm font-extrabold">Timeline</h3>
        <span className="text-xs text-slate-500">Phase-level rows; open the job list below for every step. Shaded band = shutdown window; dashed line = as-of time.</span>
        <div className="ml-auto flex rounded-lg border border-slate-200 overflow-hidden text-xs font-semibold">
          {(['day', 'shift'] as const).map((z) => <button key={z} type="button" aria-pressed={zoom === z} onClick={() => setZoom(z)} className={`px-3 py-1 ${zoom === z ? 'bg-slate-900 text-white' : 'bg-white text-slate-600'}`}>{z === 'day' ? 'Day' : 'Shift (8 h)'}</button>)}
        </div>
      </div>
      <div className="overflow-auto max-h-[560px]">
        <div style={{ width: LABEL_W + width }} className="relative">
          <div className="flex sticky top-0 z-20 bg-white border-b border-slate-200">
            <div style={{ width: LABEL_W }} className="sticky left-0 z-30 bg-white border-r border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-500">Unit / phase</div>
            <div className="flex" style={{ width }}>
              {dayCells.map((d, i) => {
                const t = d.getTime(); const inWin = t >= Math.floor(ws / MS_D) * MS_D && t < we;
                return <div key={i} style={{ width: pxDay }} className={`text-[10px] font-mono text-center py-1.5 border-r border-slate-100 ${inWin ? 'bg-blue-50 text-blue-800 font-semibold' : 'text-slate-500'}`}>{d.toISOString().slice(8, 10)}/{d.toISOString().slice(5, 7)}</div>;
              })}
            </div>
          </div>

          {groups.map((g) => {
            const gRows = rows.filter((j) => j.groupKey === g.key);
            if (!gRows.length) return null;
            const open = !collapsed[g.key];
            return (
              <div key={g.key}>
                <div className="flex bg-slate-50 border-b border-slate-200" style={{ height: ROW_H }}>
                  <button type="button" onClick={() => setCollapsed({ ...collapsed, [g.key]: open })} aria-expanded={open}
                    style={{ width: LABEL_W }} className="sticky left-0 z-10 bg-slate-50 border-r border-slate-200 px-3 text-left text-xs font-extrabold truncate">{open ? '▾' : '▸'} {g.name}</button>
                  <div className="text-[11px] font-mono text-slate-500 px-2 flex items-center">{fmtRange(g.plannedStart, g.plannedFinish)}</div>
                </div>
                {open && gRows.map((j) => {
                  const sp = span(j)!; const rs = rowStatus(j, tree, asOfMs); const st = STATUS_STYLES[rs.status];
                  const left = x(sp.s), w = Math.max(x(sp.f) - left, 0);
                  const milestone = j.type === 'milestone' || w < 4;
                  return (
                    <div key={j.stableKey} className="flex border-b border-slate-100 hover:bg-slate-50/70" style={{ height: ROW_H }}>
                      <div style={{ width: LABEL_W }} className="sticky left-0 z-10 bg-white border-r border-slate-200 px-3 flex items-center gap-2 text-xs truncate" title={j.description}>
                        <span className="text-[10px] font-mono text-slate-400 shrink-0 w-14 truncate">{j.unit}</span>
                        <span className={`truncate ${j.type === 'summary' ? 'font-semibold' : ''}`}>{j.priority > 0 && <span className="text-amber-500">★ </span>}{j.description}</span>
                      </div>
                      <div className="relative" style={{ width, backgroundImage: grid }}>
                        <div className="absolute inset-y-0 bg-blue-50/40 pointer-events-none" style={{ left: x(ws), width: x(we) - x(ws) }} />
                        <button type="button" onClick={() => setOpenJob(j)} title={`${j.description}\n${PHASE_LABEL[j.phase]} · ${rs.status} · ${rs.actual}%`}
                          className={`absolute top-1 h-[18px] border text-[10px] text-white text-left px-1.5 overflow-hidden whitespace-nowrap ${st.bar} ${milestone ? 'w-[14px] -ml-[7px] rotate-45 rounded-[2px] !px-0' : 'rounded-md'}`}
                          style={milestone ? { left: left } : { left, width: Math.max(w, 6) }}>
                          {!milestone && w > 90 ? j.description : ''}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
          {asOfMs >= start && asOfMs <= end && <div className="absolute top-0 bottom-0 border-l-2 border-dashed border-slate-900 z-10 pointer-events-none" style={{ left: LABEL_W + x(asOfMs) }} />}
        </div>
      </div>
    </section>
  );
}
