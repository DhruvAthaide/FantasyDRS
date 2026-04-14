/**
 * GET /api/results/[raceId]/auto
 *
 * STUB: FastF1 auto-ingestion is disabled in v1.0 (Bucket B per Phase 2).
 * Use `backend/scripts/refresh_race_data.py` locally to pull FastF1 data
 * into committed JSON artifacts, then POST /api/results/[raceId] to upload.
 */
import { withRouteErrorHandler } from "@/lib/api-helpers";

export async function GET() {
  return withRouteErrorHandler(async () => {
    return {
      status: "unavailable",
      reason:
        "FastF1 auto-ingestion is disabled in the Vercel deployment. " +
        "Use backend/scripts/refresh_race_data.py locally, then POST to /api/results/[raceId].",
    };
  });
}
