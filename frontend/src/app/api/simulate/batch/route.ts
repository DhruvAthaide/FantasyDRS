/**
 * POST /api/simulate/batch
 * Ported from backend/app/routers/simulation.py::batch_simulate.
 *
 * Iterates every race, runs Phase 3's simulateRaceWeekend on those without
 * existing simulation_results (or all of them if force=true), and persists
 * the results. Used by the UI to populate the full-season prediction grid.
 *
 * Perf (Plan 06-02): uses an early-return-resumable protocol. Server tracks a
 * soft budget (45s, leaving 15s headroom under Vercel Pro's 60s cap), stops
 * cleanly between races when the budget is about to blow, and returns what
 * remains. Callers simply re-POST with the same body until `remaining_count=0`.
 */
import { asc, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { db } from "@/db";
import { circuits, races, simulationResults } from "@/db/schema";
import {
  parseJsonBody,
  withRouteErrorHandler,
} from "@/lib/api-helpers";
import {
  simulateRaceWeekend,
  type CircuitTraits,
} from "@/lib/simulation/engine";
import {
  buildConstructorParams,
  buildDriverParams,
  computeHistoryAdjustments,
} from "@/lib/simulation/auto-sim-helpers";

interface BatchRequest {
  n_simulations?: number;
  force?: boolean;
}

function isBatchRequest(x: unknown): x is BatchRequest {
  if (x === null || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (o.n_simulations !== undefined && typeof o.n_simulations !== "number")
    return false;
  if (o.force !== undefined && typeof o.force !== "boolean") return false;
  return true;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

// Soft budget: stop starting new races if elapsed wall-clock exceeds this.
// Vercel Pro cap is 60s; 45s leaves enough headroom for a final race in flight.
const SOFT_BUDGET_MS = 45_000;

export async function POST(request: NextRequest) {
  return withRouteErrorHandler(async () => {
    const body = await parseJsonBody<BatchRequest>(request, isBatchRequest);
    const requestedSim = body.n_simulations ?? 10000;
    const nSim = Math.max(1000, Math.min(10000, requestedSim));
    const force = body.force ?? false;

    const START = Date.now();
    const allRaces = await db.select().from(races).orderBy(asc(races.round));
    const simulated: string[] = [];
    const skipped: string[] = [];
    const remaining: string[] = [];
    let budgetExceeded = false;

    for (const race of allRaces) {
      if (budgetExceeded) {
        remaining.push(race.name);
        continue;
      }
      // Check budget before starting new race; a simulation can take several
      // seconds at n=10000, so we gate at the boundary rather than mid-race.
      if (Date.now() - START > SOFT_BUDGET_MS) {
        budgetExceeded = true;
        remaining.push(race.name);
        continue;
      }

      const existing = await db
        .select({ id: simulationResults.id })
        .from(simulationResults)
        .where(eq(simulationResults.raceId, race.id))
        .limit(1);
      if (existing.length > 0 && !force) {
        skipped.push(race.name);
        continue;
      }

      let circuit: typeof circuits.$inferSelect | null = null;
      if (race.circuitId !== null) {
        const c = await db
          .select()
          .from(circuits)
          .where(eq(circuits.id, race.circuitId))
          .limit(1);
        if (c.length > 0) circuit = c[0];
      }
      const traits: CircuitTraits = {
        overtake_difficulty: circuit?.overtakeDifficulty ?? 0.5,
        high_speed: circuit?.highSpeed ?? 0.5,
        street_circuit: circuit?.streetCircuit ?? false,
        altitude: circuit?.altitude ?? 0,
        avg_degradation: circuit?.avgDegradation ?? 0.5,
      };

      try {
        const history = await computeHistoryAdjustments(
          { id: race.id, round: race.round, date: race.date },
          circuit
        );
        const driverParams = await buildDriverParams({
          historyAdjustments: history,
        });
        const constructorParams = await buildConstructorParams(driverParams);

        const results = simulateRaceWeekend({
          drivers: driverParams,
          constructors: constructorParams,
          circuit: traits,
          isSprint: race.hasSprint ?? false,
          nSimulations: nSim,
          seed: Date.now(),
        });

        if (force && existing.length > 0) {
          await db
            .delete(simulationResults)
            .where(eq(simulationResults.raceId, race.id));
        }

        const now = new Date();
        const rows = results.map((r) => ({
          raceId: race.id,
          assetType: r.asset_type,
          assetId: r.asset_id,
          expectedPtsMean: round2(r.mean),
          expectedPtsMedian: round2(r.median),
          expectedPtsStd: round2(r.std),
          expectedPtsP10: round2(r.p10),
          expectedPtsP90: round2(r.p90),
          simulatedAt: now,
        }));
        await db.insert(simulationResults).values(rows);
        simulated.push(race.name);
      } catch (err: unknown) {
        console.warn(
          `[simulate/batch] Failed to save results for ${race.name}:`,
          err instanceof Error ? err.message : err
        );
        skipped.push(race.name);
      }
    }

    return {
      simulated_count: simulated.length,
      skipped_count: skipped.length,
      simulated_races: simulated,
      remaining_count: remaining.length,
      remaining_races: remaining,
      elapsed_ms: Date.now() - START,
    };
  });
}
