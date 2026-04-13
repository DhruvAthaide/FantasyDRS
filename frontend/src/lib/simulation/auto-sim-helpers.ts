/**
 * Port of specific DB helpers from backend/app/services/auto_sim.py.
 *
 * Only the helpers consumed by Plan 04-02 routes are ported here:
 *   - buildResponse           (Python _build_response)
 *   - generateStrategyBrief   (Python generate_strategy_brief)
 *   - buildAssetListsForRace  (shared helper for best-teams + my-team/compare;
 *                              not a direct Python port — extracts the
 *                              per-route Asset construction boilerplate)
 *
 * Other helpers (_build_driver_params, _build_constructor_params,
 * _compute_history_adjustments, etc.) are deferred to Plan 04-03 where
 * simulate-batch needs them.
 */
import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  constructors,
  drivers,
  fantasyPrices,
  races,
  circuits,
  simulationResults,
} from "@/db/schema";
import type {
  SimulationResultResponse,
  StrategyBriefResponse,
} from "@/lib/api-types";
import type { Asset } from "@/lib/simulation/optimizer";

// ---------------------------------------------------------------------------
// Small helpers shared across both ports
// ---------------------------------------------------------------------------
const _PRICE_FALLBACK_MULTIPLIER = 1.0; // 1 pt per $1M (matches Python)

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

async function latestPrice(
  assetType: "driver" | "constructor",
  assetId: number
): Promise<number> {
  const row = await db
    .select({ price: fantasyPrices.price })
    .from(fantasyPrices)
    .where(
      and(
        eq(fantasyPrices.assetType, assetType),
        eq(fantasyPrices.assetId, assetId)
      )
    )
    .orderBy(desc(fantasyPrices.id))
    .limit(1);
  return row.length > 0 ? row[0].price : 0;
}

async function latestSimMean(
  assetType: "driver" | "constructor",
  assetId: number,
  raceId: number
): Promise<number | null> {
  const row = await db
    .select({ mean: simulationResults.expectedPtsMean })
    .from(simulationResults)
    .where(
      and(
        eq(simulationResults.assetType, assetType),
        eq(simulationResults.assetId, assetId),
        eq(simulationResults.raceId, raceId)
      )
    )
    .orderBy(desc(simulationResults.id))
    .limit(1);
  return row.length > 0 ? (row[0].mean ?? null) : null;
}

// ---------------------------------------------------------------------------
// buildResponse — mirror of Python _build_response(db, race_id)
// ---------------------------------------------------------------------------
export async function buildResponse(
  raceId: number
): Promise<SimulationResultResponse[]> {
  const rows = await db
    .select()
    .from(simulationResults)
    .where(eq(simulationResults.raceId, raceId));

  const out: SimulationResultResponse[] = [];
  for (const r of rows) {
    let name = "Unknown";
    if (r.assetType === "driver") {
      const d = await db
        .select({ first: drivers.firstName, last: drivers.lastName })
        .from(drivers)
        .where(eq(drivers.id, r.assetId))
        .limit(1);
      if (d.length > 0) name = `${d[0].first} ${d[0].last}`;
    } else {
      const c = await db
        .select({ name: constructors.name })
        .from(constructors)
        .where(eq(constructors.id, r.assetId))
        .limit(1);
      if (c.length > 0) name = c[0].name;
    }

    const price = await latestPrice(
      r.assetType as "driver" | "constructor",
      r.assetId
    );
    const mean = r.expectedPtsMean ?? 0;
    const ppm = price > 0 ? round3(mean / price) : 0;

    out.push({
      asset_type: r.assetType as "driver" | "constructor",
      asset_id: r.assetId,
      asset_name: name,
      price,
      expected_pts_mean: mean,
      expected_pts_median: r.expectedPtsMedian ?? 0,
      expected_pts_std: r.expectedPtsStd ?? 0,
      expected_pts_p10: r.expectedPtsP10 ?? 0,
      expected_pts_p90: r.expectedPtsP90 ?? 0,
      points_per_million: ppm,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// generateStrategyBrief — mirror of Python generate_strategy_brief
// ---------------------------------------------------------------------------
export async function generateStrategyBrief(
  raceId: number
): Promise<StrategyBriefResponse | null> {
  const raceRow = await db
    .select()
    .from(races)
    .where(eq(races.id, raceId))
    .limit(1);
  if (raceRow.length === 0) return null;
  const race = raceRow[0];

  if (race.circuitId === null) return null;
  const circuitRow = await db
    .select()
    .from(circuits)
    .where(eq(circuits.id, race.circuitId))
    .limit(1);
  if (circuitRow.length === 0) return null;
  const circuit = circuitRow[0];

  const simRows = await db
    .select()
    .from(simulationResults)
    .where(eq(simulationResults.raceId, raceId));
  if (simRows.length === 0) return null;

  const driverSims = simRows
    .filter((s) => s.assetType === "driver")
    .sort(
      (a, b) => (b.expectedPtsMean ?? 0) - (a.expectedPtsMean ?? 0)
    );

  if (driverSims.length === 0) return null;

  // Top pick
  const top = driverSims[0];
  const topDriverRow = await db
    .select()
    .from(drivers)
    .where(eq(drivers.id, top.assetId))
    .limit(1);
  const topDriver = topDriverRow[0] ?? null;
  let topConstructor: typeof constructors.$inferSelect | null = null;
  if (topDriver?.constructorId !== null && topDriver?.constructorId !== undefined) {
    const c = await db
      .select()
      .from(constructors)
      .where(eq(constructors.id, topDriver.constructorId))
      .limit(1);
    if (c.length > 0) topConstructor = c[0];
  }

  const traits: string[] = [];
  if (circuit.highSpeed !== null && (circuit.highSpeed ?? 0) > 0.7) {
    traits.push("high-speed circuit");
  }
  if (circuit.streetCircuit) traits.push("street circuit");
  if (circuit.avgDegradation !== null && (circuit.avgDegradation ?? 0) > 0.5) {
    traits.push("high tire degradation");
  }
  if (circuit.overtakeDifficulty !== null) {
    if ((circuit.overtakeDifficulty ?? 0) > 0.7) traits.push("limited overtaking");
    else if ((circuit.overtakeDifficulty ?? 0) < 0.3)
      traits.push("strong overtaking opportunities");
  }

  const circuitDesc =
    traits.length > 0 ? traits.join(", ") : "balanced circuit characteristics";
  const capitalizedDesc =
    circuitDesc.charAt(0).toUpperCase() + circuitDesc.slice(1);

  const topMean = top.expectedPtsMean ?? 0;
  const topCode = topDriver?.code ?? "Unknown";
  const topTeamName = topConstructor?.name ?? "their team";
  const topPickText =
    `${topCode} leads predictions with ` +
    `${topMean.toFixed(1)} xPts. ` +
    `${capitalizedDesc} at ${circuit.name} ` +
    `suits ${topTeamName}'s package.`;

  // Value pick (best PPM)
  const valuePicks: Array<{
    code: string;
    ppm: number;
    xpts: number;
    price: number;
  }> = [];
  for (const s of driverSims) {
    const price = await latestPrice("driver", s.assetId);
    const xpts = s.expectedPtsMean ?? 0;
    const ppm = price > 0 ? xpts / price : 0;
    const d = await db
      .select({ code: drivers.code })
      .from(drivers)
      .where(eq(drivers.id, s.assetId))
      .limit(1);
    valuePicks.push({
      code: d[0]?.code ?? "?",
      ppm,
      xpts,
      price,
    });
  }
  valuePicks.sort((a, b) => b.ppm - a.ppm);
  const bestValue = valuePicks[0] ?? null;
  const valueText = bestValue
    ? `${bestValue.code} offers the best value at ` +
      `${bestValue.ppm.toFixed(2)} PPM (${bestValue.xpts.toFixed(1)} xPts for ` +
      `$${bestValue.price.toFixed(1)}M).`
    : "";

  // Danger zone (highest volatility)
  const volatile = [...driverSims].sort(
    (a, b) => (b.expectedPtsStd ?? 0) - (a.expectedPtsStd ?? 0)
  );
  const danger = volatile[0] ?? null;
  let dangerText = "";
  if (danger) {
    const dd = await db
      .select({ code: drivers.code })
      .from(drivers)
      .where(eq(drivers.id, danger.assetId))
      .limit(1);
    const dangerCode = dd[0]?.code;
    if (dangerCode) {
      const p10 = danger.expectedPtsP10 ?? 0;
      const p90 = danger.expectedPtsP90 ?? 0;
      const spread = p90 - p10;
      dangerText =
        `${dangerCode} has the widest range: ` +
        `${p10.toFixed(1)} to ${p90.toFixed(1)} xPts ` +
        `(spread of ${spread.toFixed(1)}). High risk, high reward.`;
    }
  }

  // DRS recommendation
  let drsText =
    `${topCode} is the safest DRS pick ` +
    `with ${topMean.toFixed(1)} base xPts (2x = ${(topMean * 2).toFixed(1)}). `;

  const p90Sorted = [...driverSims].sort(
    (a, b) => (b.expectedPtsP90 ?? 0) - (a.expectedPtsP90 ?? 0)
  );
  if (p90Sorted.length > 0 && p90Sorted[0].assetId !== top.assetId) {
    const upside = p90Sorted[0];
    const ud = await db
      .select({ code: drivers.code })
      .from(drivers)
      .where(eq(drivers.id, upside.assetId))
      .limit(1);
    if (ud.length > 0) {
      const p90v = upside.expectedPtsP90 ?? 0;
      drsText +=
        `For upside, consider ${ud[0].code} ` +
        `(P90 ceiling of ${p90v.toFixed(1)} × 2 = ${(p90v * 2).toFixed(1)}).`;
    }
  }

  // Latest simulated_at
  const latestSim = [...simRows].sort((a, b) => {
    const at = a.simulatedAt ? a.simulatedAt.getTime() : 0;
    const bt = b.simulatedAt ? b.simulatedAt.getTime() : 0;
    return bt - at;
  })[0];
  const simulatedAt = latestSim?.simulatedAt
    ? latestSim.simulatedAt.toISOString()
    : "unknown";

  return {
    race_name: race.name,
    circuit_name: circuit.name,
    top_pick: topPickText,
    value_play: valueText,
    danger_zone: dangerText,
    drs_call: drsText,
    circuit_traits: traits,
    simulated_at: simulatedAt,
  };
}

// ---------------------------------------------------------------------------
// buildAssetListsForRace — shared by /api/best-teams and /api/my-team/compare
// ---------------------------------------------------------------------------
export async function buildAssetListsForRace(
  raceId: number | null
): Promise<{ drivers: Asset[]; constructors: Asset[] }> {
  const allDrivers = await db.select().from(drivers);
  const allCtors = await db.select().from(constructors);

  const driverAssets: Asset[] = [];
  for (const d of allDrivers) {
    const price = await latestPrice("driver", d.id);
    const simMean =
      raceId !== null ? await latestSimMean("driver", d.id, raceId) : null;
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
    driverAssets.push({
      id: d.id,
      code: d.code,
      price,
      expected_pts: simMean !== null ? simMean : price * _PRICE_FALLBACK_MULTIPLIER,
      asset_type: "driver",
      constructor_name: ctorName,
      constructor_color: ctorColor,
    });
  }

  const constructorAssets: Asset[] = [];
  for (const c of allCtors) {
    const price = await latestPrice("constructor", c.id);
    const simMean =
      raceId !== null ? await latestSimMean("constructor", c.id, raceId) : null;
    constructorAssets.push({
      id: c.id,
      code: c.refId,
      price,
      expected_pts: simMean !== null ? simMean : price * _PRICE_FALLBACK_MULTIPLIER,
      asset_type: "constructor",
      constructor_name: c.name,
      constructor_color: c.color ?? "",
    });
  }

  return { drivers: driverAssets, constructors: constructorAssets };
}

export { round2 };
