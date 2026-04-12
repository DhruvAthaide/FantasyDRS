# FantasyDRS

F1 Fantasy simulation, prediction, and team optimization — deployed on Vercel as a single unified Next.js project.

**Status:** migrating from split Next.js frontend + FastAPI backend to unified Next.js + TypeScript on Vercel. See `.paul/ROADMAP.md` for phase progress.

## Project Layout

```
.
├── frontend/        # Next.js 16 app (future home of the unified stack)
├── backend/         # FastAPI app + FastF1 integration (read-only, being migrated)
├── .paul/           # PAUL framework state (planning, decisions, summaries)
├── vercel.json      # Points Vercel at frontend/ as the project root
└── README.md
```

## Quick Start

### Frontend (Next.js)

```bash
cd frontend
npm install
npm run dev          # http://localhost:3000
```

Environment: copy `frontend/.env.example` to `frontend/.env.local` and fill in the Neon connection strings (or run `npx vercel env pull .env.local` if the project is linked to Vercel).

### Database (Neon Postgres via Drizzle)

```bash
cd frontend
npm run db:generate          # generate migration from schema.ts
npm run db:push              # apply schema to Neon (non-interactive: add --force)
npm run db:seed              # seed drivers / constructors / circuits / races
npm run db:import-results    # import race results from frontend/data/f1/**
```

### Backend (legacy FastAPI — being migrated)

```bash
cd backend
source venv/Scripts/activate
uvicorn app.main:app --reload
```

## Refreshing F1 data before deploy

FantasyDRS ships committed F1 data artifacts under `frontend/data/f1/**` (see
`.paul/phases/02-f1-data-strategy/02-01-RESEARCH.md` for the data contract).
The refresh script runs **locally** (never on Vercel) and regenerates these
artifacts from FastF1 + OpenF1.

**Before each race weekend deploy:**

```bash
# 1. Activate the Python backend venv (FastF1 lives here)
cd backend && source venv/Scripts/activate

# 2. Refresh the round that just completed (example: round 4)
python scripts/refresh_race_data.py --year 2026 --round 4 --verbose

# 3. Commit the updated artifacts
cd ..
git add frontend/data/f1
git commit -m "data(f1): refresh 2026 round 4"

# 4. Import into Neon and deploy
cd frontend
npm run db:import-results
git push   # Vercel deploys
```

**Other modes:**

```bash
python scripts/refresh_race_data.py --year 2026 --all-past       # every past race
python scripts/refresh_race_data.py --year 2026 --round-range 1-6
```

Notes:

- `backend/.fastf1_cache/` is gitignored. First fetch of a given race downloads
  from FastF1 (slow, minutes); subsequent runs hit the local cache (fast).
- Future-dated races are skipped gracefully with a `_meta.json` note — safe to
  run `--all-past` without manual filtering.
- If both FastF1 (Ergast) and OpenF1 are unavailable for a past race, `_meta.json`
  records `source: "none"` with a retry note. Re-run the script later; the import
  step is idempotent.

### Per-weekend refresh checklist

After each race weekend, before deploying updated data:

1. Wait for the race to complete and results to publish (usually Sunday + 2–3 hours).
2. Activate the Python backend venv: `cd backend && source venv/Scripts/activate`.
3. Refresh the completed round:

   ```bash
   python scripts/refresh_race_data.py --year 2026 --round <N> --verbose
   ```

4. Open `frontend/data/f1/2026/<NN>-<slug>/_meta.json` and confirm `source` is
   either `"fastf1"` or `"openf1-fallback"` (NOT `"none"`). If `"none"`, wait a
   few hours and re-run — upstream data is still propagating.
5. Commit the refreshed artifacts:

   ```bash
   cd .. && git add frontend/data/f1 && git commit -m "data(f1): refresh 2026 round <N>"
   ```

6. Import into Neon:

   ```bash
   cd frontend && npm run db:import-results
   ```

7. Push to deploy:

   ```bash
   git push
   ```

   Vercel picks up the push and redeploys automatically.

**Feature flag reminder:** `FEATURE_TELEMETRY_LIVE` stays `false` for v1.0 — the
12 `/api/telemetry/*` methods short-circuit to empty responses and the
driver-analysis page renders a placeholder. Only flip this flag (via
`NEXT_PUBLIC_FEATURE_TELEMETRY_LIVE=true`) when a long-running backend capable
of live FastF1 session loads is wired in (post-v1.0).

## PAUL Framework

This project uses the [PAUL framework](https://github.com/paul-framework/paul)
for planning and execution. See `.paul/` for the full context:

- `.paul/PROJECT.md` — what this is and why
- `.paul/ROADMAP.md` — phase plan
- `.paul/STATE.md` — current position and decisions
- `.paul/phases/<N>-<name>/` — per-phase PLAN + SUMMARY files
