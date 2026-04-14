/**
 * GET /api/drs/analyze?race_id=N&driver_ids=1,2,3
 * Ported from backend/app/routers/drs.py.
 */
import { and, desc, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/db";
import {
  constructors,
  drivers,
  fantasyPrices,
  simulationResults,
} from "@/db/schema";
import {
  queryParam,
  queryParamInt,
  withRouteErrorHandler,
} from "@/lib/api-helpers";

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

export async function GET(request: NextRequest) {
  const raceId = queryParamInt(request, "race_id");
  const idsRaw = queryParam(request, "driver_ids");

  if (raceId === null) {
    return NextResponse.json(
      { error: "Missing race_id" },
      { status: 400 }
    );
  }

  let filterIds: number[] | null = null;
  if (idsRaw) {
    try {
      filterIds = idsRaw.split(",").map((s) => {
        const n = parseInt(s.trim(), 10);
        if (Number.isNaN(n)) throw new Error("nan");
        return n;
      });
    } catch {
      return NextResponse.json(
        { error: "driver_ids must be comma-separated integers" },
        { status: 422 }
      );
    }
  }

  return withRouteErrorHandler(async () => {
    const allDrivers = await db.select().from(drivers);

    interface Row {
      driver_id: number;
      code: string;
      name: string;
      constructor_color: string;
      price: number;
      expected_1x: number;
      expected_2x: number;
      extra_from_drs: number;
      p10_2x: number;
      p90_2x: number;
      std: number;
      risk_score: number;
      tier: string;
    }
    const results: Row[] = [];

    for (const d of allDrivers) {
      if (filterIds !== null && !filterIds.includes(d.id)) continue;

      const sim = await db
        .select()
        .from(simulationResults)
        .where(
          and(
            eq(simulationResults.assetType, "driver"),
            eq(simulationResults.assetId, d.id),
            eq(simulationResults.raceId, raceId)
          )
        )
        .orderBy(desc(simulationResults.id))
        .limit(1);
      if (sim.length === 0) continue;
      const s = sim[0];

      let ctorColor = "#888";
      if (d.constructorId !== null) {
        const c = await db
          .select({ color: constructors.color })
          .from(constructors)
          .where(eq(constructors.id, d.constructorId))
          .limit(1);
        if (c.length > 0) ctorColor = c[0].color ?? "#888";
      }

      const priceRow = await db
        .select({ price: fantasyPrices.price })
        .from(fantasyPrices)
        .where(
          and(
            eq(fantasyPrices.assetType, "driver"),
            eq(fantasyPrices.assetId, d.id)
          )
        )
        .orderBy(desc(fantasyPrices.id))
        .limit(1);
      const price = priceRow[0]?.price ?? 0;

      const mean = s.expectedPtsMean ?? 0;
      const p10 = s.expectedPtsP10 ?? 0;
      const p90 = s.expectedPtsP90 ?? 0;
      const std = s.expectedPtsStd ?? 0;

      const riskScore = mean > 0 ? round3(std / mean) : 99.0;
      let tier: string;
      if (riskScore < 0.3 && mean > 0) tier = "safe";
      else if (p90 * 2 > mean * 3) tier = "upside";
      else if (mean <= 0 || riskScore > 1.0) tier = "avoid";
      else tier = "neutral";

      results.push({
        driver_id: d.id,
        code: d.code,
        name: `${d.firstName} ${d.lastName}`,
        constructor_color: ctorColor,
        price,
        expected_1x: round2(mean),
        expected_2x: round2(mean * 2),
        extra_from_drs: round2(mean),
        p10_2x: round2(p10 * 2),
        p90_2x: round2(p90 * 2),
        std: round2(std),
        risk_score: riskScore,
        tier,
      });
    }

    results.sort((a, b) => b.expected_2x - a.expected_2x);
    return results;
  });
}
