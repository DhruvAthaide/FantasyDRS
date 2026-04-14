/**
 * GET /api/penalties/calendar — PenaltyCalendarEntry[] for at-risk drivers only.
 * Ported from backend/app/routers/penalties.py::get_penalty_calendar.
 */
import { asc, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  circuits,
  constructors,
  drivers,
  powerUnitAllocations,
  races,
} from "@/db/schema";
import { withRouteErrorHandler } from "@/lib/api-helpers";
import type { PenaltyCalendarEntry } from "@/lib/api-types";
import { COMPONENT_LIMITS, ensurePuInitialized } from "../_shared";

export async function GET() {
  return withRouteErrorHandler(async (): Promise<PenaltyCalendarEntry[]> => {
    await ensurePuInitialized();

    const allDrivers = await db.select().from(drivers);
    const allRaces = await db.select().from(races).orderBy(asc(races.round));

    const entries: PenaltyCalendarEntry[] = [];
    for (const d of allDrivers) {
      const allocs = await db
        .select()
        .from(powerUnitAllocations)
        .where(eq(powerUnitAllocations.driverId, d.id));
      const components: Record<string, number> = {};
      for (const comp of Object.keys(COMPONENT_LIMITS)) components[comp] = 0;
      for (const a of allocs) {
        if (a.componentType in components) {
          components[a.componentType] = Math.max(
            components[a.componentType],
            a.totalUsed ?? 0
          );
        }
      }
      const atRisk = Object.entries(COMPONENT_LIMITS).some(
        ([c, lim]) => (components[c] ?? 0) >= lim
      );
      if (!atRisk) continue;

      let color = "#6b7280";
      if (d.constructorId !== null) {
        const c = await db
          .select({ color: constructors.color })
          .from(constructors)
          .where(eq(constructors.id, d.constructorId))
          .limit(1);
        if (c.length > 0) color = c[0].color ?? "#6b7280";
      }

      for (const race of allRaces) {
        let otDiff = 0.5;
        if (race.circuitId !== null) {
          const circ = await db
            .select({ ot: circuits.overtakeDifficulty })
            .from(circuits)
            .where(eq(circuits.id, race.circuitId))
            .limit(1);
          if (circ.length > 0) otDiff = circ[0].ot ?? 0.5;
        }
        const penaltyCost = otDiff;
        entries.push({
          driver_id: d.id,
          driver_code: d.code,
          driver_color: color,
          race_id: race.id,
          race_name: race.name,
          race_round: race.round,
          penalty_cost: Math.round(penaltyCost * 1000) / 1000,
          recommended: penaltyCost < 0.35,
        });
      }
    }
    return entries;
  });
}
