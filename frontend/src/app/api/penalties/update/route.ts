/**
 * POST /api/penalties/update — record a new power unit allocation row.
 * Ported from backend/app/routers/penalties.py::update_pu_allocation.
 */
import type { NextRequest } from "next/server";

import { db } from "@/db";
import { powerUnitAllocations } from "@/db/schema";
import {
  parseJsonBody,
  withRouteErrorHandler,
} from "@/lib/api-helpers";
import type { PowerUnitUpdateRequest } from "@/lib/api-types";

function isUpdateRequest(x: unknown): x is PowerUnitUpdateRequest {
  if (x === null || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.driver_id === "number" &&
    typeof o.component_type === "string" &&
    typeof o.race_id === "number" &&
    typeof o.total_used === "number"
  );
}

export async function POST(request: NextRequest) {
  return withRouteErrorHandler(async () => {
    const body = await parseJsonBody<PowerUnitUpdateRequest>(
      request,
      isUpdateRequest
    );
    await db.insert(powerUnitAllocations).values({
      driverId: body.driver_id,
      componentType: body.component_type,
      raceId: body.race_id,
      isNew: true,
      totalUsed: body.total_used,
    });
    return { status: "ok" };
  });
}
