import { useMemo } from 'react';
import { aggregate, plannedCurve, toMs, MS_D, type Job, type Plan } from '../lib/model';

const W = 640, H = 210, L = 42, R = 20, T = 18, B = 34;

export function SCurve({ jobs, window: w, asOfMs, title }: { jobs: Job[]; window: Plan['window']; asOfMs: number; title: string }) {
  const pts = useMemo(() => plannedCurve(jobs, w), [jobs, w]);
  const agg = useMemo(() => aggregate(jobs, asOfMs), [jobs, asOfMs]);
  const s = toMs(w.start);
  const x = (day: number) => L + (day / w.days) * (W - L - R);
  const y = (p: number) => T + (H - T - B) - (p / 100) * (H - T - B);
  const nowDay = (asOfMs - s) / MS_D;
  const inWindow = nowDay >= 0 && nowDay <= w.days;
  const clamped = Math.max(0, Math.min(w.days, nowDay));
  const line = pts.map((p) => `${x(p.day).toFixed(1)},${y(p.planned).toFixed(1)}`).join(' ');
  const labelEvery = Math.max(1, Math.ceil(w.days / 8));

  return (
    <figure className="rounded-2xl border border-slate-200 bg-white p-4">
      <figcaption className="flex items-baseline justify-between mb-1">
        <span className="text-sm font-extrabold">{title} · S-curve</span>
        <span className="text-xs text-slate-500">Planned <b className="font-mono">{agg.planned}%</b> · Actual <b className="font-mono">{agg.actual}%</b> (duration-weighted)</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`${title} planned versus actual progress`}>
        {[0, 25, 50, 75, 100].map((p) => (
          <g key={p}><line x1={L} x2={W - R} y1={y(p)} y2={y(p)} stroke="#e2e8f0" /><text x={L - 6} y={y(p) + 3} textAnchor="end" fontSize="10" fill="#64748b">{p}%</text></g>
        ))}
        {pts.filter((p) => p.day % labelEvery === 0).map((p) => (
          <text key={p.day} x={x(p.day)} y={H - 14} textAnchor="middle" fontSize="10" fill="#64748b">{p.at.slice(8, 10)}/{p.at.slice(5, 7)}</text>
        ))}
        <polygon points={`${x(0)},${y(0)} ${line} ${x(w.days)},${y(0)}`} fill="#dbeafe" opacity="0.5" />
        <polyline points={line} fill="none" stroke="#2563eb" strokeWidth="2.5" strokeLinejoin="round" />
        {inWindow && <line x1={x(clamped)} x2={x(clamped)} y1={T} y2={H - B} stroke="#0f172a" strokeDasharray="4 3" />}
        <circle cx={x(clamped)} cy={y(agg.actual)} r="5" fill="#059669" stroke="#fff" strokeWidth="2"><title>{`Actual ${agg.actual}% as of now`}</title></circle>
      </svg>
      {!inWindow && <p className="text-xs text-slate-500">As-of time is {nowDay < 0 ? 'before' : 'after'} the shutdown window; the marker shows {nowDay < 0 ? 'the start' : 'the end'} of the window.</p>}
    </figure>
  );
}
