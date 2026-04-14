/**
 * GET /api/results — list race_ids that have stored RaceResult rows.
 * Ported from backend/app/routers/results.py::get_all_results.
 */
import { asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { raceResults, races } from "@/db/schema";
import { withRouteErrorHandler } from "@/lib/api-helpers";

export async function GET() {
  return withRouteErrorHandler(async () => {
    const distinct = await db
      .selectDistinct({ raceId: raceResults.raceId })
      .from(raceResults);
    const out: Array<{ race_id: number; race_name: string; race_round: number }> = [];
    for (const { raceId } of distinct) {
      if (raceId === null) continue;
      const r = await db
        .select({ name: races.name, round: races.round })
        .from(races)
        .where(eq(races.id, raceId))
        .limit(1);
      if (r.length > 0) {
        out.push({
          race_id: raceId,
          race_name: r[0].name,
          race_round: r[0].round,
        });
      }
    }
    out.sort((a, b) => a.race_round - b.race_round);
    return out;
  });
}
