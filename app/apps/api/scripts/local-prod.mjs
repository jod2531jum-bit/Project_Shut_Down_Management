// Local "production-like" run: API serving the built web app on :3012 with a throwaway DB.
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.PORT ??= '3012';
process.env.DB_PATH ??= join(tmpdir(), 'shutdown-local-prod.db');
await import('../src/server.ts');
