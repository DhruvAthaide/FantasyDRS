/**
 * GET /api/statistics/pitstops — PitstopSummary[] per constructor
 * POST /api/statistics/pitstops — create a PitstopResult row
 * Ported from backend/app/routers/statistics.py.
 */
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { db } from "@/db";
import { constructors, pitstopResults, races } from "@/db/schema";
import {
  parseJsonBody,
  withRouteErrorHandler,
} from "@/lib/api-helpers";
import type {
  PitstopResultCreate,
  PitstopResultResponse,
  PitstopSummary,
} from "@/lib/api-types";
import {
  scorePitstopTime,
  FASTEST_PITSTOP_BONUS,
} from "@/lib/simulation/scoring";

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

export async function GET() {
  return withRouteErrorHandler(async () => {
    const ctors = await db.select().from(constructors);
    const summaries: PitstopSummary[] = [];

    for (const c of ctors) {
      const stops = await db
        .select()
        .from(pitstopResults)
        .where(eq(pitstopResults.constructorId, c.id));

      if (stops.length === 0) {
        summaries.push({
          constructor_id: c.id,
          constructor_name: c.name,
          constructor_color: c.color ?? "#6b7280",
          avg_time: 4.0,
          best_time: 4.0,
          total_points: 0,
          num_stops: 0,
          fastest_count: 0,
        });
        continue;
      }

      const times = stops.map((s) => s.timeSeconds);
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      const best = Math.min(...times);
      const totalPts = stops.reduce((sum, s) => sum + (s.pointsScored ?? 0), 0);
      const fastestCount = stops.filter((s) => s.isFastest).length;

      summaries.push({
        constructor_id: c.id,
        constructor_name: c.name,
        constructor_color: c.color ?? "#6b7280",
        avg_time: round3(avg),
        best_time: round3(best),
        total_points: totalPts,
        num_stops: stops.length,
        fastest_count: fastestCount,
      });
    }

    summaries.sort((a, b) => a.avg_time - b.avg_time);
    return summaries;
  });
}

function isPitstopCreate(x: unknown): x is PitstopResultCreate {
  if (x === null || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.constructor_id === "number" &&
    typeof o.race_id === "number" &&
    typeof o.time_seconds === "number"
  );
}

export async function POST(request: NextRequest) {
  return withRouteErrorHandler(async (): Promise<PitstopResultResponse> => {
    const body = await parseJsonBody<PitstopResultCreate>(
      request,
      isPitstopCreate
    );
    const basePts = scorePitstopTime(body.time_seconds);
    const bonus = body.is_fastest ? FASTEST_PITSTOP_BONUS : 0;
    const totalPts = basePts + bonus;

    const inserted = await db
      .insert(pitstopResults)
      .values({
        constructorId: body.constructor_id,
        raceId: body.race_id,
        stopNumber: body.stop_number ?? 1,
        timeSeconds: body.time_seconds,
        isFastest: body.is_fastest ?? false,
        pointsScored: totalPts,
      })
      .returning();

    const row = inserted[0];
    const c = row.constructorId !== null
      ? await db
          .select()
          .from(constructors)
          .where(eq(constructors.id, row.constructorId))
          .limit(1)
      : [];
    const r = row.raceId !== null
      ? await db.select().from(races).where(eq(races.id, row.raceId)).limit(1)
      : [];

    return {
      id: row.id,
      constructor_id: row.constructorId ?? 0,
      constructor_name: c[0]?.name ?? "Unknown",
      constructor_color: c[0]?.color ?? "#6b7280",
      race_id: row.raceId ?? 0,
      race_name: r[0]?.name ?? "Unknown",
      stop_number: row.stopNumber ?? 1,
      time_seconds: row.timeSeconds,
      points_scored: row.pointsScored ?? 0,
      is_fastest: row.isFastest ?? false,
    };
  });
}
