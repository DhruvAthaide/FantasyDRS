/**
 * GET /api/results/[raceId]/scorecard — computed fantasy scoring breakdown
 * per driver, compared to simulation predictions.
 * Ported from backend/app/routers/results.py::get_scorecard.
 */
import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  constructors,
  drivers,
  raceResults,
  simulationResults,
} from "@/db/schema";
import { withRouteErrorHandler } from "@/lib/api-helpers";
import {
  scoreQualifyingDriver,
  scoreRacePosition,
  FASTEST_LAP_PTS,
  DRIVER_OF_THE_DAY_PTS,
  RACE_DNF_PENALTY,
  POSITIONS_CHANGE_MULTIPLIER,
  OVERTAKE_PTS,
} from "@/lib/simulation/scoring";

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ raceId: string }> }
) {
  const { raceId: raceIdStr } = await params;
  const raceId = parseInt(raceIdStr, 10);

  return withRouteErrorHandler(async () => {
    if (Number.isNaN(raceId)) return [];
    const results = await db
      .select()
      .from(raceResults)
      .where(eq(raceResults.raceId, raceId));
    if (results.length === 0) return [];

    const scorecards: Array<Record<string, unknown>> = [];
    for (const r of results) {
      if (r.driverId === null) continue;
      const d = await db
        .select()
        .from(drivers)
        .where(eq(drivers.id, r.driverId))
        .limit(1);
      if (d.length === 0) continue;
      const driver = d[0];
      let ctorColor = "#888";
      if (driver.constructorId !== null) {
        const c = await db
          .select({ color: constructors.color })
          .from(constructors)
          .where(eq(constructors.id, driver.constructorId))
          .limit(1);
        if (c.length > 0) ctorColor = c[0].color ?? "#888";
      }

      const qPos = r.qualifyingPosition ?? 22;
      const rPos = r.racePosition ?? 22;
      const qPts = scoreQualifyingDriver(qPos);
      const rPts = r.dnf ? 0 : scoreRacePosition(rPos);
      const positionsGained =
        !r.dnf && r.racePosition !== null ? qPos - rPos : 0;
      const posPts = positionsGained * POSITIONS_CHANGE_MULTIPLIER;
      const otPts = (r.overtakes ?? 0) * OVERTAKE_PTS;
      const flPts = r.fastestLap ? FASTEST_LAP_PTS : 0;
      const dotdPts = r.dotd ? DRIVER_OF_THE_DAY_PTS : 0;
      const dnfPen = r.dnf ? RACE_DNF_PENALTY : 0;

      const total = qPts + rPts + posPts + otPts + flPts + dotdPts + dnfPen;

      // Prediction
      const sim = await db
        .select({ mean: simulationResults.expectedPtsMean })
        .from(simulationResults)
        .where(
          and(
            eq(simulationResults.assetType, "driver"),
            eq(simulationResults.assetId, r.driverId),
            eq(simulationResults.raceId, raceId)
          )
        )
        .orderBy(desc(simulationResults.id))
        .limit(1);
      const predicted = sim.length > 0 ? sim[0].mean ?? null : null;
      const diff = predicted !== null ? round2(total - predicted) : null;

      scorecards.push({
        driver_id: r.driverId,
        code: driver.code,
        name: `${driver.firstName} ${driver.lastName}`,
        constructor_color: ctorColor,
        qualifying_position: r.qualifyingPosition,
        race_position: r.racePosition,
        dnf: r.dnf ?? false,
        fastest_lap: r.fastestLap ?? false,
        dotd: r.dotd ?? false,
        overtakes: r.overtakes ?? 0,
        qualifying_pts: qPts,
        race_pts: rPts,
        positions_gained_pts: posPts,
        overtake_pts: otPts,
        fastest_lap_pts: flPts,
        dotd_pts: dotdPts,
        dnf_penalty: dnfPen,
        total_pts: total,
        predicted_pts: predicted !== null ? round2(predicted) : null,
        prediction_diff: diff,
      });
    }

    scorecards.sort(
      (a, b) => (b.total_pts as number) - (a.total_pts as number)
    );
    return scorecards;
  });
}
