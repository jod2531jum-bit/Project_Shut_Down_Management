import type { Status } from '../lib/model';

export const STATUS_STYLES: Record<Status, { badge: string; dot: string; bar: string; text: string }> = {
  Completed: { badge: 'bg-emerald-50 text-emerald-800 border-emerald-200', dot: 'bg-emerald-500', bar: 'bg-emerald-600 border-emerald-700', text: 'text-emerald-800' },
  'On track': { badge: 'bg-blue-50 text-blue-800 border-blue-200', dot: 'bg-blue-500', bar: 'bg-blue-600 border-blue-700', text: 'text-blue-800' },
  'At risk': { badge: 'bg-amber-50 text-amber-800 border-amber-200', dot: 'bg-amber-500', bar: 'bg-amber-500 border-amber-600', text: 'text-amber-800' },
  Delayed: { badge: 'bg-red-50 text-red-800 border-red-300', dot: 'bg-red-600', bar: 'bg-red-600 border-red-800', text: 'text-red-800' },
  Upcoming: { badge: 'bg-slate-100 text-slate-700 border-slate-200', dot: 'bg-slate-400', bar: 'bg-slate-400 border-slate-500', text: 'text-slate-600' },
};

export function StatusPill({ status, compact }: { status: Status; compact?: boolean }) {
  const s = STATUS_STYLES[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border font-semibold ${s.badge} ${compact ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-0.5 text-xs'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />{status === 'On track' ? 'On Track' : status === 'At risk' ? 'At Risk' : status}
    </span>
  );
}

/** Actual progress bar with a tick for planned progress. */
export function ProgressBar({ actual, planned }: { actual: number; planned: number }) {
  return (
    <div className="relative h-2 rounded-full bg-slate-200" role="progressbar" aria-valuenow={actual} aria-valuemin={0} aria-valuemax={100} aria-label={`Actual ${actual}%, planned ${planned}%`}>
      <div className={`h-2 rounded-full ${actual >= planned ? 'bg-emerald-500' : 'bg-blue-600'}`} style={{ width: `${actual}%` }} />
      <div className="absolute -top-0.5 h-3 w-0.5 bg-slate-900" style={{ left: `${planned}%` }} title={`Planned ${planned}%`} />
    </div>
  );
}
