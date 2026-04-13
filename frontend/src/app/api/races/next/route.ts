/**
 * GET /api/races/next
 * Ported from backend/app/routers/races.py::get_next_race.
 *
 * Logic (mirrors Python exactly):
 *   1. Query races where date >= today, ordered by date asc.
 *   2. For each candidate, if date === today AND current UTC hour >= 18, skip.
 *   3. First non-skipped match → respond.
 *   4. Fallback: last race by round desc; null if its date is already past.
 */
import { asc, desc, eq, gte } from "drizzle-orm";

import { db } from "@/db";
import { races, circuits } from "@/db/schema";
import { withRouteErrorHandler } from "@/lib/api-helpers";
import type { RaceResponse } from "@/lib/api-types";

async function circuitOf(circuitId: number | null) {
  if (circuitId === null) return null;
  const c = await db
    .select()
    .from(circuits)
    .where(eq(circuits.id, circuitId))
    .limit(1);
  return c.length > 0 ? c[0] : null;
}

function raceToResponse(
  r: typeof races.$inferSelect,
  c: typeof circuits.$inferSelect | null
): RaceResponse {
  return {
    id: r.id,
    round: r.round,
    name: r.name,
    circuit_name: c?.name ?? "",
    country: c?.country ?? "",
    date: r.date ?? "",
    has_sprint: r.hasSprint ?? false,
    overtake_difficulty: c?.overtakeDifficulty ?? 0.5,
    laps: r.laps ?? 57,
    drs_zones: r.drsZones ?? 3,
  };
}

export async function GET() {
  return withRouteErrorHandler(async (): Promise<RaceResponse | null> => {
    const nowUtc = new Date();
    const todayStr = nowUtc.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)

    // Candidates: date >= today, ordered by date asc
    const candidates = await db
      .select()
      .from(races)
      .where(gte(races.date, todayStr))
      .orderBy(asc(races.date));

    for (const race of candidates) {
      // Today's race is "done" once past 18:00 UTC
      if (race.date === todayStr && nowUtc.getUTCHours() >= 18) continue;
      return raceToResponse(race, await circuitOf(race.circuitId));
    }

    // Fallback: last race of the season (only if its date hasn't passed)
    const last = await db
      .select()
      .from(races)
      .orderBy(desc(races.round))
      .limit(1);
    if (last.length === 0) return null;
    const race = last[0];
    if (race.date && race.date < todayStr) return null;
    return raceToResponse(race, await circuitOf(race.circuitId));
  });
}
