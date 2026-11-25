# Plant Shutdown Command Center

Web app that imports the team's **Shutdown Form** Excel workbook unchanged and shows it as a Command Center (overview, per-area pages, timeline, start-up series) with progress tracking.

## Layout
- `Major Shutdown Schedule Oct'26 (15 days) Rev.I.xlsx`: real sample workbook; golden file for tests. **Never edit it.** (`~$…xlsx` is Excel's lock file; ignore.)
- `plant_shutdown_command_center (2).html`: the user's UI concept (demo data, day-index model). Reference only. Use the workbook for real dates, durations and jobs.
- `app/`: the product (npm workspaces, TypeScript, Node 24+):
  - `packages/shutdown-parser`: pure `parseShutdownForm(buffer|path)` using ExcelJS. No DB or HTTP.
  - `apps/api`: Fastify + `node:sqlite`. Import flow, progress, auth, static serving.
  - `apps/web`: Vite + React + Tailwind v4. Import UI plus Command Center pages (`src/cc/`), pure time model in `src/lib/model.ts`.
  - `docs/DEPLOYMENT.md` (Docker, Entra sign-in, DB move), `docs/SHUTDOWN_FORM_GUIDE.md` (workbook conventions).

## Commands (run from `app/`)
```powershell
npm install
npm test -w @shutdown/parser      # also: -w @shutdown/api, -w @shutdown/web
npx tsc --noEmit -p apps/api      # type check (same for apps/web, packages/shutdown-parser)
npm run build -w @shutdown/web
docker compose up -d --build      # http://localhost:3001, open mode (Dockerfile lives at repo root for Cloud Build/Cloud Run)
```
Local dev: API `npm run dev -w @shutdown/api` (port 3001, DB `./data/shutdown.db`), web `npm run dev -w @shutdown/web` (5173, proxies `/api`). On this machine ports 3001 and 5173 are used by other programs, so use `.claude/launch.json` configs: `web` (5183, expects API on 3011 via `API_URL`, serves the workbook at `/__sample.xlsx`) and `prod` (API serving the built web on 3012). Don't kill processes you didn't start.

## Domain rules that matter
- Read **cached cell values only**; never evaluate formulas (the workbook has 16 external links and `#REF!` junk).
- Structure comes from conventions: `**` in column A = group; marker rows (`Stop sequence`, `Maintenance time`, `Critical:`, `Start sequence`) set phase and nesting; trailing `*` = critical; D/E formulas pointing at other rows = dependencies. Gantt columns are conditional formatting and ignored. Columns F/G ("Actual") are not real actuals; ignored.
- Timestamps are **naive plant-local** strings `YYYY-MM-DDTHH:mm`, compared as UTC. No timezone conversion anywhere.
- Bad data is reported as import issues (`REF_ERROR`, `TEXT_DATE`, `NEGATIVE_DURATION`, `OUT_OF_WINDOW`, …), never silently fixed. Jobs with unusable dates are kept as unscheduled.
- Progress and status roll-ups are **leaf-only and duration-weighted** (summary rows and duplicate "Maintenance"/"Critical" rows must not double count).
- Window and "Day X of N" come from the imported data (first group named "…Production Shutdown", editable at review). "Now" is the real clock with an as-of override (`localStorage` key `shutdown.asOf`).
- `stable_key` (hash of group, phase, description, nth occurrence) identifies jobs across re-imports. Operator progress (`job_progress`, `job_event`) is keyed by it, not by row id, so re-imports and rollbacks keep it.
- Import is staged: upload, review (mapping, window, diff, issues), commit. Error-level issues need explicit acknowledgement.
- Roles: Viewer (read), Editor (progress), Importer (imports, history). `AUTH_MODE=none` is open dev mode only; Entra mode is tested with local keys but not against a real tenant.

## Gotchas
- `node:sqlite` is loaded with `createRequire` in `apps/api/src/db.ts` because Vite/Vitest strip the `node:` prefix. Keep SQL portable (TEXT/INTEGER/REAL, JSON as text); the DB code is synchronous, so moving to SQL Server/PostgreSQL needs an async refactor (see DEPLOYMENT.md).
- Vite hot reload can blank the page with "PlanProvider missing" after editing `cc/PlanContext.tsx`; a plain reload fixes it.
- In Git Bash, long multi-heredoc commands sometimes fail to parse; write files with the editor tools instead.
- `.claude/launch.json` must live at the project root (this folder). The in-app preview can't attach to an existing URL; configs need a command.
- Windows + Thai text: set `PYTHONIOENCODING=utf-8` when printing workbook contents from Python.
- Tests that need the workbook skip themselves if it is missing.
