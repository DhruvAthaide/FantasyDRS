/**
 * GET /api/results/[raceId]  — fetch stored results for a race
 * POST /api/results/[raceId] — submit/overwrite results for a race
 * Ported from backend/app/routers/results.py.
 */
import { asc, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/db";
import { constructors, drivers, raceResults, races } from "@/db/schema";
import {
  BadRequestError,
  parseJsonBody,
  withRouteErrorHandler,
} from "@/lib/api-helpers";

interface DriverResultInput {
  driver_id: number;
  qualifying_position: number;
  race_position: number;
  dnf?: boolean;
  fastest_lap?: boolean;
  dotd?: boolean;
  overtakes?: number;
}

interface BulkResultsRequest {
  results: DriverResultInput[];
}

function isBulkResults(x: unknown): x is BulkResultsRequest {
  if (x === null || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (!Array.isArray(o.results)) return false;
  for (const r of o.results) {
    if (!r || typeof r !== "object") return false;
    const row = r as Record<string, unknown>;
    if (typeof row.driver_id !== "number") return false;
    if (typeof row.qualifying_position !== "number") return false;
    if (typeof row.race_position !== "number") return false;
    if (row.dnf !== undefined && typeof row.dnf !== "boolean") return false;
    if (row.fastest_lap !== undefined && typeof row.fastest_lap !== "boolean")
      return false;
    if (row.dotd !== undefined && typeof row.dotd !== "boolean") return false;
    if (row.overtakes !== undefined && typeof row.overtakes !== "number")
      return false;
  }
  return true;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ raceId: string }> }
) {
  const { raceId: raceIdStr } = await params;
  const raceId = parseInt(raceIdStr, 10);

  return withRouteErrorHandler(async () => {
    if (Number.isNaN(raceId)) return [];
    const rows = await db
      .select()
      .from(raceResults)
      .where(eq(raceResults.raceId, raceId))
      .orderBy(asc(raceResults.racePosition));

    const out: Array<Record<string, unknown>> = [];
    for (const r of rows) {
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
      out.push({
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
      });
    }
    return out;
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ raceId: string }> }
) {
  const { raceId: raceIdStr } = await params;
  const raceId = parseInt(raceIdStr, 10);

  return withRouteErrorHandler(async () => {
    if (Number.isNaN(raceId)) throw new BadRequestError("Invalid raceId");

    const body = await parseJsonBody<BulkResultsRequest>(request, isBulkResults);

    const r = await db
      .select()
      .from(races)
      .where(eq(races.id, raceId))
      .limit(1);
    if (r.length === 0) {
      return NextResponse.json({ error: "Race not found" }, { status: 404 });
    }

    // Delete existing and bulk-insert
    await db.delete(raceResults).where(eq(raceResults.raceId, raceId));
    if (body.results.length > 0) {
      await db.insert(raceResults).values(
        body.results.map((row) => ({
          raceId,
          driverId: row.driver_id,
          qualifyingPosition: row.qualifying_position,
          racePosition: row.race_position,
          dnf: row.dnf ?? false,
          fastestLap: row.fastest_lap ?? false,
          dotd: row.dotd ?? false,
          overtakes: row.overtakes ?? 0,
        }))
      );
    }
    return { status: "ok", count: body.results.length };
  });
}
