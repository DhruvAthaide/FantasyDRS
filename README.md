# FantasyDRS

F1 Fantasy team optimizer + Monte Carlo simulation. **v1.0 Vercel-only**: Next.js app backed by Neon Postgres.

## Project Layout

```
.
├── frontend/                  # Next.js 16 App Router — the entire app
│   ├── src/
│   │   ├── app/               # Pages + 35 /api/* route handlers
│   │   ├── db/                # Drizzle schema + seed scripts
│   │   ├── lib/
│   │   │   ├── api-types.ts       # Response schemas (pydantic mirrors)
│   │   │   ├── api-helpers.ts     # withRouteErrorHandler etc
│   │   │   ├── f1-data.ts         # Static artifact loader (Phase 2)
│   │   │   └── simulation/        # Monte Carlo engine + optimizer (Phase 3)
│   │   └── ...
│   └── data/f1/**             # Committed F1 data (refreshed locally)
├── backend/
│   ├── scripts/               # LOCAL-only refresh workflow (not deployed)
│   │   ├── refresh_race_data.py
│   │   ├── practice_data.py
│   │   └── generate_golden_fixtures.py   # historical — see file header
│   ├── data/seed_data.json    # Source of truth for drivers/constructors/calendar/prices
│   └── requirements.txt       # Python deps for the refresh workflow
├── .paul/                     # PAUL framework: plans, summaries, state
└── README.md
```

## Quick Start

### Frontend (Next.js)

```bash
cd frontend
npm install
cp .env.example .env.local    # then fill in Neon connection strings
npm run dev                   # http://localhost:3000
```

If the project is linked to Vercel, `npx vercel env pull .env.local` pulls the Neon vars automatically.

### Database setup (one-time)

```bash
cd frontend
npm run db:push               # apply Drizzle schema to Neon (--force for non-interactive)
npm run db:seed               # seed drivers / constructors / circuits / races
npm run db:seed-prices        # seed opening-day fantasy_prices
npm run db:import-results     # import any committed race results
```

### Populate simulation predictions

```bash
cd frontend
curl -X POST http://localhost:3000/api/simulate/batch \
  -H 'Content-Type: application/json' \
  -d '{"n_simulations": 1000}'
```

(~1-2 minutes for the full 24-race season)

## Refreshing F1 data before deploy

The Python workflow under `backend/scripts/` pulls live F1 data via FastF1. It runs **locally only** — there is no Python HTTP server in the Vercel deployment. The refresh script produces JSON artifacts under `frontend/data/f1/**` that you commit alongside code changes.

**Before each race weekend deploy:**

```bash
# 1. Activate the refresh-script venv
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

- `backend/.fastf1_cache/` is gitignored. First fetch of a given race downloads from FastF1 (slow, minutes); subsequent runs hit the local cache (fast).
- Future-dated races are skipped gracefully with a `_meta.json` note — safe to run `--all-past` without manual filtering.
- If both FastF1 (Ergast) and OpenF1 are unavailable for a past race, `_meta.json` records `source: "none"` with a retry note. Re-run the script later; the import step is idempotent.

### Per-weekend refresh checklist

After each race weekend, before deploying updated data:

1. Wait for the race to complete and results to publish (usually Sunday + 2–3 hours).
2. Activate the refresh-script venv: `cd backend && source venv/Scripts/activate`.
3. Refresh the completed round:

   ```bash
   python scripts/refresh_race_data.py --year 2026 --round <N> --verbose
   ```

4. Open `frontend/data/f1/2026/<NN>-<slug>/_meta.json` and confirm `source` is either `"fastf1"` or `"openf1-fallback"` (NOT `"none"`). If `"none"`, wait a few hours and re-run — upstream data is still propagating.
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

**Feature flag reminder:** `FEATURE_TELEMETRY_LIVE` stays `false` for v1.0 — the 12 `/api/telemetry/*` methods short-circuit to empty responses and the driver-analysis page renders a placeholder. Only flip this flag (via `NEXT_PUBLIC_FEATURE_TELEMETRY_LIVE=true`) when live FastF1 session loads become feasible (post-v1.0).

## Deployment

FantasyDRS deploys to Vercel as a standard Next.js app. Two external dependencies:

- **Vercel** — hosting + serverless functions
- **Neon** — Postgres database (provisioned through Vercel's Marketplace integration, which injects `DATABASE_URL` et al.)

Set the Vercel project's **Root Directory** to `frontend/`. The repo root also contains `backend/` (local-only refresh workflow) and `.paul/` (project planning) which Vercel correctly ignores outside the Root Directory.

Phase 6 will cover deployment validation + performance tuning.

## PAUL Framework

This project uses the [PAUL framework](https://github.com/paul-framework/paul) for planning and execution. See `.paul/` for the full context:

- `.paul/PROJECT.md` — what this is and why
- `.paul/ROADMAP.md` — phase plan
- `.paul/STATE.md` — current position and decisions
- `.paul/phases/<N>-<name>/` — per-phase PLAN + SUMMARY files
