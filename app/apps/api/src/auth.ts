import { createRemoteJWKSet, jwtVerify, type CryptoKey, type JWTVerifyGetKey, type KeyObject } from 'jose';
import { HttpError } from './importService.js';

export type Role = 'viewer' | 'editor' | 'importer';
const RANK: Record<Role, number> = { viewer: 1, editor: 2, importer: 3 };

export interface Principal { name: string; role: Role | null }

export interface AuthConfig {
  mode: 'none' | 'entra';
  tenantId?: string;
  /** Expected `aud` of access tokens (e.g. "api://<api-client-id>"). */
  audience?: string;
  /** SPA client id handed to the browser for MSAL. */
  clientId?: string;
  /** Scope the SPA requests (e.g. "api://<api-client-id>/access_as_user"). */
  scope?: string;
  /** Entra security-group object ids per role (alternative to app roles). */
  groups?: Partial<Record<Role, string[]>>;
  /** Override key source (tests); production uses Entra's JWKS endpoint. */
  keys?: JWTVerifyGetKey | CryptoKey | KeyObject | Uint8Array;
  /** Override issuer (tests). */
  issuer?: string;
}

const list = (v?: string) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined);

export function authFromEnv(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  if ((env.AUTH_MODE ?? 'none') !== 'entra') return { mode: 'none' };
  const tenantId = env.ENTRA_TENANT_ID, audience = env.ENTRA_AUDIENCE ?? (env.ENTRA_API_CLIENT_ID ? `api://${env.ENTRA_API_CLIENT_ID}` : undefined);
  if (!tenantId || !audience) throw new Error('AUTH_MODE=entra requires ENTRA_TENANT_ID and ENTRA_AUDIENCE (or ENTRA_API_CLIENT_ID)');
  return {
    mode: 'entra', tenantId, audience, clientId: env.ENTRA_SPA_CLIENT_ID, scope: env.ENTRA_SCOPE ?? `${audience}/access_as_user`,
    groups: { importer: list(env.ENTRA_GROUP_IMPORTER), editor: list(env.ENTRA_GROUP_EDITOR), viewer: list(env.ENTRA_GROUP_VIEWER) },
  };
}

function roleFromClaims(claims: Record<string, unknown>, cfg: AuthConfig): Role | null {
  const found = new Set<Role>();
  const appRoles = Array.isArray(claims.roles) ? (claims.roles as unknown[]).map((r) => String(r).toLowerCase()) : [];
  for (const r of appRoles) if (r in RANK) found.add(r as Role);
  const groups = Array.isArray(claims.groups) ? (claims.groups as unknown[]).map(String) : [];
  for (const role of Object.keys(RANK) as Role[]) if (cfg.groups?.[role]?.some((g) => groups.includes(g))) found.add(role);
  return [...found].sort((a, b) => RANK[b] - RANK[a])[0] ?? null;
}

export function makeAuthenticator(cfg: AuthConfig) {
  const keys = cfg.keys ?? (cfg.mode === 'entra' ? createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${cfg.tenantId}/discovery/v2.0/keys`)) : undefined);
  const issuer = cfg.issuer ?? `https://login.microsoftonline.com/${cfg.tenantId}/v2.0`;

  return async function authenticate(headers: Record<string, string | string[] | undefined>): Promise<Principal> {
    if (cfg.mode === 'none') return { name: (headers['x-user'] as string | undefined) ?? 'anonymous', role: 'importer' };
    const h = headers.authorization;
    const token = typeof h === 'string' && /^Bearer /i.test(h) ? h.slice(7).trim() : null;
    if (!token) throw new HttpError(401, 'Sign in required');
    try {
      const { payload } = await jwtVerify(token, keys as JWTVerifyGetKey, { issuer, audience: cfg.audience, algorithms: ['RS256'] });
      if (payload.tid && payload.tid !== cfg.tenantId) throw new Error('wrong tenant');
      return { name: String(payload.name ?? payload.preferred_username ?? payload.oid ?? 'unknown'), role: roleFromClaims(payload, cfg) };
    } catch {
      throw new HttpError(401, 'Invalid or expired sign-in. Please sign in again.');
    }
  };
}

export function requireRole(p: Principal, need: Role) {
  if (!p.role) throw new HttpError(403, 'Your account has no access to this app. Ask an administrator for the Viewer, Editor or Importer role.');
  if (RANK[p.role] < RANK[need]) throw new HttpError(403, `This action needs the ${need[0].toUpperCase() + need.slice(1)} role (you have ${p.role}).`);
}
