import { apiFetch } from './auth';
export type Page = 'major' | 'minor' | 'common' | 'paper' | 'boiler';
export const PAGE_LABEL: Record<Page, string> = { major: 'Major', minor: 'Minor', common: 'Common', paper: 'Paper Major', boiler: 'Boiler Minor' };
export const PAGES = Object.keys(PAGE_LABEL) as Page[];

export interface Issue { row: number; code: string; severity: 'error' | 'warn' | 'info'; message: string }
export interface GroupReview { key: string; name: string; jobs: number; plannedStart: string | null; plannedFinish: string | null; page: Page | null; suggested: Page | null }
export interface Diff {
  baselineImportId: number | null; added: number; removed: number; changed: number; unchanged: number;
  preservedProgress: number; orphanedProgress: number;
  changedSample: Array<{ stableKey: string; group: string; description: string; before: { start: string | null; finish: string | null }; after: { start: string | null; finish: string | null } }>;
}
export interface Stats { groups: number; jobs: number; scheduled: number; unscheduled: number; milestones: number; byPhase: Record<string, number>; issues: { error: number; warn: number; info: number } }
export interface Review {
  id: number; filename: string; status: 'staged' | 'committed' | 'superseded' | 'discarded';
  uploadedAt: string; committedAt: string | null; stats: Stats; issues: Issue[]; duplicateOfActive: boolean;
  window: { start: string; end: string; detectedFrom?: string | null; days?: number | null } | null;
  extent?: { start: string; end: string } | null;
  groups?: GroupReview[]; unmappedGroups?: string[]; diff?: Diff;
}
export interface HistoryRow { id: number; filename: string; status: Review['status']; uploadedBy: string | null; uploadedAt: string; committedAt: string | null; stats: Stats; active: boolean }

export class ApiError extends Error { constructor(public status: number, message: string, public details?: any) { super(message); } }

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error ?? res.statusText, body.details);
  return body as T;
}
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export const api = {
  upload(file: File) { const fd = new FormData(); fd.append('file', file); return call<Review>('/api/imports', { method: 'POST', body: fd }); },
  review: (id: number) => call<Review>(`/api/imports/${id}`),
  history: () => call<HistoryRow[]>('/api/imports'),
  setMapping: (id: number, mapping: Record<string, Page>) => call<Review>(`/api/imports/${id}/mapping`, json('PATCH', { mapping })),
  setWindow: (id: number, start: string, end: string) => call<Review>(`/api/imports/${id}/window`, json('PATCH', { start, end })),
  commit: (id: number, acknowledgeErrors: boolean) => call<{ id: number; status: string; diff: Diff }>(`/api/imports/${id}/commit`, json('POST', { acknowledgeErrors })),
  discard: (id: number) => call<{ ok: true }>(`/api/imports/${id}/discard`, json('POST', {})),
  activate: (id: number) => call<{ ok: true }>(`/api/imports/${id}/activate`, json('POST', {})),
};

export const fmt = (iso: string | null | undefined) => (iso ? iso.replace('T', ' ') : '—');
