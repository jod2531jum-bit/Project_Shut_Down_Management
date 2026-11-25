import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDb } from '../src/db.js';
import { buildApp } from '../src/app.js';

const FILE = resolve(__dirname, "../../../../Major Shutdown Schedule Oct'26 (15 days) Rev.I.xlsx");
const d = existsSync(FILE) ? describe : describe.skip;

function multipart(filename: string, data: Buffer) {
  const b = '----pb';
  return { payload: Buffer.concat([Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n\r\n`), data, Buffer.from(`\r\n--${b}--\r\n`)]), headers: { 'content-type': `multipart/form-data; boundary=${b}` } };
}

d('progress API', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let leaf: any; let summary: any;
  const patch = (key: string, body: object, user = 'alice') => app.inject({ method: 'PATCH', url: `/api/jobs/${encodeURIComponent(key)}/progress`, payload: body, headers: { 'x-user': user } });

  beforeEach(async () => {
    app = await buildApp(openDb(':memory:'));
    const up = (await app.inject({ method: 'POST', url: '/api/imports', ...multipart('r.xlsx', readFileSync(FILE)) })).json();
    await app.inject({ method: 'POST', url: `/api/imports/${up.id}/commit`, payload: { acknowledgeErrors: true } });
    const plan = (await app.inject({ method: 'GET', url: '/api/shutdown' })).json();
    leaf = plan.jobs.find((j: any) => j.type === 'activity' && j.scheduled);
    summary = plan.jobs.find((j: any) => j.type === 'summary');
  });

  it('saves progress, returns the record and writes an audit trail', async () => {
    const r = await patch(leaf.stableKey, { percent: 40, actualStart: '2026-10-20T08:00', note: ' welding  ' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ percent: 40, actualStart: '2026-10-20T08:00', note: 'welding', status: null });
    const plan = (await app.inject({ method: 'GET', url: '/api/shutdown' })).json();
    expect(plan.jobs.find((j: any) => j.stableKey === leaf.stableKey).progress).toMatchObject({ percent: 40, note: 'welding' });
    const ev = (await app.inject({ method: 'GET', url: `/api/jobs/${leaf.stableKey}/events` })).json();
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ by: 'alice', change: { to: { progress: 40 } } });
  });

  it('completing needs start+finish and keeps status and percent consistent', async () => {
    expect((await patch(leaf.stableKey, { status: 'Completed' })).statusCode).toBe(400); // no finish
    expect((await patch(leaf.stableKey, { percent: 100, actualFinish: '2026-10-21T08:00' })).statusCode).toBe(400); // finish without start
    expect((await patch(leaf.stableKey, { percent: 100, actualStart: '2026-10-21T09:00', actualFinish: '2026-10-21T08:00' })).statusCode).toBe(400); // finish < start
    const ok = await patch(leaf.stableKey, { status: 'Completed', actualStart: '2026-10-20T08:00', actualFinish: '2026-10-21T08:00' });
    expect(ok.json()).toMatchObject({ status: 'Completed', percent: 100 });
    const reopened = await patch(leaf.stableKey, { percent: 60 });
    expect(reopened.json()).toMatchObject({ status: null, percent: 60, actualFinish: null });
  });

  it('rejects bad values and summary rows', async () => {
    expect((await patch(leaf.stableKey, { percent: 101 })).statusCode).toBe(400);
    expect((await patch(leaf.stableKey, { percent: 12.5 })).statusCode).toBe(400);
    expect((await patch(leaf.stableKey, { status: 'Done-ish' })).statusCode).toBe(400);
    expect((await patch(leaf.stableKey, { actualStart: 'yesterday' })).statusCode).toBe(400);
    expect((await patch(summary.stableKey, { percent: 10 })).statusCode).toBe(400);
    expect((await patch('nope', { percent: 10 })).statusCode).toBe(404);
  });

  it('detects concurrent edits via expectedUpdatedAt', async () => {
    const first = (await patch(leaf.stableKey, { percent: 10, expectedUpdatedAt: null })).json();
    const stale = await patch(leaf.stableKey, { percent: 20, expectedUpdatedAt: null }, 'bob');
    expect(stale.statusCode).toBe(409);
    expect(stale.json().details.updatedAt).toBe(first.updatedAt);
    expect((await patch(leaf.stableKey, { percent: 20, expectedUpdatedAt: first.updatedAt }, 'bob')).statusCode).toBe(200);
  });

  it('manual status overrides and can be cleared back to automatic', async () => {
    expect((await patch(leaf.stableKey, { status: 'At risk' })).json().status).toBe('At risk');
    expect((await patch(leaf.stableKey, { status: '' })).json().status).toBeNull();
  });
});
