/**
 * GET /api/constructors[?race_id=N]
 * Ported from backend/app/routers/constructors.py
 */
import { desc, eq, and } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { db } from "@/db";
import {
  constructors,
  drivers,
  fantasyPrices,
  simulationResults,
} from "@/db/schema";
import { queryParamInt, withRouteErrorHandler } from "@/lib/api-helpers";
import type { ConstructorResponse } from "@/lib/api-types";

export async function GET(request: NextRequest) {
  return withRouteErrorHandler(async () => {
    const raceId = queryParamInt(request, "race_id");

    const ctors = await db.select().from(constructors);

    const result: ConstructorResponse[] = [];
    for (const c of ctors) {
      // Driver codes for this constructor (insertion/id order)
      const dRows = await db
        .select({ code: drivers.code })
        .from(drivers)
        .where(eq(drivers.constructorId, c.id));
      const driver_codes = dRows.map((d) => d.code);

      // Latest price row
      const priceRow = await db
        .select({ price: fantasyPrices.price })
        .from(fantasyPrices)
        .where(
          and(
            eq(fantasyPrices.assetType, "constructor"),
            eq(fantasyPrices.assetId, c.id)
          )
        )
        .orderBy(desc(fantasyPrices.id))
        .limit(1);
      const price = priceRow.length > 0 ? priceRow[0].price : 0;

      // Latest simulation result for this race, if race_id provided
      let expected_pts: number | null = null;
      if (raceId !== null) {
        const simRow = await db
          .select({ mean: simulationResults.expectedPtsMean })
          .from(simulationResults)
          .where(
            and(
              eq(simulationResults.assetType, "constructor"),
              eq(simulationResults.assetId, c.id),
              eq(simulationResults.raceId, raceId)
            )
          )
          .orderBy(desc(simulationResults.id))
          .limit(1);
        if (simRow.length > 0) expected_pts = simRow[0].mean;
      }

      result.push({
        id: c.id,
        ref_id: c.refId,
        name: c.name,
        color: c.color ?? "",
        price,
        driver_codes,
        expected_pts,
      });
    }

    return result;
  });
}
