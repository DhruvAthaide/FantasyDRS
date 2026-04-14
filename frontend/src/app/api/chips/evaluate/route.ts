/**
 * GET /api/chips/evaluate?chip_type=all|wildcard|limitless|extra_drs|final_fix|autopilot
 * Ported from backend/app/routers/chips.py.
 */
import { asc, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { db } from "@/db";
import { races, simulationResults } from "@/db/schema";
import {
  queryParam,
  withRouteErrorHandler,
} from "@/lib/api-helpers";
import type {
  ChipRaceValue,
  ChipStrategyResponse,
} from "@/lib/api-types";
import { buildAssetListsForRace } from "@/lib/simulation/auto-sim-helpers";
import {
  findBestTeams,
  type Asset,
} from "@/lib/simulation/optimizer";

const CHIP_TYPES = [
  "wildcard",
  "limitless",
  "extra_drs",
  "final_fix",
  "autopilot",
] as const;
type ChipType = (typeof CHIP_TYPES)[number];

function normalBest(drivers: Asset[], ctors: Asset[]): number {
  const teams = findBestTeams({
    drivers,
    constructors: ctors,
    budget: 100.0,
    topN: 1,
  });
  return teams[0]?.total_points ?? 0;
}

function chipBest(
  chip: ChipType,
  driverAssets: Asset[],
  ctors: Asset[]
): number {
  switch (chip) {
    case "wildcard":
      return normalBest(driverAssets, ctors);
    case "limitless": {
      const teams = findBestTeams({
        drivers: driverAssets,
        constructors: ctors,
        budget: 9999.0,
        topN: 1,
      });
      return teams[0]?.total_points ?? 0;
    }
    case "extra_drs": {
      // Top 3 drivers get 2x; others 1x
      const teams = findBestTeams({
        drivers: driverAssets,
        constructors: ctors,
        budget: 100.0,
        topN: 1,
        drsMultiplier: 1,
      });
      if (teams.length === 0) return 0;
      const team = teams[0];
      const driverPts = team.drivers
        .map((d) => d.expected_pts)
        .sort((a, b) => b - a);
      const baseCtorPts = team.constructors.reduce(
        (s, c) => s + c.expected_pts,
        0
      );
      const top3 = driverPts.slice(0, 3).reduce((a, b) => a + b, 0);
      const rest = driverPts.slice(3).reduce((a, b) => a + b, 0);
      return top3 * 2 + rest + baseCtorPts;
    }
    case "final_fix":
      return normalBest(driverAssets, ctors) * 1.02;
    case "autopilot":
      return normalBest(driverAssets, ctors);
    default:
      return normalBest(driverAssets, ctors);
  }
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

export async function GET(request: NextRequest) {
  const chipTypeParam = queryParam(request, "chip_type") ?? "all";

  return withRouteErrorHandler(async (): Promise<ChipStrategyResponse[]> => {
    const chipTypes: ChipType[] =
      chipTypeParam !== "all" &&
      (CHIP_TYPES as readonly string[]).includes(chipTypeParam)
        ? [chipTypeParam as ChipType]
        : [...CHIP_TYPES];

    const allRaces = await db.select().from(races).orderBy(asc(races.round));

    const results: ChipStrategyResponse[] = [];
    for (const ct of chipTypes) {
      const raceValues: ChipRaceValue[] = [];
      for (const race of allRaces) {
        const hasSim = await db
          .select({ id: simulationResults.id })
          .from(simulationResults)
          .where(eq(simulationResults.raceId, race.id))
          .limit(1);
        if (hasSim.length === 0) {
          raceValues.push({
            race_id: race.id,
            race_name: race.name,
            race_round: race.round,
            normal_points: 0,
            chip_points: 0,
            chip_gain: 0,
          });
          continue;
        }
        const { drivers: ds, constructors: cs } =
          await buildAssetListsForRace(race.id);
        const normal = normalBest(ds, cs);
        const chip = chipBest(ct, ds, cs);
        const gain = chip - normal;
        raceValues.push({
          race_id: race.id,
          race_name: race.name,
          race_round: race.round,
          normal_points: round2(normal),
          chip_points: round2(chip),
          chip_gain: round2(gain),
        });
      }

      let best: ChipRaceValue | null = null;
      for (const rv of raceValues) {
        if (best === null || rv.chip_gain > best.chip_gain) best = rv;
      }

      results.push({
        chip_type: ct,
        race_values: raceValues,
        best_race_id: best?.race_id ?? 0,
        best_race_name: best?.race_name ?? "",
        best_gain: best?.chip_gain ?? 0,
      });
    }

    return results;
  });
}
