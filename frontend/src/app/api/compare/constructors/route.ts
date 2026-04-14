/**
 * GET /api/compare/constructors?ids=1,2&race_id=1
 * Ported from backend/app/routers/compare.py::compare_constructors.
 */
import { and, desc, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/db";
import {
  constructors,
  fantasyPrices,
  simulationResults,
} from "@/db/schema";
import {
  queryParam,
  queryParamInt,
  withRouteErrorHandler,
} from "@/lib/api-helpers";

function normalize(value: number, minV: number, maxV: number): number {
  if (maxV === minV) return 50.0;
  return Math.round(((value - minV) / (maxV - minV)) * 100 * 10) / 10;
}

export async function GET(request: NextRequest) {
  const idsRaw = queryParam(request, "ids");
  const raceId = queryParamInt(request, "race_id");

  if (!idsRaw) {
    return NextResponse.json(
      { error: "Missing `ids` query parameter" },
      { status: 400 }
    );
  }
  if (raceId === null) {
    return NextResponse.json(
      { error: "Missing `race_id` query parameter" },
      { status: 400 }
    );
  }

  let ctorIds: number[];
  try {
    ctorIds = idsRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const n = parseInt(s, 10);
        if (Number.isNaN(n)) throw new Error("not int");
        return n;
      });
  } catch {
    return NextResponse.json(
      { error: "Invalid constructor IDs — must be comma-separated integers" },
      { status: 400 }
    );
  }

  return withRouteErrorHandler(async () => {
    interface Row {
      constructor_id: number;
      name: string;
      color: string;
      pace_rating: number;
      consistency: number;
      value: number;
      expected_pts: number;
      price: number;
    }
    const results: Row[] = [];

    for (const cid of ctorIds) {
      const c = await db
        .select()
        .from(constructors)
        .where(eq(constructors.id, cid))
        .limit(1);
      if (c.length === 0) continue;
      const ctor = c[0];

      const sim = await db
        .select({
          mean: simulationResults.expectedPtsMean,
          std: simulationResults.expectedPtsStd,
        })
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

      const xpts = sim[0]?.mean ?? 0;
      const std = sim[0]?.std ?? 5;

      const priceRow = await db
        .select({ price: fantasyPrices.price })
        .from(fantasyPrices)
        .where(
          and(
            eq(fantasyPrices.assetType, "constructor"),
            eq(fantasyPrices.assetId, cid)
          )
        )
        .orderBy(desc(fantasyPrices.id))
        .limit(1);
      const price = priceRow[0]?.price ?? 0;
      const ppm = price > 0 ? xpts / price : 0;

      results.push({
        constructor_id: cid,
        name: ctor.name,
        color: ctor.color ?? "",
        pace_rating: xpts,
        consistency: Math.max(0, 100 - std * 5),
        value: ppm * 100,
        expected_pts: Math.round(xpts * 100) / 100,
        price,
      });
    }

    if (results.length === 0) return [];

    const metrics: Array<keyof Row> = ["pace_rating", "consistency", "value"];
    for (const m of metrics) {
      const vals = results.map((r) => r[m] as number);
      const minV = Math.min(...vals);
      const maxV = Math.max(...vals);
      for (const r of results) {
        (r as unknown as Record<string, number>)[m as string] = normalize(
          r[m] as number,
          minV,
          maxV
        );
      }
    }

    return results;
  });
}
