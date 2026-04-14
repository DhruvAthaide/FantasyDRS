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
import { and, desc, eq, inArray, lt, like, isNotNull, asc } from "drizzle-orm";

import { db } from "@/db";
import {
  constructors,
  drivers,
  fantasyPrices,
  races,
  circuits,
  simulationResults,
  raceResults,
} from "@/db/schema";
import type {
  SimulationResultResponse,
  StrategyBriefResponse,
} from "@/lib/api-types";
import type { Asset } from "@/lib/simulation/optimizer";
import type {
  DriverParams,
  ConstructorParams,
} from "@/lib/simulation/engine";
import {
  DRIVER_DEFAULTS,
  CONSTRUCTOR_PITSTOP_DEFAULTS,
  CONSTRUCTOR_CAR_PACE_STD,
} from "@/lib/simulation/parameters";

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

// ═══════════════════════════════════════════════════════════════════════════
// PLAN 04-03: additional auto_sim.py / parameters.py DB-helper ports
// Needed by /api/simulate/batch.
// ═══════════════════════════════════════════════════════════════════════════

type CircuitRow = typeof circuits.$inferSelect;

export interface HistoryAdjustment {
  qpace_mean: number;
  qpace_std: number;
  dnf_pct: number;
  fl_pct: number;
  avg_pos_gained: number;
  form_trend: number;
  total_races: number;
}

// ---------------------------------------------------------------------------
// circuitSimilarity — port of _circuit_similarity(c1, c2)
// ---------------------------------------------------------------------------
export function circuitSimilarity(c1: CircuitRow, c2: CircuitRow): number {
  const traits1 = [
    c1.overtakeDifficulty ?? 0.5,
    c1.highSpeed ?? 0.5,
    Number(c1.streetCircuit ?? false),
    c1.avgDegradation ?? 0.5,
  ];
  const traits2 = [
    c2.overtakeDifficulty ?? 0.5,
    c2.highSpeed ?? 0.5,
    Number(c2.streetCircuit ?? false),
    c2.avgDegradation ?? 0.5,
  ];
  let sqSum = 0;
  for (let i = 0; i < traits1.length; i++) {
    const d = traits1[i] - traits2[i];
    sqSum += d * d;
  }
  const dist = Math.sqrt(sqSum);
  // Similarity ranges from ~0.5 (very different) to 1.5 (identical)
  return 1.5 - dist / 2.0;
}

// ---------------------------------------------------------------------------
// getDynamicCarPaceStd — port of parameters.py get_dynamic_car_pace_std
// ---------------------------------------------------------------------------
/** Sample standard deviation (Bessel-corrected, ddof=1) — matches Python statistics.stdev. */
function sampleStdev(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  let sq = 0;
  for (const v of values) {
    const d = v - mean;
    sq += d * d;
  }
  return Math.sqrt(sq / (n - 1));
}

export async function getDynamicCarPaceStd(): Promise<Record<string, number>> {
  const result: Record<string, number> = { ...CONSTRUCTOR_CAR_PACE_STD };

  const ctors = await db.select().from(constructors);
  for (const c of ctors) {
    const teamDrivers = await db
      .select({ id: drivers.id })
      .from(drivers)
      .where(eq(drivers.constructorId, c.id));
    const driverIds = teamDrivers.map((d) => d.id);
    if (driverIds.length === 0) continue;

    const positions = await db
      .select({ qp: raceResults.qualifyingPosition })
      .from(raceResults)
      .where(inArray(raceResults.driverId, driverIds));

    const valid = positions
      .map((r) => r.qp)
      .filter((p): p is number => p !== null && p !== undefined);

    if (valid.length >= 4) {
      const std = sampleStdev(valid);
      const clamped = Math.max(0.5, Math.min(4.0, std));
      result[c.refId] = Math.round(clamped * 100) / 100;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// computeHistoryAdjustments — port of _compute_history_adjustments
// ---------------------------------------------------------------------------
interface RaceForHistory {
  id: number;
  round: number;
  date: string | null;
}

const DECAY_FACTOR = 0.85;

function round2dp(x: number): number {
  return Math.round(x * 100) / 100;
}
function round4dp(x: number): number {
  return Math.round(x * 10000) / 10000;
}

export async function computeHistoryAdjustments(
  race: RaceForHistory,
  targetCircuit: CircuitRow | null
): Promise<Record<number, HistoryAdjustment>> {
  if (race.round <= 1) return {};

  const year =
    race.date && race.date.length >= 4 ? race.date.slice(0, 4) : "2026";

  const priorRaces = await db
    .select()
    .from(races)
    .where(
      and(
        lt(races.round, race.round),
        isNotNull(races.date),
        like(races.date, `${year}%`)
      )
    );
  if (priorRaces.length === 0) return {};

  const raceRoundMap = new Map<number, number>();
  for (const r of priorRaces) raceRoundMap.set(r.id, r.round);

  // Per-race circuit similarity
  const raceSimilarity = new Map<number, number>();
  if (targetCircuit) {
    for (const r of priorRaces) {
      if (r.circuitId === null) {
        raceSimilarity.set(r.id, 1.0);
        continue;
      }
      const pc = await db
        .select()
        .from(circuits)
        .where(eq(circuits.id, r.circuitId))
        .limit(1);
      if (pc.length > 0) {
        raceSimilarity.set(r.id, circuitSimilarity(targetCircuit, pc[0]));
      } else {
        raceSimilarity.set(r.id, 1.0);
      }
    }
  }

  const priorRaceIds = priorRaces.map((r) => r.id);
  const priorResults = await db
    .select()
    .from(raceResults)
    .where(inArray(raceResults.raceId, priorRaceIds));
  if (priorResults.length === 0) return {};

  interface DriverStats {
    weighted_quali: number;
    weighted_race: number;
    weighted_pos_gained: number;
    total_weight: number;
    race_finish_weight: number;
    dnf_weighted: number;
    fl_weighted: number;
    total_races: number;
    recent_positions: Array<[number, number | null]>;
  }

  const driverStats = new Map<number, DriverStats>();
  const emptyStats = (): DriverStats => ({
    weighted_quali: 0,
    weighted_race: 0,
    weighted_pos_gained: 0,
    total_weight: 0,
    race_finish_weight: 0,
    dnf_weighted: 0,
    fl_weighted: 0,
    total_races: 0,
    recent_positions: [],
  });

  for (const r of priorResults) {
    if (r.driverId === null) continue;
    const prRound = raceRoundMap.get(r.raceId ?? -1);
    if (prRound === undefined) continue;
    const roundsAgo = race.round - prRound;
    let weight = Math.pow(DECAY_FACTOR, roundsAgo);
    if (raceSimilarity.has(r.raceId ?? -1)) {
      weight *= raceSimilarity.get(r.raceId!)!;
    }

    let s = driverStats.get(r.driverId);
    if (!s) {
      s = emptyStats();
      driverStats.set(r.driverId, s);
    }
    s.total_races += 1;
    s.total_weight += weight;
    s.weighted_quali += (r.qualifyingPosition ?? 22) * weight;

    if (r.dnf) {
      s.dnf_weighted += weight;
      s.recent_positions.push([roundsAgo, null]);
    } else {
      s.weighted_race += (r.racePosition ?? 22) * weight;
      s.race_finish_weight += weight;
      s.weighted_pos_gained +=
        ((r.qualifyingPosition ?? 22) - (r.racePosition ?? 22)) * weight;
      s.recent_positions.push([roundsAgo, r.racePosition ?? 22]);
    }

    if (r.fastestLap) s.fl_weighted += weight;
  }

  const adjustments: Record<number, HistoryAdjustment> = {};
  const priorWeight = 1.5;
  const baseFl = 1 / 22;

  for (const [driverId, s] of driverStats) {
    const tw = s.total_weight;
    const avgQuali = tw > 0 ? s.weighted_quali / tw : 11.5;
    const rfw = s.race_finish_weight;
    const avgRace = rfw > 0 ? s.weighted_race / rfw : avgQuali;
    const paceEstimate = avgQuali * 0.4 + avgRace * 0.6;

    const effectiveN = tw;
    const qpaceStd = Math.max(1.5, 4.0 / (1 + effectiveN * 0.3));

    const dnfPct =
      (s.dnf_weighted + priorWeight * 0.06) / (tw + priorWeight);
    const flPct =
      (s.fl_weighted + priorWeight * baseFl) / (tw + priorWeight);

    const rawPg = rfw > 0 ? s.weighted_pos_gained / rfw : 0;
    const avgPosGained = Math.max(-5, Math.min(5, rawPg));

    // Form trend
    let formTrend = 0;
    const finished = s.recent_positions.filter(
      (x): x is [number, number] => x[1] !== null
    );
    if (finished.length >= 3) {
      finished.sort((a, b) => a[0] - b[0]); // most recent first
      const mid = Math.floor(finished.length / 2);
      const recentAvg =
        finished.slice(0, mid).reduce((a, b) => a + b[1], 0) / mid;
      const olderAvg =
        finished.slice(mid).reduce((a, b) => a + b[1], 0) /
        (finished.length - mid);
      formTrend = olderAvg - recentAvg;
    }

    const formAdjustment = formTrend * 0.3;
    let adjustedQpace = paceEstimate - formAdjustment;
    adjustedQpace = Math.max(1, Math.min(22, adjustedQpace));

    adjustments[driverId] = {
      qpace_mean: round2dp(adjustedQpace),
      qpace_std: round2dp(qpaceStd),
      dnf_pct: round4dp(dnfPct),
      fl_pct: round4dp(flPct),
      avg_pos_gained: round2dp(avgPosGained),
      form_trend: round2dp(formTrend),
      total_races: s.total_races,
    };
  }

  // Sanity check: if nearly all drivers have the same qpace_mean, discard
  const ids = Object.keys(adjustments);
  if (ids.length >= 10) {
    const qpaces = ids.map((k) => adjustments[Number(k)].qpace_mean);
    const spread = Math.max(...qpaces) - Math.min(...qpaces);
    if (spread < 2.0) {
      console.warn(
        `[auto-sim-helpers] History qpace spread is only ${spread.toFixed(1)} — discarding`
      );
      return {};
    }
  }

  return adjustments;
}

// ---------------------------------------------------------------------------
// buildDriverParams — port of _build_driver_params (history + defaults only;
// batch mode doesn't use practice data, so the dynamic_params branch is
// omitted here. A future plan can extend this for live-simulate routes.)
// ---------------------------------------------------------------------------
export interface BuildDriverParamsOpts {
  gridPenalties?: Record<number, number>;
  historyAdjustments?: Record<number, HistoryAdjustment> | null;
}

interface DriverDefault {
  qpace_mean: number;
  qpace_std: number;
  dnf_pct: number;
  fl_pct: number;
  avg_pos_gained: number;
}

const FALLBACK_DEFAULT: DriverDefault = {
  qpace_mean: 12.0,
  qpace_std: 2.5,
  dnf_pct: 0.06,
  fl_pct: 0.02,
  avg_pos_gained: 0.1,
};

export async function buildDriverParams(
  opts: BuildDriverParamsOpts = {}
): Promise<DriverParams[]> {
  const allDrivers = await db.select().from(drivers);
  const history = opts.historyAdjustments ?? null;
  const penalties = opts.gridPenalties ?? {};

  // Pre-load constructor ref_ids for FK resolution
  const ctorRefById = new Map<number, string>();
  const allCtors = await db.select().from(constructors);
  for (const c of allCtors) ctorRefById.set(c.id, c.refId);

  const params: DriverParams[] = [];
  for (const d of allDrivers) {
    const penalty = penalties[d.id] ?? 0;
    const constructorRef =
      d.constructorId !== null ? ctorRefById.get(d.constructorId) ?? "" : "";
    const defaults = (DRIVER_DEFAULTS[d.code] ?? FALLBACK_DEFAULT) as DriverDefault;

    if (history && history[d.id]) {
      const hist = history[d.id];
      const nRaces = hist.total_races;
      const histWeight = Math.min(0.8, 0.2 + nRaces * 0.12);
      const defWeight = 1 - histWeight;

      let blendedQpace =
        defaults.qpace_mean * defWeight + hist.qpace_mean * histWeight;
      blendedQpace = Math.max(1, Math.min(20, blendedQpace));

      const blendedStd =
        defaults.qpace_std * defWeight + hist.qpace_std * histWeight;
      const blendedDnf =
        defaults.dnf_pct * defWeight + hist.dnf_pct * histWeight;
      const blendedFl =
        defaults.fl_pct * defWeight + hist.fl_pct * histWeight;

      // avg_pos_gained uses half-weight blend (noisier signal)
      const pgHistW = histWeight * 0.5;
      const blendedPg =
        defaults.avg_pos_gained * (1 - pgHistW) +
        hist.avg_pos_gained * pgHistW;

      params.push({
        id: d.id,
        code: d.code,
        constructor_ref: constructorRef,
        qpace_mean: blendedQpace,
        qpace_std: blendedStd,
        dnf_probability: blendedDnf,
        fl_probability: blendedFl,
        avg_positions_gained: blendedPg,
        grid_penalty: penalty,
      });
    } else {
      params.push({
        id: d.id,
        code: d.code,
        constructor_ref: constructorRef,
        qpace_mean: defaults.qpace_mean,
        qpace_std: defaults.qpace_std,
        dnf_probability: defaults.dnf_pct,
        fl_probability: defaults.fl_pct,
        avg_positions_gained: defaults.avg_pos_gained,
        grid_penalty: penalty,
      });
    }
  }

  return params;
}

// ---------------------------------------------------------------------------
// buildConstructorParams — port of _build_constructor_params
// ---------------------------------------------------------------------------
export async function buildConstructorParams(
  driverParams: DriverParams[]
): Promise<ConstructorParams[]> {
  const driverIdsByRef = new Map<string, number[]>();
  for (const dp of driverParams) {
    const arr = driverIdsByRef.get(dp.constructor_ref) ?? [];
    arr.push(dp.id);
    driverIdsByRef.set(dp.constructor_ref, arr);
  }

  const dynamicPace = await getDynamicCarPaceStd();
  const allCtors = await db.select().from(constructors).orderBy(asc(constructors.id));

  const params: ConstructorParams[] = [];
  for (const c of allCtors) {
    const pitstop = CONSTRUCTOR_PITSTOP_DEFAULTS[c.refId] ?? 4.0;
    const carStd =
      dynamicPace[c.refId] ?? CONSTRUCTOR_CAR_PACE_STD[c.refId] ?? 1.5;
    params.push({
      id: c.id,
      ref_id: c.refId,
      driver_ids: driverIdsByRef.get(c.refId) ?? [],
      expected_pitstop_pts: pitstop,
      car_pace_std: carStd,
    });
  }
  return params;
}
