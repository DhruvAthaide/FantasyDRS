/**
 * POST /api/penalties/reset — wipe + reseed PU allocations.
 * Ported from backend/app/routers/penalties.py::reset_pu_allocations.
 */
import { db } from "@/db";
import { powerUnitAllocations } from "@/db/schema";
import { withRouteErrorHandler } from "@/lib/api-helpers";
import { ensurePuInitialized } from "../_shared";

export async function POST() {
  return withRouteErrorHandler(async () => {
    await db.delete(powerUnitAllocations);
    await ensurePuInitialized();
    return { status: "ok" };
  });
}
