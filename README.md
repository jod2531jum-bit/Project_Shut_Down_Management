# Plant Shutdown Command Center

Web app that imports the team's **Shutdown Form** Excel workbook unchanged and shows it as a Command Center: overview, per-area pages, timeline and start-up series, with progress tracking.

Demo for SKIC APM, PPPC Pulp and Paper shutdown (Oct'26, 15 days).

## Repository layout

| Path | Purpose |
|---|---|
| `Dockerfile` | Single image: API + built web app (build context is the repo root) |
| `app/` | The product (npm workspaces, TypeScript, Node 24+) |
| `app/packages/shutdown-parser` | Pure workbook parser (ExcelJS, cached values only) |
| `app/apps/api` | Fastify + `node:sqlite`: import flow, progress, auth, static serving |
| `app/apps/web` | Vite + React + Tailwind v4 UI |
| `app/docs/` | `DEPLOYMENT.md`, `SHUTDOWN_FORM_GUIDE.md` |
| `Major Shutdown Schedule Oct'26 (15 days) Rev.I.xlsx` | Sample workbook (golden test file, do not edit) |

## Run locally

With Docker:

```powershell
cd app
copy .env.example .env
docker compose up -d --build   # http://localhost:3001
```

Without Docker (Node 24+):

```powershell
cd app
npm install
npm run dev -w @shutdown/api   # API on 3001
npm run dev -w @shutdown/web   # web on 5173, proxies /api
```

Tests and checks:

```powershell
npm test -w @shutdown/parser
npm test -w @shutdown/api
npm test -w @shutdown/web
npx tsc --noEmit -p apps/api
```

Open the app, then import the sample workbook on the Import page (upload, review, commit).

## Deploy to Google Cloud Run

The root `Dockerfile` is built by a Cloud Build trigger on this repo (source directory: repo root, Dockerfile: `Dockerfile`). The container listens on the `PORT` Cloud Run provides.

Before exposing it:

- **Sign-in:** the default `AUTH_MODE=none` lets anyone with the URL import and edit. Set `AUTH_MODE=entra` plus the `ENTRA_*` variables, or require authenticated invocation on the Cloud Run service.
- **Persistence:** data is a SQLite file at `/data/shutdown.db`. Cloud Run's disk is ephemeral, so data resets on restart. Mount a Cloud Storage volume at `/data` or move to Cloud SQL.
- **Scaling:** set max instances to 1 (SQLite is not shared across instances).

## Configuration

See [`app/.env.example`](app/.env.example) for all environment variables and `app/docs/DEPLOYMENT.md` for the Entra setup.
