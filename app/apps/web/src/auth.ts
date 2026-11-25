import { PublicClientApplication, InteractionRequiredAuthError, type AccountInfo } from '@azure/msal-browser';

export type Role = 'viewer' | 'editor' | 'importer';
export interface Me { name: string; role: Role | null }
interface PublicConfig { authMode: 'none' | 'entra'; tenantId: string | null; clientId: string | null; scope: string | null }

let msal: PublicClientApplication | null = null;
let account: AccountInfo | null = null;
let scope = '';
export let authMode: PublicConfig['authMode'] = 'none';

const never = () => new Promise<never>(() => {}); // used after a redirect starts: the page is navigating away

/** Run before rendering. In Entra mode this redirects to Microsoft sign-in if there is no session. */
export async function initAuth(): Promise<void> {
  const cfg = (await (await fetch('/api/config')).json()) as PublicConfig;
  authMode = cfg.authMode;
  if (cfg.authMode !== 'entra') return;
  if (!cfg.clientId || !cfg.tenantId || !cfg.scope) throw new Error('Sign-in is enabled on the server but not fully configured (ENTRA_SPA_CLIENT_ID missing).');
  scope = cfg.scope;
  msal = new PublicClientApplication({
    auth: { clientId: cfg.clientId, authority: `https://login.microsoftonline.com/${cfg.tenantId}`, redirectUri: window.location.origin },
    cache: { cacheLocation: 'sessionStorage' },
  });
  await msal.initialize();
  const redirected = await msal.handleRedirectPromise();
  account = redirected?.account ?? msal.getAllAccounts()[0] ?? null;
  if (!account) { await msal.loginRedirect({ scopes: [scope] }); await never(); }
  msal.setActiveAccount(account);
}

async function token(): Promise<string | null> {
  if (!msal || !account) return null;
  try { return (await msal.acquireTokenSilent({ scopes: [scope], account })).accessToken; }
  catch (e) {
    if (e instanceof InteractionRequiredAuthError) { await msal.acquireTokenRedirect({ scopes: [scope], account }); await never(); }
    throw e;
  }
}

export const signOut = () => msal?.logoutRedirect({ account: account ?? undefined });

/** fetch() that attaches the Entra access token (or, in open/dev mode, the typed user name). */
export async function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const t = await token();
  if (t) headers.set('authorization', `Bearer ${t}`);
  else if (authMode === 'none') { const u = localStorage.getItem('shutdown.user'); if (u) headers.set('x-user', u); }
  const res = await fetch(url, { ...init, headers });
  if (res.status === 401 && msal && account) { await msal.acquireTokenRedirect({ scopes: [scope], account }); await never(); }
  return res;
}
