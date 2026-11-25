import Fastify, { type FastifyRequest } from 'fastify';
import multipart from '@fastify/multipart';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import type { Db } from './db.js';
import { makeAuthenticator, requireRole, type AuthConfig, type Principal, type Role } from './auth.js';
import { listEvents, updateProgress, type ProgressInput } from './progressService.js';
import { HttpError, activateImport, commitImport, discardImport, getCurrent, getReview, listImports, setMapping, setWindow, stageImport } from './importService.js';

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export interface AppOptions {
  auth?: AuthConfig;
  /** Built web app to serve at / (single-container deployment). */
  staticDir?: string;
  /** Allowed browser origins; omit to disable CORS (same-origin deployment). `true` allows any (dev only). */
  corsOrigin?: string[] | true;
  logger?: boolean;
}

declare module 'fastify' { interface FastifyRequest { principal?: Principal } }

export async function buildApp(db: Db, opts: AppOptions = {}) {
  const authCfg: AuthConfig = opts.auth ?? { mode: 'none' };
  const authenticate = makeAuthenticator(authCfg);
  const app = Fastify({ logger: opts.logger ?? false, trustProxy: true });

  // Internal deployments often run over plain http: don't force https upgrades or HSTS unless TLS is declared.
  const tls = process.env.TLS === 'true';
  await app.register(helmet, { strictTransportSecurity: tls, contentSecurityPolicy: { directives: { upgradeInsecureRequests: tls ? [] : null, defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'], fontSrc: ["'self'", 'https://fonts.gstatic.com'], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'", 'https://login.microsoftonline.com'], frameAncestors: ["'none'"] } } });
  if (opts.corsOrigin) await app.register(cors, { origin: opts.corsOrigin });
  await app.register(rateLimit, { global: false });
  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.message, details: err.details });
    if (err?.code === 'FST_REQ_FILE_TOO_LARGE') return reply.status(413).send({ error: `File exceeds ${MAX_UPLOAD_BYTES / 1024 / 1024} MB limit` });
    if (err?.statusCode === 429) return reply.status(429).send({ error: 'Too many requests. Please wait a moment and try again.' });
    if (err?.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ error: err.message });
    req.log.error(err);
    return reply.status(500).send({ error: 'Internal error' });
  });

  // Every /api route except /api/config requires a valid sign-in (a no-op in AUTH_MODE=none).
  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/') || req.url === '/api/config') return;
    req.principal = await authenticate(req.headers);
  });
  const need = (req: FastifyRequest, role: Role) => { requireRole(req.principal!, role); return req.principal!; };

  const idOf = (req: { params: unknown }) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id)) throw new HttpError(400, 'Invalid import id');
    return id;
  };

  app.get('/health', async () => ({ ok: true }));
  app.get('/api/config', async () => ({ authMode: authCfg.mode, tenantId: authCfg.tenantId ?? null, clientId: authCfg.clientId ?? null, scope: authCfg.scope ?? null }));
  app.get('/api/me', async (req) => ({ name: req.principal!.name, role: req.principal!.role }));

  // ---- imports (Importer) ----
  app.post('/api/imports', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const p = need(req, 'importer');
    const file = await req.file();
    if (!file) throw new HttpError(400, 'Attach the Shutdown Form as multipart field "file"');
    const buffer = await file.toBuffer();
    if (file.file.truncated) throw new HttpError(413, `File exceeds ${MAX_UPLOAD_BYTES / 1024 / 1024} MB limit`);
    const id = await stageImport(db, { filename: file.filename, buffer, uploadedBy: p.name });
    return reply.status(201).send(getReview(db, id));
  });
  app.get('/api/imports', async (req) => { need(req, 'importer'); return listImports(db); });
  app.get('/api/imports/:id', async (req) => { need(req, 'importer'); return getReview(db, idOf(req)); });
  app.patch('/api/imports/:id/mapping', async (req) => {
    need(req, 'importer');
    const id = idOf(req);
    const body = (req.body ?? {}) as { mapping?: Record<string, unknown> };
    if (!body.mapping || typeof body.mapping !== 'object') throw new HttpError(400, 'Body must be {"mapping": {groupKey: page}}');
    setMapping(db, id, body.mapping);
    return getReview(db, id);
  });
  app.patch('/api/imports/:id/window', async (req) => {
    need(req, 'importer');
    const id = idOf(req);
    const b = (req.body ?? {}) as { start?: unknown; end?: unknown };
    setWindow(db, id, b.start, b.end);
    return getReview(db, id);
  });
  app.post('/api/imports/:id/commit', async (req) => {
    need(req, 'importer');
    const b = (req.body ?? {}) as { acknowledgeErrors?: boolean };
    return commitImport(db, idOf(req), { acknowledgeErrors: b.acknowledgeErrors === true });
  });
  app.post('/api/imports/:id/discard', async (req) => { need(req, 'importer'); discardImport(db, idOf(req)); return { ok: true }; });
  app.post('/api/imports/:id/activate', async (req) => { need(req, 'importer'); activateImport(db, idOf(req)); return { ok: true }; });

  // ---- plan (Viewer) and progress (Editor) ----
  app.get('/api/shutdown', async (req, reply) => {
    need(req, 'viewer');
    const cur = getCurrent(db);
    if (!cur) return reply.status(404).send({ error: 'No shutdown plan imported yet' });
    return cur;
  });
  app.patch('/api/jobs/:key/progress', async (req) => {
    const p = need(req, 'editor');
    return updateProgress(db, (req.params as { key: string }).key, (req.body ?? {}) as ProgressInput, p.name);
  });
  app.get('/api/jobs/:key/events', async (req) => { need(req, 'viewer'); return listEvents(db, (req.params as { key: string }).key); });

  // ---- built web app (SPA fallback) ----
  if (opts.staticDir && existsSync(opts.staticDir)) {
    await app.register(fastifyStatic, { root: opts.staticDir });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.status(404).send({ error: 'Not found' });
      return reply.sendFile('index.html');
    });
  }
  return app;
}
