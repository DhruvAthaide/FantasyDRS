/**
 * GET|POST /api/refresh
 *
 * STUB: Bucket B — Python version runs FastF1 live-ingest + auto-simulation.
 * Phase 2 decision: refresh is a local developer workflow (refresh_race_data.py),
 * not an HTTP call on Vercel.
 */
import { withRouteErrorHandler } from "@/lib/api-helpers";

function stub() {
  return withRouteErrorHandler(async () => {
    return {
      status: "unavailable",
      reason:
        "FastF1 ingestion + auto-simulation is disabled on Vercel. " +
        "Run `backend/scripts/refresh_race_data.py` locally, commit the artifacts, " +
        "then POST /api/simulate/batch.",
      ingestion: [],
      simulation: null,
    };
  });
}

export const GET = stub;
export const POST = stub;
