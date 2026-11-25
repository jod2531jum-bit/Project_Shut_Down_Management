import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDb, type Db } from '../src/db.js';
import { buildApp } from '../src/app.js';
import { setProgress } from '../src/importService.js';

const FILE = resolve(__dirname, "../../../../Major Shutdown Schedule Oct'26 (15 days) Rev.I.xlsx");
const d = existsSync(FILE) ? describe : describe.skip;

function multipart(filename: string, data: Buffer) {
  const b = '----testboundary';
  const head = Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`);
  return { payload: Buffer.concat([head, data, Buffer.from(`\r\n--${b}--\r\n`)]), headers: { 'content-type': `multipart/form-data; boundary=${b}` } };
}

d('import API', () => {
  let db: Db;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const xlsx = () => readFileSync(FILE);
  const upload = (name = 'Rev.I.xlsx', buf: Buffer = xlsx()) => app.inject({ method: 'POST', url: '/api/imports', ...multipart(name, buf) });
  const commit = (id: number, body: object = { acknowledgeErrors: true }) => app.inject({ method: 'POST', url: `/api/imports/${id}/commit`, payload: body });

  beforeEach(async () => { db = openDb(':memory:'); app = await buildApp(db); });

  it('stages an upload and returns a review without publishing anything', async () => {
    const res = await upload();
    expect(res.statusCode).toBe(201);
    const r = res.json();
    expect(r).toMatchObject({ status: 'staged', stats: { groups: 27, jobs: 404 }, window: { start: '2026-10-16T06:00', end: '2026-10-31T06:00', days: 15 } });
    expect(r.unmappedGroups).toEqual([]); // defaults cover every Rev.I group
    expect(r.groups.find((g: any) => g.name.startsWith('PULP-1')).page).toBe('major');
    expect(r.groups.find((g: any) => g.name.startsWith('Paper')).page).toBe('paper');
    expect(r.groups.find((g: any) => g.name.startsWith('Common Steam')).page).toBe('common');
    expect(r.diff).toMatchObject({ baselineImportId: null, added: 404 });
    expect(r.issues.some((i: any) => i.code === 'REF_ERROR' && i.row === 276)).toBe(true);
    expect((await app.inject({ method: 'GET', url: '/api/shutdown' })).statusCode).toBe(404);
  });

  it('requires error acknowledgement and a complete mapping before commit', async () => {
    const { id } = (await upload()).json();
    const blocked = await commit(id, {});
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error).toMatch(/acknowledged/);

    const first = (await app.inject({ method: 'GET', url: `/api/imports/${id}` })).json().groups[0].key;
    const bad = await app.inject({ method: 'PATCH', url: `/api/imports/${id}/mapping`, payload: { mapping: { [first]: 'nope' } } });
    expect(bad.statusCode).toBe(400);
    const unknown = await app.inject({ method: 'PATCH', url: `/api/imports/${id}/mapping`, payload: { mapping: { missing: 'major' } } });
    expect(unknown.statusCode).toBe(400);
  });

  it('commits, serves the plan, and remembers mapping edits for the next upload', async () => {
    const { id, groups } = (await upload()).json();
    const lk2 = groups.find((g: any) => g.name.startsWith('LIME KILN-2'));
    await app.inject({ method: 'PATCH', url: `/api/imports/${id}/mapping`, payload: { mapping: { [lk2.key]: 'major' } } });
    const c = await commit(id);
    expect(c.statusCode).toBe(200);

    const cur = (await app.inject({ method: 'GET', url: '/api/shutdown' })).json();
    expect(cur.window.days).toBe(15);
    expect(cur.groups).toHaveLength(27);
    expect(cur.jobs).toHaveLength(404);
    expect(cur.groups.find((g: any) => g.key === lk2.key).page).toBe('major');
    const stop = cur.jobs.find((j: any) => j.sourceRow === 14);
    expect(stop).toMatchObject({ phase: 'shutdown', plannedStart: '2026-10-14T13:00', progress: { percent: 0, status: null } });
    expect(cur.dependencies.some((x: any) => x.crossGroup)).toBe(true);
    expect(cur.jobs.find((j: any) => j.sourceRow === 21).description).toBe('Paper หยุดดึงเยื่อ'); // Thai survives upload -> DB -> API

    const second = (await upload()).json();
    expect(second.groups.find((g: any) => g.key === lk2.key).page).toBe('major'); // remembered
  });

  it('re-uploading the same file gives an empty diff and keeps operator progress', async () => {
    const a = (await upload()).json();
    await commit(a.id);
    const key = (await app.inject({ method: 'GET', url: '/api/shutdown' })).json().jobs[3].stableKey;
    setProgress(db, key, { progress: 60, status: 'On track', note: 'valves fitted' }, 'tester');

    const b = (await upload()).json();
    expect(b.duplicateOfActive).toBe(true);
    expect(b.diff).toMatchObject({ added: 0, removed: 0, changed: 0, unchanged: 404, preservedProgress: 1, orphanedProgress: 0 });
    expect((await commit(b.id)).statusCode).toBe(200);

    const cur = (await app.inject({ method: 'GET', url: '/api/shutdown' })).json();
    expect(cur.jobs.find((j: any) => j.stableKey === key).progress).toMatchObject({ percent: 60, status: 'On track', note: 'valves fitted' });
    const hist = (await app.inject({ method: 'GET', url: '/api/imports' })).json();
    expect(hist.map((h: any) => h.status)).toEqual(['committed', 'superseded']);
  });

  it('rolls back to a superseded import and can discard a staged one', async () => {
    const a = (await upload()).json(); await commit(a.id);
    const b = (await upload()).json(); await commit(b.id);
    expect((await app.inject({ method: 'POST', url: `/api/imports/${a.id}/activate` })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/shutdown' })).json().shutdown.activeImportId).toBe(a.id);
    expect((await app.inject({ method: 'POST', url: `/api/imports/${a.id}/activate` })).statusCode).toBe(409); // already active
    const c = (await upload()).json();
    expect((await app.inject({ method: 'POST', url: `/api/imports/${c.id}/discard` })).statusCode).toBe(200);
    expect((await commit(c.id)).statusCode).toBe(409);
  });

  it('lets the user override the detected window', async () => {
    const { id } = (await upload()).json();
    const bad = await app.inject({ method: 'PATCH', url: `/api/imports/${id}/window`, payload: { start: '2026-10-20T00:00', end: '2026-10-19T00:00' } });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({ method: 'PATCH', url: `/api/imports/${id}/window`, payload: { start: '2026-10-14T00:00', end: '2026-11-01T00:00' } });
    expect(ok.json().window).toMatchObject({ start: '2026-10-14T00:00', days: 18 });
  });

  it('rejects wrong or broken uploads with clear errors', async () => {
    expect((await upload('plan.xls', xlsx())).statusCode).toBe(400);
    expect((await upload('plan.xlsm', xlsx())).statusCode).toBe(400);
    expect((await upload('a.xlsx', Buffer.from('hello world'))).statusCode).toBe(400);
    const zipish = Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), Buffer.from('garbage')]);
    const r = await upload('a.xlsx', zipish);
    expect(r.statusCode).toBe(422);
    expect(r.json().error).toMatch(/Cannot read|Not a Shutdown Form/);
    expect((await app.inject({ method: 'GET', url: '/api/imports/999' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/imports/abc' })).statusCode).toBe(400);
  });
});
