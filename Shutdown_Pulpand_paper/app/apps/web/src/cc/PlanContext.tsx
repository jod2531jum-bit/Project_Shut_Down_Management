import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { apiFetch, type Me } from '../auth';
import { dayInfo, nowLocalIso, toMs, type DayInfo, type Job, type Plan } from '../lib/model';

interface Ctx {
  plan: Plan | null; loading: boolean; error: string | null; reload: () => Promise<void>;
  saveProgress: (stableKey: string, body: Record<string, unknown>) => Promise<void>;
  user: string; setUser: (u: string) => void;
  me: Me | null;
  asOfIso: string; asOfMs: number; override: string | null; setOverride: (v: string | null) => void;
  info: DayInfo | null;
  openJob: Job | null; setOpenJob: (j: Job | null) => void;
}
const C = createContext<Ctx | null>(null);
export const usePlan = () => { const c = useContext(C); if (!c) throw new Error('PlanProvider missing'); return c; };

const KEY = 'shutdown.asOf';

export function PlanProvider({ children }: { children: ReactNode }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [override, setOverrideState] = useState<string | null>(() => localStorage.getItem(KEY));
  const [tick, setTick] = useState(() => nowLocalIso());
  const [openJob, setOpenJob] = useState<Job | null>(null);

  const reload = useCallback((): Promise<void> => {
    setLoading(true);
    return apiFetch('/api/shutdown')
      .then(async (r) => {
        if (r.status === 404) { setPlan(null); setError(null); return; }
        if (r.status === 403) throw new Error((await r.json().catch(() => ({}))).error ?? 'No access');
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        setPlan((await r.json()) as Plan); setError(null);
      })
      .catch((e) => setError(e.message.startsWith('HTTP') ? `Could not load the plan (${e.message})` : e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  // Keep an open job dialog pointing at the freshest copy after any reload.
  useEffect(() => { if (plan) setOpenJob((cur) => (cur ? plan.jobs.find((j) => j.stableKey === cur.stableKey) ?? null : cur)); }, [plan]);

  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => { apiFetch('/api/me').then((r) => (r.ok ? r.json() : null)).then(setMe).catch(() => setMe(null)); }, []);
  const [user, setUserState] = useState(() => localStorage.getItem('shutdown.user') ?? '');
  const setUser = useCallback((u: string) => { localStorage.setItem('shutdown.user', u); setUserState(u); }, []);
  const saveProgress = useCallback(async (stableKey: string, body: Record<string, unknown>) => {
    const res = await apiFetch(`/api/jobs/${encodeURIComponent(stableKey)}/progress`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) { if (res.status === 409) await reload(); throw new Error(out.error ?? `Save failed (HTTP ${res.status})`); }
    await reload();
  }, [user, reload]);
  useEffect(() => { const t = setInterval(() => setTick(nowLocalIso()), 60_000); return () => clearInterval(t); }, []);

  const setOverride = useCallback((v: string | null) => {
    if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY);
    setOverrideState(v);
  }, []);

  const asOfIso = override ?? tick;
  const asOfMs = toMs(asOfIso);
  const info = useMemo(() => (plan ? dayInfo(plan.window, asOfMs) : null), [plan, asOfMs]);
  return <C.Provider value={{ plan, loading, error, reload, saveProgress, user, setUser, me, asOfIso, asOfMs, override, setOverride, info, openJob, setOpenJob }}>{children}</C.Provider>;
}
