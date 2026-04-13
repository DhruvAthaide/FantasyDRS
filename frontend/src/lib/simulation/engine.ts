/**
 * Monte Carlo simulation engine for F1 Fantasy point predictions (2026 rules).
 *
 * Ported from backend/app/simulation/engine.py — algorithmic parity
 * maintained via statistical tolerance tests in engine.golden.test.ts.
 *
 * Does NOT produce numpy-bit-identical output (Mulberry32 vs PCG64); relies
 * on n_simulations >= 10k for convergence to the same distribution.
 */
import {
  mulberry32,
  boxMullerNormal,
  sampleUniformArray,
} from "./rng";
import {
  scoreQualifyingDriver,
  scoreSprintQualifyingDriver,
  scoreRacePosition,
  scoreSprintPosition,
  scorePositionsChanged,
  scoreConstructorQualifyingProgression,
  FASTEST_LAP_PTS,
  DRIVER_OF_THE_DAY_PTS,
  RACE_DNF_PENALTY,
  SPRINT_DNF_PENALTY,
  BEAT_TEAMMATE_PTS,
  OVERTAKE_PTS,
} from "./scoring";

// ---------------------------------------------------------------------------
// Public interfaces (ported from Python @dataclass declarations)
// ---------------------------------------------------------------------------
export interface DriverParams {
  id: number;
  code: string;
  constructor_ref: string;
  qpace_mean: number;
  qpace_std: number;
  dnf_probability: number;
  fl_probability: number;
  avg_positions_gained: number;
  grid_penalty?: number;
}

export interface ConstructorParams {
  id: number;
  ref_id: string;
  driver_ids: number[];
  expected_pitstop_pts?: number;
  car_pace_std?: number;
}

export interface CircuitTraits {
  overtake_difficulty?: number;
  high_speed?: number;
  street_circuit?: boolean;
  altitude?: number;
  avg_degradation?: number;
}

export interface WeatherConfig {
  is_wet?: boolean;
  quali_std_multiplier?: number;
  race_noise_multiplier?: number;
  dnf_multiplier?: number;
}

export interface SimResult {
  asset_type: "driver" | "constructor";
  asset_id: number;
  mean: number;
  median: number;
  std: number;
  p10: number;
  p90: number;
}

export interface SimulateInput {
  drivers: DriverParams[];
  constructors: ConstructorParams[];
  circuit?: CircuitTraits;
  isSprint?: boolean;
  nSimulations?: number;
  weather?: WeatherConfig;
  seed: number;
}

// ---------------------------------------------------------------------------
// numpy-equivalent helpers (argsort, mean, median, std, percentile)
// Kept in this file (not rng.ts) because the semantics are tied to the
// engine's expected numpy defaults (population std, linear-interp percentile).
// ---------------------------------------------------------------------------

function argsort(arr: number[]): number[] {
  const indexed = arr.map((v, i): [number, number] => [v, i]);
  // Stable sort by value; ties keep original order (matches numpy.argsort kind='quicksort'
  // closely enough for the engine's purposes — ties in raw_quali are astronomically rare
  // for continuous normals).
  indexed.sort((a, b) => a[0] - b[0]);
  return indexed.map((pair) => pair[1]);
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return s / arr.length;
}

/** numpy default: population std (ddof=0). */
function stdPopulation(arr: number[]): number {
  if (arr.length === 0) return 0;
  const m = mean(arr);
  let sq = 0;
  for (let i = 0; i < arr.length; i++) {
    const d = arr[i] - m;
    sq += d * d;
  }
  return Math.sqrt(sq / arr.length);
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * numpy.percentile with method="linear" (the default in numpy >= 1.22).
 * Index = (p/100) * (n-1); linear interp between floor(idx) and ceil(idx).
 */
function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

// ---------------------------------------------------------------------------
// simulateRaceWeekend — direct line-for-line port of engine.py body.
// ---------------------------------------------------------------------------
export function simulateRaceWeekend(input: SimulateInput): SimResult[] {
  const drivers = input.drivers;
  const constructors = input.constructors;
  const circuit: Required<CircuitTraits> = {
    overtake_difficulty: input.circuit?.overtake_difficulty ?? 0.5,
    high_speed: input.circuit?.high_speed ?? 0.5,
    street_circuit: input.circuit?.street_circuit ?? false,
    altitude: input.circuit?.altitude ?? 0,
    avg_degradation: input.circuit?.avg_degradation ?? 0.5,
  };
  const weather: Required<WeatherConfig> = {
    is_wet: input.weather?.is_wet ?? false,
    quali_std_multiplier: input.weather?.quali_std_multiplier ?? 1.5,
    race_noise_multiplier: input.weather?.race_noise_multiplier ?? 1.4,
    dnf_multiplier: input.weather?.dnf_multiplier ?? 1.3,
  };
  const isSprint = input.isSprint ?? false;
  const nSimulations = input.nSimulations ?? 10000;
  const nDrivers = drivers.length;

  const rng = mulberry32(input.seed);

  const driverPoints = new Map<number, number[]>();
  for (const d of drivers) driverPoints.set(d.id, new Array(nSimulations).fill(0));
  const constructorPoints = new Map<number, number[]>();
  for (const c of constructors) constructorPoints.set(c.id, new Array(nSimulations).fill(0));

  // Build constructor_ref -> driver-index list (insertion-ordered, like Python dict)
  const constructorRefToIndices = new Map<string, number[]>();
  for (let i = 0; i < drivers.length; i++) {
    const ref = drivers[i].constructor_ref;
    if (!constructorRefToIndices.has(ref)) constructorRefToIndices.set(ref, []);
    constructorRefToIndices.get(ref)!.push(i);
  }

  // Teammate map
  const teammateMap = new Map<number, number>();
  for (const [, indices] of constructorRefToIndices) {
    if (indices.length === 2) {
      teammateMap.set(indices[0], indices[1]);
      teammateMap.set(indices[1], indices[0]);
    }
  }

  // Car pace std lookup
  const carStdMap = new Map<string, number>();
  for (const c of constructors) carStdMap.set(c.ref_id, c.car_pace_std ?? 1.5);

  // Pre-generate car offsets per constructor per sim (iteration order matches Python)
  const carOffsets = new Map<string, number[]>();
  for (const [refId] of constructorRefToIndices) {
    const std = carStdMap.get(refId) ?? 1.5;
    const arr = new Array<number>(nSimulations);
    for (let s = 0; s < nSimulations; s++) arr[s] = boxMullerNormal(rng, 0, std);
    carOffsets.set(refId, arr);
  }

  // Weather multipliers
  const qStdMult = weather.is_wet ? weather.quali_std_multiplier : 1.0;
  const rNoiseMult = weather.is_wet ? weather.race_noise_multiplier : 1.0;
  const dnfMult = weather.is_wet ? weather.dnf_multiplier : 1.0;

  // Pre-generate quali samples (nSimulations × nDrivers), row-major
  const qualiSamples: number[][] = new Array(nSimulations);
  for (let s = 0; s < nSimulations; s++) {
    const row = new Array<number>(nDrivers);
    for (let j = 0; j < nDrivers; j++) {
      row[j] = boxMullerNormal(
        rng,
        drivers[j].qpace_mean,
        drivers[j].qpace_std * qStdMult
      );
    }
    qualiSamples[s] = row;
  }

  // race_noise (nSimulations × nDrivers)
  const raceNoise: number[][] = new Array(nSimulations);
  for (let s = 0; s < nSimulations; s++) {
    const row = new Array<number>(nDrivers);
    for (let j = 0; j < nDrivers; j++) {
      row[j] = boxMullerNormal(rng, 0, drivers[j].qpace_std * 0.6 * rNoiseMult);
    }
    raceNoise[s] = row;
  }

  // dnf_rolls (nSimulations × nDrivers)
  const dnfRolls: number[][] = new Array(nSimulations);
  for (let s = 0; s < nSimulations; s++) {
    dnfRolls[s] = sampleUniformArray(rng, nDrivers);
  }

  const flRolls = sampleUniformArray(rng, nSimulations);
  const dotdRolls = sampleUniformArray(rng, nSimulations);

  const scProbability = circuit.street_circuit ? 0.45 : 0.55;
  const scRolls = sampleUniformArray(rng, nSimulations);

  const overtakeEase = 1.0 - circuit.overtake_difficulty;

  // ═════════════════════════════════════════════════════════════════════
  // Main simulation loop
  // ═════════════════════════════════════════════════════════════════════
  for (let sim = 0; sim < nSimulations; sim++) {
    // === QUALIFYING ===
    const rawQuali = qualiSamples[sim].slice();
    for (const [refId, indices] of constructorRefToIndices) {
      const offset = carOffsets.get(refId)![sim];
      for (const idx of indices) rawQuali[idx] += offset;
    }

    const qualiOrder = argsort(rawQuali);
    const qualiPositions = new Array<number>(nDrivers);
    for (let rank = 0; rank < qualiOrder.length; rank++) {
      qualiPositions[qualiOrder[rank]] = rank + 1;
    }

    // === GRID POSITIONS ===
    const gridPositions = new Array<number>(nDrivers);
    for (let i = 0; i < nDrivers; i++) {
      let gridPos = qualiPositions[i] + (drivers[i].grid_penalty ?? 0);
      gridPos = Math.max(1, Math.min(nDrivers, gridPos));
      gridPositions[i] = gridPos;
    }

    // === RACE ===
    const raceRaw = new Array<number>(nDrivers).fill(0);
    const racePositions = new Array<number>(nDrivers).fill(nDrivers + 1);
    const isDnf = new Array<boolean>(nDrivers).fill(false);

    for (let i = 0; i < nDrivers; i++) {
      const d = drivers[i];
      const effectiveDnf = d.dnf_probability * dnfMult;
      if (dnfRolls[sim][i] < effectiveDnf) {
        isDnf[i] = true;
        continue;
      }
      const deltaMean = -d.avg_positions_gained * overtakeEase;
      raceRaw[i] = gridPositions[i] + deltaMean + raceNoise[sim][i];
    }

    // Safety car — add mild noise to active drivers, then resolve positions
    const activeIndices: number[] = [];
    for (let i = 0; i < nDrivers; i++) if (!isDnf[i]) activeIndices.push(i);

    if (activeIndices.length > 0) {
      if (!isSprint && scRolls[sim] < scProbability) {
        for (const idx of activeIndices) {
          raceRaw[idx] += boxMullerNormal(rng, 0, 0.8);
        }
      }
      const activeRaw = activeIndices.map((idx) => raceRaw[idx]);
      const activeOrder = argsort(activeRaw);
      for (let rank = 0; rank < activeOrder.length; rank++) {
        racePositions[activeIndices[activeOrder[rank]]] = rank + 1;
      }
    }

    // === FASTEST LAP (race only, P1-P10) ===
    let flIdx = -1;
    if (!isSprint) {
      const flWeights = new Array<number>(nDrivers).fill(0);
      for (let i = 0; i < nDrivers; i++) {
        if (isDnf[i]) continue;
        const rPos = racePositions[i];
        if (rPos > 10) continue;
        const posFactor = rPos <= 5 ? 3.0 : 1.5;
        flWeights[i] = drivers[i].fl_probability * posFactor;
      }
      const totalW = flWeights.reduce((a, b) => a + b, 0);
      if (totalW > 0) {
        for (let i = 0; i < nDrivers; i++) flWeights[i] /= totalW;
        // Cumulative sum
        let acc = 0;
        const cumsum = flWeights.map((w) => (acc += w));
        // searchsorted(cumsum, fl_rolls[sim]) — leftmost index where cumsum[i] >= target
        const target = flRolls[sim];
        let picked = cumsum.findIndex((c) => c >= target);
        if (picked === -1) picked = nDrivers - 1;
        flIdx = Math.min(picked, nDrivers - 1);
        if (isDnf[flIdx] || racePositions[flIdx] > 10) flIdx = -1;
      }
    }

    // === DRIVER OF THE DAY (race only) ===
    let dotdIdx = -1;
    if (!isSprint) {
      const dotdWeights = new Array<number>(nDrivers).fill(0);
      for (let i = 0; i < nDrivers; i++) {
        if (isDnf[i]) continue;
        const rPos = racePositions[i];
        const posGain = gridPositions[i] - rPos;
        const moverWeight = Math.pow(Math.max(0, posGain), 1.5);
        let finishWeight = Math.max(0, (nDrivers - rPos) / nDrivers);
        if (rPos === 1) finishWeight += 2.0;
        else if (rPos <= 3) finishWeight += 1.0;
        dotdWeights[i] = moverWeight + finishWeight + 0.1;
      }
      const totalDw = dotdWeights.reduce((a, b) => a + b, 0);
      if (totalDw > 0) {
        for (let i = 0; i < nDrivers; i++) dotdWeights[i] /= totalDw;
        let acc = 0;
        const cumsum = dotdWeights.map((w) => (acc += w));
        const target = dotdRolls[sim];
        let picked = cumsum.findIndex((c) => c >= target);
        if (picked === -1) picked = nDrivers - 1;
        dotdIdx = Math.min(picked, nDrivers - 1);
      }
    }

    // === SCORE DRIVERS ===
    for (let i = 0; i < nDrivers; i++) {
      const d = drivers[i];
      let pts = 0;
      const qPos = qualiPositions[i];

      pts += isSprint
        ? scoreSprintQualifyingDriver(qPos)
        : scoreQualifyingDriver(qPos);

      const tmIdx = teammateMap.get(i);
      if (tmIdx !== undefined) {
        if (qPos < qualiPositions[tmIdx]) pts += BEAT_TEAMMATE_PTS;
      }

      if (isDnf[i]) {
        pts += isSprint ? SPRINT_DNF_PENALTY : RACE_DNF_PENALTY;
      } else {
        const rPos = racePositions[i];
        const gPos = gridPositions[i];

        pts += isSprint
          ? scoreSprintPosition(rPos)
          : scoreRacePosition(rPos);

        pts += scorePositionsChanged(gPos, rPos);

        const posChange = gPos - rPos;
        if (posChange > 0) {
          const overtakeRatio = 0.4 + overtakeEase * 0.4;
          const estimatedOvertakes = Math.max(
            0,
            Math.round(posChange * overtakeRatio)
          );
          pts += estimatedOvertakes * OVERTAKE_PTS;
        }

        if (i === flIdx) pts += FASTEST_LAP_PTS;
        if (!isSprint && i === dotdIdx) pts += DRIVER_OF_THE_DAY_PTS;

        if (tmIdx !== undefined) {
          if (isDnf[tmIdx]) pts += BEAT_TEAMMATE_PTS;
          else if (rPos < racePositions[tmIdx]) pts += BEAT_TEAMMATE_PTS;
        }
      }

      driverPoints.get(d.id)![sim] = pts;
    }

    // === SCORE CONSTRUCTORS ===
    for (const c of constructors) {
      let cPts = 0;
      const dIndices: number[] = [];
      for (let i = 0; i < drivers.length; i++) {
        if (c.driver_ids.includes(drivers[i].id)) dIndices.push(i);
      }
      if (dIndices.length < 2) continue;

      const [d0, d1] = [dIndices[0], dIndices[1]];
      const q0 = qualiPositions[d0];
      const q1 = qualiPositions[d1];

      if (isSprint) {
        cPts += scoreSprintQualifyingDriver(q0) + scoreSprintQualifyingDriver(q1);
      } else {
        cPts += scoreQualifyingDriver(q0) + scoreQualifyingDriver(q1);
      }
      cPts += scoreConstructorQualifyingProgression(q0, q1);

      for (const di of [d0, d1]) {
        if (isDnf[di]) {
          cPts += isSprint ? SPRINT_DNF_PENALTY : RACE_DNF_PENALTY;
        } else {
          const rPos = racePositions[di];
          const gPos = gridPositions[di];
          cPts += isSprint
            ? scoreSprintPosition(rPos)
            : scoreRacePosition(rPos);
          cPts += scorePositionsChanged(gPos, rPos);
          const posChange = gPos - rPos;
          if (posChange > 0) {
            const overtakeRatio = 0.4 + overtakeEase * 0.4;
            const estimatedOvertakes = Math.max(
              0,
              Math.round(posChange * overtakeRatio)
            );
            cPts += estimatedOvertakes * OVERTAKE_PTS;
          }
        }
      }

      if (!isSprint) cPts += c.expected_pitstop_pts ?? 4.0;

      constructorPoints.get(c.id)![sim] = cPts;
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  // Aggregate results
  // ═════════════════════════════════════════════════════════════════════
  const results: SimResult[] = [];
  for (const d of drivers) {
    const pts = driverPoints.get(d.id)!;
    results.push({
      asset_type: "driver",
      asset_id: d.id,
      mean: mean(pts),
      median: median(pts),
      std: stdPopulation(pts),
      p10: percentile(pts, 10),
      p90: percentile(pts, 90),
    });
  }
  for (const c of constructors) {
    const pts = constructorPoints.get(c.id)!;
    results.push({
      asset_type: "constructor",
      asset_id: c.id,
      mean: mean(pts),
      median: median(pts),
      std: stdPopulation(pts),
      p10: percentile(pts, 10),
      p90: percentile(pts, 90),
    });
  }

  return results;
}
