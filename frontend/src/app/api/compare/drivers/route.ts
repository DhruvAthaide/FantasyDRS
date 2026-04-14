/**
 * GET /api/compare/drivers?ids=1,2,3&race_id=4
 * Ported from backend/app/routers/compare.py::compare_drivers.
 */
import { and, desc, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/db";
import {
  constructors,
  drivers,
  fantasyPrices,
  races,
  raceResults,
  simulationResults,
} from "@/db/schema";
import {
  queryParam,
  queryParamInt,
  withRouteErrorHandler,
} from "@/lib/api-helpers";
import type { FormTrend } from "@/lib/api-types";

function normalize(value: number, minV: number, maxV: number): number {
  if (maxV === minV) return 50.0;
  return Math.round(((value - minV) / (maxV - minV)) * 100 * 10) / 10;
}

async function formTrend(driverId: number): Promise<FormTrend> {
  const rows = await db
    .select({
      dnf: raceResults.dnf,
      racePosition: raceResults.racePosition,
    })
    .from(raceResults)
    .innerJoin(races, eq(races.id, raceResults.raceId))
    .where(eq(raceResults.driverId, driverId))
    .orderBy(desc(races.round))
    .limit(3);
  if (rows.length < 2) return "stable";
  const positions = rows
    .filter((r) => !r.dnf && r.racePosition !== null)
    .map((r) => r.racePosition as number);
  if (positions.length < 2) return "stable";
  const recentAvg = positions.slice(0, 2).reduce((a, b) => a + b, 0) / Math.min(2, positions.length);
  const olderAvg = positions[positions.length - 1];
  const diff = olderAvg - recentAvg;
  if (diff > 1.5) return "improving";
  if (diff < -1.5) return "declining";
  return "stable";
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

  let driverIds: number[];
  try {
    driverIds = idsRaw
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
      { error: "Invalid driver IDs — must be comma-separated integers" },
      { status: 400 }
    );
  }

  return withRouteErrorHandler(async () => {
    const r = await db
      .select()
      .from(races)
      .where(eq(races.id, raceId))
      .limit(1);
    if (r.length === 0) {
      throw new Error("Race not found");
    }

    interface Row {
      driver_id: number;
      code: string;
      name: string;
      constructor_color: string;
      pace_rating: number;
      consistency: number;
      value: number;
      form_trend: FormTrend;
      circuit_fit: number;
      risk: number;
      expected_pts: number;
      price: number;
    }
    const results: Row[] = [];

    for (const did of driverIds) {
      const d = await db
        .select()
        .from(drivers)
        .where(eq(drivers.id, did))
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

      const sim = await db
        .select({
          mean: simulationResults.expectedPtsMean,
          std: simulationResults.expectedPtsStd,
        })
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

      const xpts = sim[0]?.mean ?? 0;
      const std = sim[0]?.std ?? 5;

      const priceRow = await db
        .select({ price: fantasyPrices.price })
        .from(fantasyPrices)
        .where(
          and(
            eq(fantasyPrices.assetType, "driver"),
            eq(fantasyPrices.assetId, did)
          )
        )
        .orderBy(desc(fantasyPrices.id))
        .limit(1);
      const price = priceRow[0]?.price ?? 0;

      const ppm = price > 0 ? xpts / price : 0;
      const dnfProxy = xpts > 0 ? std / Math.max(xpts, 1) : 0.5;

      results.push({
        driver_id: did,
        code: driver.code,
        name: `${driver.firstName} ${driver.lastName}`,
        constructor_color: ctorColor,
        pace_rating: xpts,
        consistency: Math.max(0, 100 - std * 5),
        value: ppm * 100,
        form_trend: await formTrend(did),
        circuit_fit: 50.0,
        risk: dnfProxy * 100,
        expected_pts: Math.round(xpts * 100) / 100,
        price,
      });
    }

    if (results.length === 0) return [];

    const metrics: Array<keyof Row> = [
      "pace_rating",
      "consistency",
      "value",
      "circuit_fit",
      "risk",
    ];
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
    // Invert risk so lower is better
    for (const r of results) {
      r.risk = Math.round((100 - r.risk) * 10) / 10;
    }

    return results;
  });
}
