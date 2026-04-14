/**
 * POST /api/best-teams
 * Ported from backend/app/routers/simulation.py::get_best_teams.
 *
 * Body: BestTeamRequest (all fields optional; defaults match Python).
 * Returns: TeamResult[]
 *
 * Perf (Plan 06-02): response DTOs built entirely from the maps returned by
 * buildAssetListsForRace — zero extra DB round-trips in the hot path.
 */
import type { NextRequest } from "next/server";

import {
  BadRequestError,
  parseJsonBody,
  withRouteErrorHandler,
} from "@/lib/api-helpers";
import type {
  BestTeamRequest,
  ConstructorResponse,
  DriverResponse,
  TeamResult,
} from "@/lib/api-types";
import { findBestTeams, type Asset } from "@/lib/simulation/optimizer";
import { buildAssetListsForRace } from "@/lib/simulation/auto-sim-helpers";

function isBestTeamRequest(x: unknown): x is BestTeamRequest {
  if (x === null || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (o.budget !== undefined && typeof o.budget !== "number") return false;
  if (o.race_id !== undefined && o.race_id !== null && typeof o.race_id !== "number") return false;
  if (o.top_n !== undefined && typeof o.top_n !== "number") return false;
  if (o.drs_multiplier !== undefined && typeof o.drs_multiplier !== "number") return false;
  if (
    o.drs_driver_id !== undefined &&
    o.drs_driver_id !== null &&
    typeof o.drs_driver_id !== "number"
  )
    return false;
  for (const k of [
    "include_drivers",
    "exclude_drivers",
    "include_constructors",
    "exclude_constructors",
  ] as const) {
    if (o[k] !== undefined && !Array.isArray(o[k])) return false;
  }
  return true;
}

export async function POST(request: NextRequest) {
  return withRouteErrorHandler(async (): Promise<TeamResult[]> => {
    const body = await parseJsonBody<BestTeamRequest>(
      request,
      isBestTeamRequest
    );
    const budget = body.budget ?? 100.0;
    const topN = body.top_n ?? 10;
    const drsMultiplier = body.drs_multiplier ?? 2;

    if (budget <= 0) throw new BadRequestError("budget must be > 0");
    if (topN < 1) throw new BadRequestError("top_n must be >= 1");

    const bundle = await buildAssetListsForRace(body.race_id ?? null);
    const {
      drivers: driverAssets,
      constructors: constructorAssets,
      driversById,
      constructorsById,
      driverCodesByConstructorId,
    } = bundle;

    const teams = findBestTeams({
      drivers: driverAssets,
      constructors: constructorAssets,
      budget,
      topN,
      drsMultiplier,
      includeDriverIds: body.include_drivers,
      excludeDriverIds: body.exclude_drivers,
      includeConstructorIds: body.include_constructors,
      excludeConstructorIds: body.exclude_constructors,
      drsDriverId: body.drs_driver_id ?? undefined,
    });

    const driverAssetToResponse = (asset: Asset): DriverResponse | null => {
      const row = driversById.get(asset.id);
      if (!row) return null;
      return {
        id: row.id,
        code: row.code,
        first_name: row.firstName,
        last_name: row.lastName,
        number: row.number,
        constructor_id: row.constructorId ?? 0,
        constructor_name: asset.constructor_name ?? "",
        constructor_color: asset.constructor_color ?? "#888",
        country: row.country,
        price: asset.price,
        expected_pts: asset.expected_pts,
      };
    };

    const constructorAssetToResponse = (
      asset: Asset
    ): ConstructorResponse | null => {
      const row = constructorsById.get(asset.id);
      if (!row) return null;
      return {
        id: row.id,
        ref_id: row.refId,
        name: row.name,
        color: row.color ?? "",
        price: asset.price,
        driver_codes: driverCodesByConstructorId.get(row.id) ?? [],
        expected_pts: asset.expected_pts,
      };
    };

    const results: TeamResult[] = [];
    for (const team of teams) {
      const driverResponses: DriverResponse[] = [];
      for (const da of team.drivers) {
        const r = driverAssetToResponse(da);
        if (r !== null) driverResponses.push(r);
      }

      const constructorResponses: ConstructorResponse[] = [];
      for (const ca of team.constructors) {
        const r = constructorAssetToResponse(ca);
        if (r !== null) constructorResponses.push(r);
      }

      const drs = driverAssetToResponse(team.drs_driver);
      if (drs === null) continue;

      results.push({
        drivers: driverResponses,
        constructors: constructorResponses,
        drs_driver: drs,
        total_cost: team.total_cost,
        total_points: team.total_points,
        budget_remaining: team.budget_remaining,
      });
    }

    return results;
  });
}
