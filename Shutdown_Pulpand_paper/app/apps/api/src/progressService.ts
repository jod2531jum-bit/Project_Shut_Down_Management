import type { Db } from './db.js';
import { HttpError, SHUTDOWN_ID, setProgress } from './importService.js';

type Row = Record<string, any>;
const ISO_LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
export const MANUAL_STATUSES = ['On track', 'At risk', 'Delayed', 'Completed'] as const;

export interface ProgressInput {
  status?: string | null;        // null/'' = automatic (derived from plan vs. progress)
  percent?: number;
  actualStart?: string | null;
  actualFinish?: string | null;
  note?: string | null;
  /** updatedAt the client last saw; a mismatch means someone else saved first (409). */
  expectedUpdatedAt?: string | null;
}

function activeJob(db: Db, stableKey: string): Row {
  const job = db.prepare(
    `SELECT j.stable_key, j.type, j.scheduled, j.description FROM job j
       JOIN shutdown s ON s.active_import_id = j.import_id WHERE s.id = ? AND j.stable_key = ?`,
  ).get(SHUTDOWN_ID, stableKey) as Row | undefined;
  if (!job) throw new HttpError(404, 'Job not found in the live plan');
  return job;
}

const localOrNull = (v: unknown, label: string): string | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (typeof v !== 'string' || !ISO_LOCAL.test(v)) throw new HttpError(400, `${label} must be a local "YYYY-MM-DDTHH:mm" time`);
  return v;
};

export function updateProgress(db: Db, stableKey: string, input: ProgressInput, by: string) {
  const job = activeJob(db, stableKey);
  if (job.type === 'summary') throw new HttpError(400, 'Summary rows roll up from their steps; update the individual steps instead');

  const cur = db.prepare('SELECT * FROM job_progress WHERE shutdown_id = ? AND stable_key = ?').get(SHUTDOWN_ID, stableKey) as Row | undefined;
  if (input.expectedUpdatedAt !== undefined && (input.expectedUpdatedAt ?? null) !== (cur?.updated_at ?? null))
    throw new HttpError(409, 'This job was updated by someone else. Reloaded the latest values; review and save again.', { updatedAt: cur?.updated_at ?? null });

  let status: string | null | undefined;
  if (input.status !== undefined) {
    status = input.status === '' ? null : input.status;
    if (status !== null && !(MANUAL_STATUSES as readonly string[]).includes(status)) throw new HttpError(400, `Status must be one of ${MANUAL_STATUSES.join(', ')} or empty for automatic`);
  }
  let percent: number | undefined;
  if (input.percent !== undefined) {
    if (!Number.isInteger(input.percent) || input.percent < 0 || input.percent > 100) throw new HttpError(400, 'Progress must be a whole number from 0 to 100');
    percent = input.percent;
  }
  const actualStart = localOrNull(input.actualStart, 'Actual start');
  let actualFinish = localOrNull(input.actualFinish, 'Actual finish');
  const note = input.note === undefined ? undefined : (input.note?.toString().trim().slice(0, 2000) || null);

  // Cross-field rules evaluated on the resulting record.
  const next = {
    status: status !== undefined ? status : cur?.status ?? null,
    percent: percent ?? cur?.progress ?? 0,
    start: actualStart !== undefined ? actualStart : cur?.actual_start ?? null,
    finish: actualFinish !== undefined ? actualFinish : cur?.actual_finish ?? null,
  };
  // Reopening a completed job (progress lowered) clears its completed status and finish time.
  if (percent !== undefined && percent < 100 && cur?.status === 'Completed' && status === undefined) {
    status = null; next.status = null;
    if (actualFinish === undefined) { actualFinish = null; next.finish = null; }
  }
  // Completed and 100 % mean the same thing; keep them consistent.
  if (status === 'Completed' && percent === undefined) { percent = 100; next.percent = 100; }
  if (percent === 100 && status === undefined && next.status !== 'Completed') { status = 'Completed'; next.status = 'Completed'; }
  if (next.status === 'Completed' && next.percent !== 100) throw new HttpError(400, 'A Completed job must be at 100 %');
  if (next.percent === 100 && !next.finish) throw new HttpError(400, 'Enter the actual finish time to complete a job');
  if (next.finish && !next.start) throw new HttpError(400, 'Enter the actual start time before the actual finish');
  if (next.start && next.finish && next.finish < next.start) throw new HttpError(400, 'Actual finish cannot be before actual start');
  if (next.finish && next.percent < 100 && status !== 'Completed') throw new HttpError(400, 'A job with an actual finish must be at 100 %');

  setProgress(db, stableKey, { status, progress: percent, actualStart, actualFinish, note }, by);
  const saved = db.prepare('SELECT * FROM job_progress WHERE shutdown_id = ? AND stable_key = ?').get(SHUTDOWN_ID, stableKey) as Row;
  return { status: saved.status, percent: saved.progress, actualStart: saved.actual_start, actualFinish: saved.actual_finish, note: saved.note, updatedAt: saved.updated_at };
}

export function listEvents(db: Db, stableKey: string) {
  activeJob(db, stableKey);
  return (db.prepare('SELECT at, by, change_json FROM job_event WHERE shutdown_id = ? AND stable_key = ? ORDER BY id DESC LIMIT 100').all(SHUTDOWN_ID, stableKey) as Row[])
    .map((r) => ({ at: r.at, by: r.by, change: JSON.parse(r.change_json) }));
}
