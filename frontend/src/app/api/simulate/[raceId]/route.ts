/**
 * POST /api/simulate/[raceId]
 *
 * STUB: Bucket B — the Python route uses FastF1 live practice data, which
 * isn't available on Vercel. Phase 2 decision: static refresh workflow
 * replaces this. Use /api/simulate/batch with prior history adjustments,
 * or run `backend/scripts/refresh_race_data.py` locally for fresh data.
 */
import { withRouteErrorHandler } from "@/lib/api-helpers";

export async function POST() {
  return withRouteErrorHandler(async () => {
    return {
      status: "unavailable",
      reason:
        "Live per-race simulation with FastF1 is disabled in this deployment. " +
        "Use POST /api/simulate/batch (history-driven) or run " +
        "backend/scripts/refresh_race_data.py locally, then POST to /api/simulate/batch.",
      results: [],
      meta: {},
    };
  });
}
