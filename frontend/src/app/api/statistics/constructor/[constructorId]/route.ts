/**
 * GET /api/statistics/constructor/[constructorId] — ScoreBreakdown[] for a constructor.
 * Ported from backend/app/routers/statistics.py::get_constructor_stats.
 */
import { and, asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { constructors, fantasyScores, races } from "@/db/schema";
import { withRouteErrorHandler } from "@/lib/api-helpers";
import type { ScoreBreakdown } from "@/lib/api-types";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ constructorId: string }> }
) {
  const { constructorId: cidStr } = await params;
  const cid = parseInt(cidStr, 10);

  return withRouteErrorHandler(async () => {
    if (Number.isNaN(cid)) return [];

    const c = await db
      .select()
      .from(constructors)
      .where(eq(constructors.id, cid))
      .limit(1);
    if (c.length === 0) return [];
    const ctor = c[0];

    const scores = await db
      .select()
      .from(fantasyScores)
      .where(
        and(
          eq(fantasyScores.assetType, "constructor"),
          eq(fantasyScores.assetId, cid)
        )
      )
      .orderBy(asc(fantasyScores.raceId));

    const out: ScoreBreakdown[] = [];
    for (const s of scores) {
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
        asset_type: "constructor",
        asset_id: cid,
        asset_name: ctor.name,
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
