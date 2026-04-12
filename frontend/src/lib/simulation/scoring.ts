/**
 * Official 2026 F1 Fantasy scoring rules.
 *
 * Ported from backend/app/simulation/scoring.py — keep in lockstep.
 * Any change MUST be made in both files and re-verified via golden tests.
 *
 * Golden parity: scoring.golden.test.ts diffs every fn output against
 * the Python source across an exhaustive input grid.
 */

// Driver qualifying points (grid penalties do NOT affect qualifying pts)
export const QUALI_POINTS: Readonly<Record<number, number>> = {
  1: 10,
  2: 9,
  3: 8,
  4: 7,
  5: 6,
  6: 5,
  7: 4,
  8: 3,
  9: 2,
  10: 1,
} as const;

export const QUALI_NC_DSQ_PENALTY = -5;

// Sprint qualifying points (half of qualifying, rounded down)
export const SPRINT_QUALI_POINTS: Readonly<Record<number, number>> = {
  1: 5,
  2: 4,
  3: 4,
  4: 3,
  5: 3,
  6: 2,
  7: 2,
  8: 1,
  9: 1,
  10: 0,
} as const;

// Driver race finish points (standard F1 points)
export const RACE_POINTS: Readonly<Record<number, number>> = {
  1: 25,
  2: 18,
  3: 15,
  4: 12,
  5: 10,
  6: 8,
  7: 6,
  8: 4,
  9: 2,
  10: 1,
} as const;

// Sprint finish points (P1-P8 only)
export const SPRINT_POINTS: Readonly<Record<number, number>> = {
  1: 10,
  2: 8,
  3: 6,
  4: 5,
  5: 4,
  6: 3,
  7: 2,
  8: 1,
} as const;

// Bonus points
export const FASTEST_LAP_PTS = 10; // Race only, driver must finish in points (P1-P10)
export const DRIVER_OF_THE_DAY_PTS = 10;

// Positions gained/lost: +2 per position gained, -2 per position lost
// (based on grid start position vs race finish)
export const POSITIONS_CHANGE_MULTIPLIER = 2;

// Overtakes: +1 per overtake made during the race
export const OVERTAKE_PTS = 1;

// Beat teammate: +2 if you finish ahead of teammate (race/sprint/quali)
export const BEAT_TEAMMATE_PTS = 2;

// DNF penalties
export const RACE_DNF_PENALTY = -20;
export const SPRINT_DNF_PENALTY = -10;

// Constructor qualifying progression
export const Q2_CUTOFF = 15;
export const Q3_CUTOFF = 10;

// Bonus: fastest pitstop of the race = +5
export const FASTEST_PITSTOP_BONUS = 5;

// ---------------------------------------------------------------------------
// Scoring functions — mirror Python dict.get(key, 0) semantics exactly.
// ---------------------------------------------------------------------------

export function scoreQualifyingDriver(position: number): number {
  return QUALI_POINTS[position] ?? 0;
}

/** Sprint qualifying points are half of normal qualifying, rounded down. */
export function scoreSprintQualifyingDriver(position: number): number {
  return SPRINT_QUALI_POINTS[position] ?? 0;
}

export function scoreRacePosition(position: number): number {
  return RACE_POINTS[position] ?? 0;
}

export function scoreSprintPosition(position: number): number {
  return SPRINT_POINTS[position] ?? 0;
}

/**
 * Score positions gained/lost from grid start to race finish.
 * +2 per position gained, -2 per position lost.
 */
export function scorePositionsChanged(
  gridPos: number,
  finishPos: number
): number {
  return (gridPos - finishPos) * POSITIONS_CHANGE_MULTIPLIER;
}

/** Official 2026 constructor qualifying progression scoring. */
export function scoreConstructorQualifyingProgression(
  pos1: number,
  pos2: number
): number {
  const inQ3_1 = pos1 <= Q3_CUTOFF;
  const inQ3_2 = pos2 <= Q3_CUTOFF;
  const inQ2_1 = pos1 <= Q2_CUTOFF;
  const inQ2_2 = pos2 <= Q2_CUTOFF;

  if (inQ3_1 && inQ3_2) return 10;
  if (inQ2_1 && inQ2_2) return 5;
  // Both eliminated in Q1
  return 2;
}

/** Official 2026 constructor pitstop scoring. */
export function scorePitstopTime(timeSeconds: number): number {
  if (timeSeconds < 2.0) return 10; // Sub-2s
  if (timeSeconds < 2.2) return 10; // 2.0-2.19s
  if (timeSeconds < 2.5) return 5; //  2.2-2.49s
  if (timeSeconds < 3.0) return 3; //  2.5-2.99s
  if (timeSeconds < 5.0) return 2; //  3.0-4.99s
  return 0; //                          5.0s+
}
