/**
 * POST /api/what-if — compare original vs modified team composition.
 * Ported from backend/app/routers/whatif.py.
 */
import { and, desc, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { db } from "@/db";
import {
  constructors,
  drivers,
  simulationResults,
} from "@/db/schema";
import {
  parseJsonBody,
  withRouteErrorHandler,
} from "@/lib/api-helpers";

interface WhatIfRequest {
  race_id: number;
  original_driver_ids: number[];
  original_constructor_ids: number[];
  original_drs_driver_id: number;
  modified_driver_ids: number[];
  modified_constructor_ids: number[];
  modified_drs_driver_id: number;
}

function isWhatIfRequest(x: unknown): x is WhatIfRequest {
  if (x === null || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.race_id === "number" &&
    Array.isArray(o.original_driver_ids) &&
    Array.isArray(o.original_constructor_ids) &&
    typeof o.original_drs_driver_id === "number" &&
    Array.isArray(o.modified_driver_ids) &&
    Array.isArray(o.modified_constructor_ids) &&
    typeof o.modified_drs_driver_id === "number"
  );
}

interface BreakdownEntry {
  asset_type: "driver" | "constructor";
  asset_id: number;
  name: string;
  color: string;
  base_pts: number;
  multiplier: number;
  scored_pts: number;
}

async function simMean(
  assetType: "driver" | "constructor",
  assetId: number,
  raceId: number
): Promise<number> {
  const row = await db
    .select({ mean: simulationResults.expectedPtsMean })
    .from(simulationResults)
    .where(
      and(
        eq(simulationResults.assetType, assetType),
        eq(simulationResults.assetId, assetId),
        eq(simulationResults.raceId, raceId)
      )
    )
    .orderBy(desc(simulationResults.id))
    .limit(1);
  return row[0]?.mean ?? 0;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

async function scoreTeam(
  raceId: number,
  driverIds: number[],
  constructorIds: number[],
  drsDriverId: number
): Promise<[number, BreakdownEntry[]]> {
  const breakdown: BreakdownEntry[] = [];
  let total = 0;

  for (const did of driverIds) {
    const pts = await simMean("driver", did, raceId);
    const multiplier = did === drsDriverId ? 2 : 1;
    const scored = pts * multiplier;
    total += scored;

    const d = await db
      .select()
      .from(drivers)
      .where(eq(drivers.id, did))
      .limit(1);
    let color = "#888";
    const code = d[0]?.code ?? "?";
    if (d[0]?.constructorId !== null && d[0]?.constructorId !== undefined) {
      const c = await db
        .select({ color: constructors.color })
        .from(constructors)
        .where(eq(constructors.id, d[0].constructorId))
        .limit(1);
      if (c.length > 0) color = c[0].color ?? "#888";
    }
    breakdown.push({
      asset_type: "driver",
      asset_id: did,
      name: code,
      color,
      base_pts: round2(pts),
      multiplier,
      scored_pts: round2(scored),
    });
  }

  for (const cid of constructorIds) {
    const pts = await simMean("constructor", cid, raceId);
    total += pts;
    const c = await db
      .select()
      .from(constructors)
      .where(eq(constructors.id, cid))
      .limit(1);
    breakdown.push({
      asset_type: "constructor",
      asset_id: cid,
      name: c[0]?.name ?? "?",
      color: c[0]?.color ?? "#888",
      base_pts: round2(pts),
      multiplier: 1,
      scored_pts: round2(pts),
    });
  }

  return [round2(total), breakdown];
}

export async function POST(request: NextRequest) {
  return withRouteErrorHandler(async () => {
    const body = await parseJsonBody<WhatIfRequest>(request, isWhatIfRequest);

    const [origTotal, origBreakdown] = await scoreTeam(
      body.race_id,
      body.original_driver_ids,
      body.original_constructor_ids,
      body.original_drs_driver_id
    );
    const [modTotal, modBreakdown] = await scoreTeam(
      body.race_id,
      body.modified_driver_ids,
      body.modified_constructor_ids,
      body.modified_drs_driver_id
    );

    // Detect swaps
    const origDrivers = new Set(body.original_driver_ids);
    const modDrivers = new Set(body.modified_driver_ids);
    const origCtors = new Set(body.original_constructor_ids);
    const modCtors = new Set(body.modified_constructor_ids);

    interface Swap {
      type: "driver" | "constructor";
      out: BreakdownEntry;
      in: BreakdownEntry;
      diff: number;
    }
    const swaps: Swap[] = [];

    const driverOuts = [...origDrivers].filter((x) => !modDrivers.has(x)).sort();
    const driverIns = [...modDrivers].filter((x) => !origDrivers.has(x)).sort();
    for (let i = 0; i < driverOuts.length; i++) {
      const outEntry = origBreakdown.find(
        (b) => b.asset_type === "driver" && b.asset_id === driverOuts[i]
      );
      if (i < driverIns.length) {
        const inEntry = modBreakdown.find(
          (b) => b.asset_type === "driver" && b.asset_id === driverIns[i]
        );
        if (outEntry && inEntry) {
          swaps.push({
            type: "driver",
            out: outEntry,
            in: inEntry,
            diff: round2(inEntry.scored_pts - outEntry.scored_pts),
          });
        }
      }
    }

    const ctorOuts = [...origCtors].filter((x) => !modCtors.has(x)).sort();
    const ctorIns = [...modCtors].filter((x) => !origCtors.has(x)).sort();
    for (let i = 0; i < ctorOuts.length; i++) {
      const outEntry = origBreakdown.find(
        (b) => b.asset_type === "constructor" && b.asset_id === ctorOuts[i]
      );
      if (i < ctorIns.length) {
        const inEntry = modBreakdown.find(
          (b) => b.asset_type === "constructor" && b.asset_id === ctorIns[i]
        );
        if (outEntry && inEntry) {
          swaps.push({
            type: "constructor",
            out: outEntry,
            in: inEntry,
            diff: round2(inEntry.scored_pts - outEntry.scored_pts),
          });
        }
      }
    }

    // DRS change
    const drsChanged =
      body.original_drs_driver_id !== body.modified_drs_driver_id;
    let drsDiff = 0;
    if (drsChanged) {
      const oldPts = await simMean("driver", body.original_drs_driver_id, body.race_id);
      const newPts = await simMean("driver", body.modified_drs_driver_id, body.race_id);
      drsDiff = round2(newPts - oldPts);
    }

    return {
      original_total: origTotal,
      modified_total: modTotal,
      differential: round2(modTotal - origTotal),
      original_breakdown: origBreakdown,
      modified_breakdown: modBreakdown,
      swaps,
      drs_changed: drsChanged,
      drs_diff: drsDiff,
    };
  });
}
