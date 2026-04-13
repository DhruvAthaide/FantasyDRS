/**
 * POST /api/my-team/compare
 * Ported from backend/app/routers/simulation.py::compare_my_team.
 *
 * Sums the user's predicted points (with DRS 2x on the nominated driver),
 * compares vs the optimizer's single best team for the same race.
 */
import { and, desc, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { db } from "@/db";
import { constructors, drivers, simulationResults } from "@/db/schema";
import {
  BadRequestError,
  parseJsonBody,
  withRouteErrorHandler,
} from "@/lib/api-helpers";
import type {
  MyTeamRequest,
  TeamComparisonConstructorPoint,
  TeamComparisonDriverPoint,
  TeamComparisonResponse,
} from "@/lib/api-types";
import {
  buildAssetListsForRace,
} from "@/lib/simulation/auto-sim-helpers";
import { findBestTeams } from "@/lib/simulation/optimizer";

const DRS_MULTIPLIER = 2;

function isMyTeamRequest(x: unknown): x is MyTeamRequest {
  if (x === null || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    Array.isArray(o.driver_ids) &&
    Array.isArray(o.constructor_ids) &&
    typeof o.drs_driver_id === "number" &&
    typeof o.race_id === "number"
  );
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

async function latestDriverSimMean(
  driverId: number,
  raceId: number
): Promise<number> {
  const row = await db
    .select({ mean: simulationResults.expectedPtsMean })
    .from(simulationResults)
    .where(
      and(
        eq(simulationResults.assetType, "driver"),
        eq(simulationResults.assetId, driverId),
        eq(simulationResults.raceId, raceId)
      )
    )
    .orderBy(desc(simulationResults.id))
    .limit(1);
  return row.length > 0 ? row[0].mean ?? 0 : 0;
}

async function latestConstructorSimMean(
  constructorId: number,
  raceId: number
): Promise<number> {
  const row = await db
    .select({ mean: simulationResults.expectedPtsMean })
    .from(simulationResults)
    .where(
      and(
        eq(simulationResults.assetType, "constructor"),
        eq(simulationResults.assetId, constructorId),
        eq(simulationResults.raceId, raceId)
      )
    )
    .orderBy(desc(simulationResults.id))
    .limit(1);
  return row.length > 0 ? row[0].mean ?? 0 : 0;
}

export async function POST(request: NextRequest) {
  return withRouteErrorHandler(async (): Promise<TeamComparisonResponse> => {
    const body = await parseJsonBody<MyTeamRequest>(request, isMyTeamRequest);
    if (body.driver_ids.length === 0 || body.constructor_ids.length === 0) {
      throw new BadRequestError(
        "driver_ids and constructor_ids must be non-empty"
      );
    }

    // My team points
    const driverPoints: TeamComparisonDriverPoint[] = [];
    for (const did of body.driver_ids) {
      let pts = await latestDriverSimMean(did, body.race_id);
      if (did === body.drs_driver_id) pts *= DRS_MULTIPLIER;
      const d = await db
        .select({ code: drivers.code })
        .from(drivers)
        .where(eq(drivers.id, did))
        .limit(1);
      driverPoints.push({
        id: did,
        name: d[0]?.code ?? "?",
        points: round2(pts),
        is_drs: did === body.drs_driver_id,
      });
    }

    const constructorPoints: TeamComparisonConstructorPoint[] = [];
    for (const cid of body.constructor_ids) {
      const pts = await latestConstructorSimMean(cid, body.race_id);
      const c = await db
        .select({ name: constructors.name })
        .from(constructors)
        .where(eq(constructors.id, cid))
        .limit(1);
      constructorPoints.push({
        id: cid,
        name: c[0]?.name ?? "?",
        points: round2(pts),
      });
    }

    const myTotal =
      driverPoints.reduce((s, d) => s + d.points, 0) +
      constructorPoints.reduce((s, c) => s + c.points, 0);

    // Optimal team for the same race
    const { drivers: driverAssets, constructors: constructorAssets } =
      await buildAssetListsForRace(body.race_id);
    const optimal = findBestTeams({
      drivers: driverAssets,
      constructors: constructorAssets,
      budget: 100.0,
      topN: 1,
      drsMultiplier: DRS_MULTIPLIER,
    });
    const optimalPts = optimal[0]?.total_points ?? myTotal;

    return {
      my_team_points: round2(myTotal),
      optimal_points: round2(optimalPts),
      points_left_on_table: round2(optimalPts - myTotal),
      driver_points: driverPoints,
      constructor_points: constructorPoints,
    };
  });
}
