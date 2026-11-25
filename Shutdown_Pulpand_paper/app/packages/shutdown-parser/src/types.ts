export type Phase = 'shutdown' | 'maintenance' | 'critical' | 'startup' | 'other';
export type JobType = 'activity' | 'milestone' | 'summary';
export type Severity = 'error' | 'warn' | 'info';

export interface ImportIssue { row: number; code: string; severity: Severity; message: string; }
export interface SummaryRow { row: number; label: string; start: string | null; finish: string | null; hours: number | null; }
export interface Group {
  key: string; name: string; sourceRow: number; order: number;
  plannedStart: string | null; plannedFinish: string | null;
}
export interface Job {
  stableKey: string; sourceRow: number; groupKey: string; parentRow: number | null; depth: number;
  description: string; unit: string; teams: string[]; priority: number;
  phase: Phase; type: JobType; isMarker: boolean;
  plannedStart: string | null; plannedFinish: string | null; durationHrs: number | null;
  scheduled: boolean; note: string | null;
}
export interface Dependency { jobRow: number; dependsOnRow: number; kind: 'start-link' | 'finish-link'; crossGroup: boolean; }
export interface ParseResult {
  sheet: string; headerRow: number; summary: SummaryRow[]; groups: Group[]; jobs: Job[];
  dependencies: Dependency[]; issues: ImportIssue[];
  window: { start: string; end: string; days: number; source: string } | null;
  extent: { start: string; end: string } | null;
}
export class ShutdownFormError extends Error {}
