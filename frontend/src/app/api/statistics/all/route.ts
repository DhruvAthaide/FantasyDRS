/**
 * GET /api/statistics/all?race_id=N — ScoreBreakdown[] across all assets.
 * Ported from backend/app/routers/statistics.py::get_all_stats.
 */
import { asc, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { db } from "@/db";
import { constructors, drivers, fantasyScores, races } from "@/db/schema";
import { queryParamInt, withRouteErrorHandler } from "@/lib/api-helpers";
import type { ScoreBreakdown } from "@/lib/api-types";

export async function GET(request: NextRequest) {
  return withRouteErrorHandler(async () => {
    const raceId = queryParamInt(request, "race_id");

    const all = raceId !== null
      ? await db.select().from(fantasyScores).where(eq(fantasyScores.raceId, raceId)).orderBy(asc(fantasyScores.raceId))
      : await db.select().from(fantasyScores).orderBy(asc(fantasyScores.raceId));

    const out: ScoreBreakdown[] = [];
    for (const s of all) {
      let name = "Unknown";
      if (s.assetType === "driver") {
        const d = await db
          .select({ first: drivers.firstName, last: drivers.lastName })
          .from(drivers)
          .where(eq(drivers.id, s.assetId))
          .limit(1);
        if (d.length > 0) name = `${d[0].first} ${d[0].last}`;
      } else {
        const c = await db
          .select({ name: constructors.name })
          .from(constructors)
          .where(eq(constructors.id, s.assetId))
          .limit(1);
        if (c.length > 0) name = c[0].name;
      }
      let raceName = "Unknown";
      if (s.raceId !== null) {
        const r = await db
          .select({ name: races.name })
          .from(races)
          .where(eq(races.id, s.raceId))
          .limit(1);
        if (r.length > 0) raceName = r[0].name;
      }
      out.push({
        asset_type: s.assetType as "driver" | "constructor",
        asset_id: s.assetId,
        asset_name: name,
        race_id: s.raceId ?? 0,
        race_name: raceName,
        qualifying_pts: s.qualifyingPts ?? 0,
        race_position_pts: s.racePositionPts ?? 0,
        positions_gained_pts: s.positionsGainedPts ?? 0,
        overtake_pts: s.overtakePts ?? 0,
        fastest_lap_pts: s.fastestLapPts ?? 0,
        dotd_pts: s.dotdPts ?? 0,
        dnf_penalty: s.dnfPenalty ?? 0,
        pitstop_pts: s.pitstopPts ?? 0,
        total_pts: s.totalPts ?? 0,
      });
    }
    return out;
  });
}
