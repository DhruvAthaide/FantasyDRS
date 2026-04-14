/**
 * Shared helpers for /api/penalties/** routes.
 * Ported from backend/app/routers/penalties.py module-level state.
 */
import { db } from "@/db";
import { drivers, powerUnitAllocations } from "@/db/schema";

// 2026 regulations
export const COMPONENT_LIMITS: Record<string, number> = {
  ICE: 4,
  TC: 4,
  "MGU-K": 4,
  "MGU-H": 4,
  ES: 2,
  CE: 2,
  Gearbox: 4,
};

/**
 * Seed one allocation per (driver × component) with total_used=1 if the
 * table is empty. Mirrors _ensure_pu_initialized() in the Python backend.
 */
export async function ensurePuInitialized(): Promise<void> {
  const existing = await db
    .select({ id: powerUnitAllocations.id })
    .from(powerUnitAllocations)
    .limit(1);
  if (existing.length > 0) return;

  const allDrivers = await db.select({ id: drivers.id }).from(drivers);
  if (allDrivers.length === 0) return;

  const rows: Array<{
    driverId: number;
    componentType: string;
    raceId: number | null;
    isNew: boolean;
    totalUsed: number;
  }> = [];
  for (const d of allDrivers) {
    for (const comp of Object.keys(COMPONENT_LIMITS)) {
      rows.push({
        driverId: d.id,
        componentType: comp,
        raceId: null,
        isNew: true,
        totalUsed: 1,
      });
    }
  }
  await db.insert(powerUnitAllocations).values(rows);
}
