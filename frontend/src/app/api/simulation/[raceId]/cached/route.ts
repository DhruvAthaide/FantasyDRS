/**
 * GET /api/simulation/{race_id}/cached
 * Ported from backend/app/routers/simulation.py::get_cached_simulation.
 *
 * Note: Python's _sim_meta_cache is a long-running in-memory dict populated
 * by run_auto_simulation. Serverless functions can't use that pattern, so
 * data_sources / has_qualifying / has_long_runs / weather are always null
 * or empty in the TS port.
 */
import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { races, simulationResults } from "@/db/schema";
import { withRouteErrorHandler } from "@/lib/api-helpers";
import type { CachedSimResponse } from "@/lib/api-types";
import { buildResponse } from "@/lib/simulation/auto-sim-helpers";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ raceId: string }> }
) {
  const { raceId: raceIdStr } = await params;
  const raceId = parseInt(raceIdStr, 10);

  return withRouteErrorHandler(async (): Promise<CachedSimResponse> => {
    if (Number.isNaN(raceId)) {
      return { status: "not_found", race_id: 0, results: [] };
    }

    const raceRow = await db
      .select()
      .from(races)
      .where(eq(races.id, raceId))
      .limit(1);
    if (raceRow.length === 0) {
      return { status: "not_found", race_id: raceId, results: [] };
    }
    const race = raceRow[0];

    const results = await buildResponse(raceId);
    if (results.length === 0) {
      return {
        status: "no_data",
        race_id: raceId,
        race_name: race.name,
        results: [],
      };
    }

    const latest = await db
      .select({ simulatedAt: simulationResults.simulatedAt })
      .from(simulationResults)
      .where(eq(simulationResults.raceId, raceId))
      .orderBy(desc(simulationResults.simulatedAt))
      .limit(1);
    const simulatedAt =
      latest.length > 0 && latest[0].simulatedAt
        ? latest[0].simulatedAt.toISOString()
        : null;

    return {
      status: "ok",
      race_id: raceId,
      race_name: race.name,
      results,
      simulated_at: simulatedAt,
      // _sim_meta_cache doesn't exist in TS runtime — deterministic empty values
      data_sources: [],
      has_qualifying: false,
      has_long_runs: false,
      weather: null,
    };
  });
}
