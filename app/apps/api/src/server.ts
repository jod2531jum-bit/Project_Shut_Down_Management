import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { buildApp } from './app.js';
import { authFromEnv } from './auth.js';

const dbPath = process.env.DB_PATH ?? './data/shutdown.db';
if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
const db = openDb(dbPath);

const here = dirname(fileURLToPath(import.meta.url));
const app = await buildApp(db, {
  auth: authFromEnv(),
  staticDir: process.env.STATIC_DIR ?? resolve(here, '../../web/dist'),
  corsOrigin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim()) : undefined,
  logger: true,
});

const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: process.env.HOST ?? '127.0.0.1' });

for (const sig of ['SIGINT', 'SIGTERM'] as const)
  process.on(sig, async () => { await app.close(); db.close(); process.exit(0); });
