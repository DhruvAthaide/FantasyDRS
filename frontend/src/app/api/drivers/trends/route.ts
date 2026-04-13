/**
 * GET /api/drivers/trends
 * Ported from backend/app/routers/drivers.py::get_driver_trends.
 *
 * Form-trend heuristic (mirrors Python _form_trend):
 *   - Last 3 race results ordered by round desc
 *   - Skip DNFs / null race_position
 *   - If < 2 usable rows → "stable"
 *   - recent_avg = avg of the top 2 (most recent), older_avg = last
 *   - diff > 1.5 → improving, diff < -1.5 → declining, else stable
 */
import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { drivers, races, raceResults } from "@/db/schema";
import { withRouteErrorHandler } from "@/lib/api-helpers";
import type { FormTrend, FormTrendMap } from "@/lib/api-types";

async function formTrend(driverId: number): Promise<FormTrend> {
  // Join race_results with races, most recent 3 by round
  const rows = await db
    .select({
      dnf: raceResults.dnf,
      racePosition: raceResults.racePosition,
    })
    .from(raceResults)
    .innerJoin(races, eq(races.id, raceResults.raceId))
    .where(eq(raceResults.driverId, driverId))
    .orderBy(desc(races.round))
    .limit(3);

  if (rows.length < 2) return "stable";

  const positions: number[] = [];
  for (const r of rows) {
    if (r.dnf) continue;
    if (r.racePosition === null || r.racePosition === undefined) continue;
    positions.push(r.racePosition);
  }
  if (positions.length < 2) return "stable";

  const recent = positions.slice(0, 2);
  const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
  const olderAvg = positions[positions.length - 1];
  const diff = olderAvg - recentAvg;

  if (diff > 1.5) return "improving";
  if (diff < -1.5) return "declining";
  return "stable";
}

export async function GET() {
  return withRouteErrorHandler(async () => {
    const allDrivers = await db.select({ id: drivers.id }).from(drivers);
    const entries = await Promise.all(
      allDrivers.map(async (d) => [d.id, await formTrend(d.id)] as const)
    );
    const map: FormTrendMap = {};
    for (const [id, trend] of entries) map[id] = trend;
    return map;
  });
}
