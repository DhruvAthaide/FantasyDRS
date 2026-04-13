/**
 * GET /api/races
 * Ported from backend/app/routers/races.py — returns all races ordered by round asc.
 */
import { asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { races, circuits } from "@/db/schema";
import { withRouteErrorHandler } from "@/lib/api-helpers";
import type { RaceResponse } from "@/lib/api-types";

export async function GET() {
  return withRouteErrorHandler(async () => {
    const rows = await db.select().from(races).orderBy(asc(races.round));

    const result: RaceResponse[] = [];
    for (const r of rows) {
      let circuitRow: typeof circuits.$inferSelect | null = null;
      if (r.circuitId !== null) {
        const c = await db
          .select()
          .from(circuits)
          .where(eq(circuits.id, r.circuitId))
          .limit(1);
        if (c.length > 0) circuitRow = c[0];
      }

      result.push({
        id: r.id,
        round: r.round,
        name: r.name,
        circuit_name: circuitRow?.name ?? "",
        country: circuitRow?.country ?? "",
        date: r.date ?? "",
        has_sprint: r.hasSprint ?? false,
        overtake_difficulty: circuitRow?.overtakeDifficulty ?? 0.5,
        laps: r.laps ?? 57,
        drs_zones: r.drsZones ?? 3,
      });
    }

    return result;
  });
}
