/**
 * Default simulation parameters for each driver + constructor.
 *
 * 2026 early-season baseline: Mercedes and Ferrari are the class of the
 * field, McLaren and Red Bull close behind, then a midfield pack, then
 * backmarkers.
 *
 * Field semantics (from Python source):
 *   qpace_mean      = expected qualifying position (1 = pole favorite)
 *   qpace_std       = session-to-session variability (lower = more consistent)
 *   dnf_pct         = retirement probability per race
 *   fl_pct          = fastest lap probability (weighted by raw pace)
 *   avg_pos_gained  = net positions typically gained/lost on lap 1 + race craft
 *
 * Ported from backend/app/simulation/parameters.py — keep in lockstep.
 * Any change MUST be made in both files and re-verified via golden tests.
 *
 * NOTE: The Python module also exposes `get_dynamic_pitstop_defaults(db)` and
 * `get_dynamic_car_pace_std(db)` which query the DB. Those are deferred to a
 * later plan (03-02 or a dedicated Drizzle-port plan) because they require
 * the simulation engine's DB-read plumbing, not just the parameter constants.
 */

export interface DriverDefault {
  qpace_mean: number;
  qpace_std: number;
  dnf_pct: number;
  fl_pct: number;
  avg_pos_gained: number;
}

// ---------------------------------------------------------------------------
// DRIVER DEFAULTS
// Grouped by constructor performance tier based on 2026 results + prices
// ---------------------------------------------------------------------------

export const DRIVER_DEFAULTS: Readonly<Record<string, DriverDefault>> = {
  // === TIER 1: Mercedes (dominant early 2026) ===
  RUS: { qpace_mean: 3.0, qpace_std: 1.8, dnf_pct: 0.04, fl_pct: 0.12, avg_pos_gained: 0.5 },
  ANT: { qpace_mean: 4.5, qpace_std: 2.2, dnf_pct: 0.07, fl_pct: 0.08, avg_pos_gained: 0.3 },

  // === TIER 1: Ferrari (dominant early 2026) ===
  LEC: { qpace_mean: 3.5, qpace_std: 1.8, dnf_pct: 0.05, fl_pct: 0.11, avg_pos_gained: 0.4 },
  HAM: { qpace_mean: 4.0, qpace_std: 1.9, dnf_pct: 0.04, fl_pct: 0.10, avg_pos_gained: 0.6 },

  // === TIER 2: McLaren (strong contenders) ===
  NOR: { qpace_mean: 4.0, qpace_std: 2.0, dnf_pct: 0.04, fl_pct: 0.09, avg_pos_gained: 0.3 },
  PIA: { qpace_mean: 4.5, qpace_std: 2.0, dnf_pct: 0.05, fl_pct: 0.08, avg_pos_gained: 0.2 },

  // === TIER 2: Red Bull (adjusting to new regs) ===
  VER: { qpace_mean: 3.5, qpace_std: 2.2, dnf_pct: 0.03, fl_pct: 0.13, avg_pos_gained: 0.8 },
  HAD: { qpace_mean: 8.0, qpace_std: 2.5, dnf_pct: 0.08, fl_pct: 0.03, avg_pos_gained: 0.1 },

  // === TIER 3: Upper midfield ===
  GAS: { qpace_mean: 9.0, qpace_std: 2.5, dnf_pct: 0.06, fl_pct: 0.03, avg_pos_gained: 0.2 },
  SAI: { qpace_mean: 8.5, qpace_std: 2.5, dnf_pct: 0.05, fl_pct: 0.03, avg_pos_gained: 0.3 },
  ALB: { qpace_mean: 9.5, qpace_std: 2.5, dnf_pct: 0.05, fl_pct: 0.02, avg_pos_gained: 0.2 },

  // === TIER 4: Lower midfield ===
  ALO: { qpace_mean: 11.0, qpace_std: 2.8, dnf_pct: 0.05, fl_pct: 0.02, avg_pos_gained: 0.4 },
  STR: { qpace_mean: 13.0, qpace_std: 2.8, dnf_pct: 0.06, fl_pct: 0.01, avg_pos_gained: 0.0 },
  BEA: { qpace_mean: 11.5, qpace_std: 3.0, dnf_pct: 0.07, fl_pct: 0.02, avg_pos_gained: 0.1 },
  OCO: { qpace_mean: 12.0, qpace_std: 2.8, dnf_pct: 0.06, fl_pct: 0.01, avg_pos_gained: 0.1 },
  LAW: { qpace_mean: 10.5, qpace_std: 2.8, dnf_pct: 0.06, fl_pct: 0.02, avg_pos_gained: 0.2 },
  HUL: { qpace_mean: 12.0, qpace_std: 2.8, dnf_pct: 0.06, fl_pct: 0.01, avg_pos_gained: 0.1 },

  // === TIER 5: Backmarkers ===
  BOR: { qpace_mean: 14.0, qpace_std: 3.0, dnf_pct: 0.08, fl_pct: 0.01, avg_pos_gained: 0.0 },
  COL: { qpace_mean: 13.5, qpace_std: 3.0, dnf_pct: 0.07, fl_pct: 0.01, avg_pos_gained: 0.0 },
  LIN: { qpace_mean: 14.5, qpace_std: 3.0, dnf_pct: 0.08, fl_pct: 0.01, avg_pos_gained: -0.1 },
  PER: { qpace_mean: 13.0, qpace_std: 3.0, dnf_pct: 0.07, fl_pct: 0.01, avg_pos_gained: 0.1 },
  BOT: { qpace_mean: 14.0, qpace_std: 3.0, dnf_pct: 0.06, fl_pct: 0.01, avg_pos_gained: 0.0 },
} as const;

// ---------------------------------------------------------------------------
// CONSTRUCTOR DEFAULTS
// ---------------------------------------------------------------------------

/** Expected pitstop fantasy points per constructor (2-10 scale based on crew speed). */
export const CONSTRUCTOR_PITSTOP_DEFAULTS: Readonly<Record<string, number>> = {
  red_bull: 7.0, // historically top-tier pit crew
  mclaren: 6.5,
  mercedes: 7.0, // consistently fast stops
  ferrari: 5.5, //  occasional slow stops
  williams: 5.0,
  alpine: 4.5,
  aston_martin: 4.5,
  haas: 4.0,
  audi: 4.0, //     new team, unproven
  rb: 5.0,
  cadillac: 3.5, // new team
} as const;

/**
 * Car pace variability per constructor (std dev in positions).
 * Top teams are more consistent; backmarkers have wilder swings.
 */
export const CONSTRUCTOR_CAR_PACE_STD: Readonly<Record<string, number>> = {
  red_bull: 1.0,
  mclaren: 1.0,
  mercedes: 0.8, //      very consistent early 2026
  ferrari: 0.9, //       consistent but occasional off-weekend
  williams: 1.8,
  alpine: 1.8,
  aston_martin: 2.0, //  inconsistent
  haas: 2.2,
  audi: 2.2,
  rb: 2.0,
  cadillac: 2.5, //      most variable
} as const;
