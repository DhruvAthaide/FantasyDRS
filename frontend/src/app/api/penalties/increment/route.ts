/**
 * POST /api/penalties/increment?driver_id=N&component_type=ICE
 * Python uses query params; we mirror.
 * Ported from backend/app/routers/penalties.py::increment_pu_component.
 */
import { and, desc, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/db";
import { powerUnitAllocations } from "@/db/schema";
import {
  queryParam,
  queryParamInt,
  withRouteErrorHandler,
} from "@/lib/api-helpers";
import { COMPONENT_LIMITS, ensurePuInitialized } from "../_shared";

export async function POST(request: NextRequest) {
  const driverId = queryParamInt(request, "driver_id");
  const componentType = queryParam(request, "component_type");

  if (driverId === null) {
    return NextResponse.json(
      { error: "Missing driver_id" },
      { status: 400 }
    );
  }
  if (!componentType || !(componentType in COMPONENT_LIMITS)) {
    return NextResponse.json(
      { error: `Invalid component type: ${componentType}` },
      { status: 400 }
    );
  }

  return withRouteErrorHandler(async () => {
    await ensurePuInitialized();

    const latest = await db
      .select({ total: powerUnitAllocations.totalUsed })
      .from(powerUnitAllocations)
      .where(
        and(
          eq(powerUnitAllocations.driverId, driverId),
          eq(powerUnitAllocations.componentType, componentType)
        )
      )
      .orderBy(desc(powerUnitAllocations.id))
      .limit(1);
    const currentTotal = latest[0]?.total ?? 0;
    const newTotal = currentTotal + 1;

    await db.insert(powerUnitAllocations).values({
      driverId,
      componentType,
      raceId: null,
      isNew: true,
      totalUsed: newTotal,
    });

    return { status: "ok", new_total: newTotal };
  });
}
