# Deployment guide

One container serves the API and the web app. Data is a single SQLite file.

## Run it

```powershell
cd app
docker compose up -d --build        # http://localhost:3001  (open mode, no sign-in: trials only)
```

Data lives in the `shutdown-data` volume (`/data/shutdown.db`). **Back this volume up** (stop the container and copy the file, or use `sqlite3 shutdown.db ".backup backup.db"`). The database runs in WAL mode, so copy the `-wal` file too if you copy a live database.

Without Docker: `npm ci`, `npm run build -w @shutdown/web`, then `npm run start -w @shutdown/api` (Node 24+; uses the built-in `node:sqlite`).

## Sign-in with Microsoft 365 (Entra ID)

Set `AUTH_MODE=entra`. Without it the app is **open to anyone who can reach it** and trusts a typed name for the audit trail.

The server code and token checks are tested with locally generated keys. It has **not** been run against a real tenant yet; do the checklist below in a test tenant first.

1. **API app registration** (Entra admin center → App registrations → New)
   - Application ID URI: `api://<api-client-id>`; add a scope named `access_as_user`.
   - App roles (allowed member types: Users/Groups): values `Viewer`, `Editor`, `Importer`.
   - Manifest: set `requestedAccessTokenVersion` (under `api`) to `2`, so tokens carry the `…/v2.0` issuer the server expects.
2. **SPA app registration**
   - Platform: *Single-page application*; redirect URI = the URL users open (e.g. `https://shutdown.example.com`).
   - API permissions: add the `access_as_user` scope of the API app and grant consent.
3. **Assign people**: Enterprise applications → the API app → Users and groups → assign each person/group a role. (Alternative: skip app roles and give security-group object ids in `ENTRA_GROUP_*`; the token must then contain a `groups` claim.)
4. **Environment** (compose reads these from your shell or an `.env` file next to `docker-compose.yml`):

| Variable | Meaning |
|---|---|
| `AUTH_MODE` | `entra` |
| `ENTRA_TENANT_ID` | Directory (tenant) id |
| `ENTRA_API_CLIENT_ID` | API app registration client id (audience becomes `api://<id>`; or set `ENTRA_AUDIENCE`) |
| `ENTRA_SPA_CLIENT_ID` | SPA registration client id |
| `ENTRA_GROUP_IMPORTER` / `_EDITOR` / `_VIEWER` | optional comma-separated group object ids |
| `TLS` | `true` once served over https (turns on HSTS) |

Roles: **Viewer** sees everything. **Editor** also updates job progress. **Importer** also uploads/commits plans and sees import history. A signed-in user with no role gets a clear "no access" message.

Serve it behind HTTPS (reverse proxy or load balancer). MSAL requires a secure origin except on `localhost`.

## Moving from SQLite to the company database

The schema (`apps/api/src/db.ts`) is plain `TEXT/INTEGER/REAL`, naive-local timestamps as text and JSON as text, so it ports as-is. The *code* is not driver-free yet. Before production on SQL Server or PostgreSQL, budget a small refactor:

- `node:sqlite` is synchronous; a network driver is async, so `importService.ts` / `progressService.ts` need `async/await` and `tx()` needs a real transaction wrapper.
- `?` placeholders become `$1…` (PostgreSQL) or `@p1…` (SQL Server).
- `lastInsertRowid` / `AUTOINCREMENT` → `RETURNING id` (PostgreSQL) or `OUTPUT INSERTED.id` (SQL Server) with identity columns.
- `INSERT … ON CONFLICT DO UPDATE` works on PostgreSQL; on SQL Server use `MERGE`.
- `PRAGMA user_version` migrations → a `schema_migrations` table.
- The existing tests (`apps/api/test`) exercise every query through HTTP and are the safety net for the port.

Decision needed from IT: engine, connection details, and whether the app may create its own tables.

## Operations notes

- Uploads: `.xlsx` only, 25 MB max, 20 uploads/minute per client; the workbook is parsed in memory and external links in it are never followed.
- Health check: `GET /health`. Logs are JSON on stdout.
- Import history keeps every committed plan; *History → Make live again* rolls back. Progress entered by operators is stored separately and survives re-imports and rollbacks.
- Single instance only (SQLite). Running several replicas needs the database move above.
