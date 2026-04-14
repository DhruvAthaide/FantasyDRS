/**
 * GET /api/statistics/driver/[driverId] — ScoreBreakdown[] for one driver.
 * Ported from backend/app/routers/statistics.py::get_driver_stats.
 */
import { asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { drivers, fantasyScores, races } from "@/db/schema";
import { withRouteErrorHandler } from "@/lib/api-helpers";
import type { ScoreBreakdown } from "@/lib/api-types";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ driverId: string }> }
) {
  const { driverId: driverIdStr } = await params;
  const driverId = parseInt(driverIdStr, 10);

  return withRouteErrorHandler(async () => {
    if (Number.isNaN(driverId)) return [];

    const d = await db
      .select()
      .from(drivers)
      .where(eq(drivers.id, driverId))
      .limit(1);
    if (d.length === 0) return [];
    const driver = d[0];

    const scores = await db
      .select()
      .from(fantasyScores)
      .where(
        eq(fantasyScores.assetType, "driver")
      )
      .orderBy(asc(fantasyScores.raceId));

    const driverScores = scores.filter((s) => s.assetId === driverId);
    const out: ScoreBreakdown[] = [];
    for (const s of driverScores) {
      let raceName = "Unknown";
      if (s.raceId !== null) {
        const race = await db
          .select({ name: races.name })
          .from(races)
          .where(eq(races.id, s.raceId))
          .limit(1);
        if (race.length > 0) raceName = race[0].name;
      }
      out.push({
        asset_type: "driver",
        asset_id: driverId,
        asset_name: `${driver.firstName} ${driver.lastName}`,
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
