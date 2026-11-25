import { describe, it, expect, beforeAll } from 'vitest';
import { SignJWT, generateKeyPair } from 'jose';
import { openDb } from '../src/db.js';
import { buildApp } from '../src/app.js';
import { authFromEnv } from '../src/auth.js';

const TENANT = '11111111-1111-1111-1111-111111111111';
const AUD = 'api://shutdown-api';
const ISS = `https://login.microsoftonline.com/${TENANT}/v2.0`;

describe('Entra token enforcement', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let sign: (claims: Record<string, unknown>, o?: { aud?: string; iss?: string; exp?: string; key?: CryptoKey }) => Promise<string>;
  let otherKey: CryptoKey;

  beforeAll(async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    otherKey = (await generateKeyPair('RS256')).privateKey as CryptoKey;
    sign = (claims, o = {}) => new SignJWT({ tid: TENANT, ...claims }).setProtectedHeader({ alg: 'RS256' })
      .setIssuer(o.iss ?? ISS).setAudience(o.aud ?? AUD).setIssuedAt().setExpirationTime(o.exp ?? '1h').sign(o.key ?? (privateKey as CryptoKey));
    app = await buildApp(openDb(':memory:'), {
      auth: { mode: 'entra', tenantId: TENANT, audience: AUD, clientId: 'spa', scope: `${AUD}/access_as_user`, keys: publicKey as CryptoKey, groups: { editor: ['grp-editors'] } },
    });
  });

  const get = (url: string, token?: string) => app.inject({ method: 'GET', url, headers: token ? { authorization: `Bearer ${token}` } : {} });
  const patch = (token: string) => app.inject({ method: 'PATCH', url: '/api/jobs/x/progress', payload: { percent: 1 }, headers: { authorization: `Bearer ${token}` } });
  const upload = (token: string) => app.inject({ method: 'POST', url: '/api/imports', headers: { authorization: `Bearer ${token}`, 'content-type': 'multipart/form-data; boundary=b' }, payload: '--b--\r\n' });

  it('keeps health and public config open, everything else closed', async () => {
    expect((await get('/health')).statusCode).toBe(200);
    expect((await get('/api/config')).json()).toMatchObject({ authMode: 'entra', clientId: 'spa', tenantId: TENANT });
    expect((await get('/api/shutdown')).statusCode).toBe(401);
    expect((await get('/api/imports')).statusCode).toBe(401);
  });

  it('rejects forged, wrong-audience, wrong-issuer, wrong-tenant and expired tokens', async () => {
    const bad = [
      await sign({ roles: ['Importer'] }, { key: otherKey }),
      await sign({ roles: ['Importer'] }, { aud: 'api://someone-else' }),
      await sign({ roles: ['Importer'] }, { iss: 'https://evil.example/v2.0' }),
      await sign({ roles: ['Importer'], tid: '22222222-2222-2222-2222-222222222222' }),
      await sign({ roles: ['Importer'] }, { exp: '-1m' }),
      'not.a.jwt',
    ];
    for (const t of bad) expect((await get('/api/shutdown', t)).statusCode).toBe(401);
  });

  it('enforces Viewer < Editor < Importer', async () => {
    const viewer = await sign({ name: 'Vic', roles: ['Viewer'] });
    const editor = await sign({ name: 'Eve', roles: ['Editor'] });
    const importer = await sign({ name: 'Ira', roles: ['Importer'] });

    expect((await get('/api/shutdown', viewer)).statusCode).toBe(404); // allowed, just no plan yet
    expect((await patch(viewer)).statusCode).toBe(403);
    expect((await patch(editor)).statusCode).toBe(404); // allowed, job doesn't exist
    expect((await upload(editor)).statusCode).toBe(403);
    expect((await get('/api/imports', editor)).statusCode).toBe(403);
    expect((await get('/api/imports', importer)).statusCode).toBe(200);
    expect((await patch(importer)).statusCode).toBe(404); // importer implies editor
    expect((await get('/api/me', editor)).json()).toEqual({ name: 'Eve', role: 'editor' });
  });

  it('grants roles from Entra group membership and denies signed-in users with no role', async () => {
    const viaGroup = await sign({ name: 'Gus', groups: ['grp-editors'] });
    expect((await patch(viaGroup)).statusCode).toBe(404);
    const none = await sign({ name: 'Nobody' });
    const r = await get('/api/shutdown', none);
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toMatch(/no access/i);
  });
});

describe('auth config', () => {
  it('defaults to open mode and validates entra settings', () => {
    expect(authFromEnv({} as any)).toEqual({ mode: 'none' });
    expect(() => authFromEnv({ AUTH_MODE: 'entra' } as any)).toThrow(/ENTRA_TENANT_ID/);
    expect(authFromEnv({ AUTH_MODE: 'entra', ENTRA_TENANT_ID: 't', ENTRA_API_CLIENT_ID: 'abc', ENTRA_GROUP_EDITOR: 'g1, g2' } as any))
      .toMatchObject({ mode: 'entra', audience: 'api://abc', scope: 'api://abc/access_as_user', groups: { editor: ['g1', 'g2'] } });
  });
});
