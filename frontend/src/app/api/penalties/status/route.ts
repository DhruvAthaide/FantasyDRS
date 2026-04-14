/**
 * GET /api/penalties/status — PowerUnitStatus[] per driver.
 * Ported from backend/app/routers/penalties.py::get_pu_status.
 */
import { asc, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  constructors,
  drivers,
  powerUnitAllocations,
} from "@/db/schema";
import { withRouteErrorHandler } from "@/lib/api-helpers";
import type { PowerUnitStatus } from "@/lib/api-types";
import {
  COMPONENT_LIMITS,
  ensurePuInitialized,
} from "../_shared";

export async function GET() {
  return withRouteErrorHandler(async (): Promise<PowerUnitStatus[]> => {
    await ensurePuInitialized();

    const allDrivers = await db.select().from(drivers).orderBy(asc(drivers.id));
    const statuses: PowerUnitStatus[] = [];

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
        ([comp, lim]) => (components[comp] ?? 0) >= lim
      );
      let color = "#6b7280";
      if (d.constructorId !== null) {
        const c = await db
          .select({ color: constructors.color })
          .from(constructors)
          .where(eq(constructors.id, d.constructorId))
          .limit(1);
        if (c.length > 0) color = c[0].color ?? "#6b7280";
      }
      statuses.push({
        driver_id: d.id,
        driver_code: d.code,
        driver_color: color,
        components,
        at_risk: atRisk,
      });
    }
    return statuses;
  });
}
