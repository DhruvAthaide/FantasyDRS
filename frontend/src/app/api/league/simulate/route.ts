/**
 * POST /api/league/simulate — LeagueSimResult[] for my team + rivals.
 * Ported from backend/app/routers/league.py.
 */
import { and, desc, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { db } from "@/db";
import { simulationResults } from "@/db/schema";
import {
  parseJsonBody,
  withRouteErrorHandler,
} from "@/lib/api-helpers";
import type {
  LeagueSimRequest,
  LeagueSimResult,
  RivalTeam,
} from "@/lib/api-types";

function isRivalTeam(x: unknown): x is RivalTeam {
  if (x === null || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.name === "string" &&
    Array.isArray(o.driver_ids) &&
    Array.isArray(o.constructor_ids) &&
    typeof o.drs_driver_id === "number"
  );
}

function isLeagueSimRequest(x: unknown): x is LeagueSimRequest {
  if (x === null || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    isRivalTeam(o.my_team) &&
    Array.isArray(o.rivals) &&
    o.rivals.every(isRivalTeam) &&
    typeof o.race_id === "number"
  );
}

async function teamPoints(
  team: RivalTeam,
  raceId: number,
  drsMultiplier = 2
): Promise<number> {
  let total = 0;
  for (const did of team.driver_ids) {
    const sim = await db
      .select({ mean: simulationResults.expectedPtsMean })
      .from(simulationResults)
      .where(
        and(
          eq(simulationResults.assetType, "driver"),
          eq(simulationResults.assetId, did),
          eq(simulationResults.raceId, raceId)
        )
      )
      .orderBy(desc(simulationResults.id))
      .limit(1);
    let pts = sim[0]?.mean ?? 0;
    if (did === team.drs_driver_id) pts *= drsMultiplier;
    total += pts;
  }
  for (const cid of team.constructor_ids) {
    const sim = await db
      .select({ mean: simulationResults.expectedPtsMean })
      .from(simulationResults)
      .where(
        and(
          eq(simulationResults.assetType, "constructor"),
          eq(simulationResults.assetId, cid),
          eq(simulationResults.raceId, raceId)
        )
      )
      .orderBy(desc(simulationResults.id))
      .limit(1);
    total += sim[0]?.mean ?? 0;
  }
  return total;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

export async function POST(request: NextRequest) {
  return withRouteErrorHandler(async (): Promise<LeagueSimResult[]> => {
    const body = await parseJsonBody<LeagueSimRequest>(
      request,
      isLeagueSimRequest
    );
    const allTeams: RivalTeam[] = [body.my_team, ...body.rivals];

    const teamPts: Array<[string, number]> = [];
    for (const t of allTeams) {
      const pts = await teamPoints(t, body.race_id);
      teamPts.push([t.name, pts]);
    }
    const myPts = teamPts[0][1];
    const totalPts = teamPts.reduce((s, [, p]) => s + p, 0);

    const results: LeagueSimResult[] = teamPts.map(([name, pts]) => ({
      team_name: name,
      expected_points: round2(pts),
      win_probability:
        totalPts > 0 ? round4(pts / totalPts) : round4(1 / allTeams.length),
      differential: round2(pts - myPts),
    }));

    results.sort((a, b) => b.expected_points - a.expected_points);
    return results;
  });
}
