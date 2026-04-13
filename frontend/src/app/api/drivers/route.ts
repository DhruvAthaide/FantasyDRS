/**
 * GET /api/drivers[?race_id=N]
 * Ported from backend/app/routers/drivers.py::get_drivers.
 */
import { asc, desc, eq, and } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { db } from "@/db";
import {
  drivers,
  constructors,
  fantasyPrices,
  simulationResults,
} from "@/db/schema";
import { queryParamInt, withRouteErrorHandler } from "@/lib/api-helpers";
import type { DriverResponse } from "@/lib/api-types";

export async function GET(request: NextRequest) {
  return withRouteErrorHandler(async () => {
    const raceId = queryParamInt(request, "race_id");

    const allDrivers = await db.select().from(drivers).orderBy(asc(drivers.id));

    const result: DriverResponse[] = [];
    for (const d of allDrivers) {
      let ctorName = "";
      let ctorColor = "#888";
      if (d.constructorId !== null) {
        const c = await db
          .select({ name: constructors.name, color: constructors.color })
          .from(constructors)
          .where(eq(constructors.id, d.constructorId))
          .limit(1);
        if (c.length > 0) {
          ctorName = c[0].name;
          ctorColor = c[0].color ?? "#888";
        }
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
      const price = priceRow.length > 0 ? priceRow[0].price : 0;

      let expected_pts: number | null = null;
      if (raceId !== null) {
        const simRow = await db
          .select({ mean: simulationResults.expectedPtsMean })
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
        if (simRow.length > 0) expected_pts = simRow[0].mean;
      }

      result.push({
        id: d.id,
        code: d.code,
        first_name: d.firstName,
        last_name: d.lastName,
        number: d.number,
        constructor_id: d.constructorId ?? 0,
        constructor_name: ctorName,
        constructor_color: ctorColor,
        country: d.country,
        price,
        expected_pts,
      });
    }

    return result;
  });
}
