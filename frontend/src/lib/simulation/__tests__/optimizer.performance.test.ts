/**
 * Performance test: findBestTeams on full 22×11 grid must fit well inside
 * the Vercel Pro function time limit (60s).
 *
 * Asserts median-of-3 runs < 10000ms — gives 6× headroom under Vercel Pro
 * and room for the API route / DB reads / serialization overhead on top.
 *
 * DOES NOT re-run Python fixtures — timing only. Inputs are constructed
 * inline from the same formulas used in build_optimizer_fixtures() so the
 * grid is canonical without a fixture dependency.
 */
import { describe, expect, test } from "vitest";
import { findBestTeams, type Asset } from "../optimizer";
import { DRIVER_DEFAULTS } from "../parameters";

// Mirrors _DRIVER_ORDER in generate_golden_fixtures.py (seed_data.json order)
const DRIVER_ORDER: Array<[code: string, price: number]> = [
  ["VER", 27.7], ["RUS", 27.4], ["NOR", 27.2], ["PIA", 25.5], ["ANT", 23.2],
  ["LEC", 22.8], ["HAM", 22.5], ["HAD", 15.1], ["GAS", 12.0], ["SAI", 11.8],
  ["ALB", 11.6], ["ALO", 10.0], ["STR", 8.0],  ["BEA", 7.4],  ["OCO", 7.3],
  ["LAW", 6.5],  ["HUL", 6.8],  ["BOR", 6.4],  ["COL", 6.2],  ["LIN", 6.2],
  ["PER", 6.0],  ["BOT", 5.9],
];

const DRIVER_TO_CONSTRUCTOR: Record<string, string> = {
  RUS: "mercedes", ANT: "mercedes",
  NOR: "mclaren",  PIA: "mclaren",
  VER: "red_bull", HAD: "red_bull",
  LEC: "ferrari",  HAM: "ferrari",
  GAS: "alpine",   COL: "alpine",
  SAI: "williams", ALB: "williams",
  ALO: "aston_martin", STR: "aston_martin",
  BEA: "haas",     OCO: "haas",
  HUL: "audi",     BOR: "audi",
  LAW: "rb",       LIN: "rb",
  PER: "cadillac", BOT: "cadillac",
};

const CONSTRUCTOR_ORDER: Array<[ref: string, price: number]> = [
  ["mercedes", 29.3], ["mclaren", 28.9], ["red_bull", 28.2], ["ferrari", 23.3],
  ["alpine", 12.5],   ["williams", 12.0], ["aston_martin", 10.3], ["haas", 7.4],
  ["audi", 6.6],      ["rb", 6.3],       ["cadillac", 6.0],
];

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function buildCanonicalGrid(): { drivers: Asset[]; constructors: Asset[] } {
  const drivers: Asset[] = DRIVER_ORDER.map(([code, price], idx) => {
    const defaults = DRIVER_DEFAULTS[code];
    return {
      id: idx + 1,
      code,
      price,
      expected_pts: round2(30.0 - (defaults.qpace_mean - 1.0) * 1.2),
      asset_type: "driver",
      constructor_name: DRIVER_TO_CONSTRUCTOR[code],
    };
  });

  const constructors: Asset[] = CONSTRUCTOR_ORDER.map(([ref, price], idx) => {
    const teamCodes = DRIVER_ORDER.filter(
      ([code]) => DRIVER_TO_CONSTRUCTOR[code] === ref
    ).map(([code]) => code);
    const avgQpace =
      teamCodes.reduce((s, c) => s + DRIVER_DEFAULTS[c].qpace_mean, 0) /
      Math.max(1, teamCodes.length);
    return {
      id: idx + 1,
      code: ref,
      price,
      expected_pts: round2(50.0 - (avgQpace - 1.0) * 1.5),
      asset_type: "constructor",
      constructor_name: ref,
    };
  });

  return { drivers, constructors };
}

describe("optimizer performance: full 22×11 grid (≈1.45M combos)", () => {
  test("median of 3 runs completes in < 10000ms", () => {
    const { drivers, constructors } = buildCanonicalGrid();

    const durations: number[] = [];
    let lastLen = 0;
    for (let i = 0; i < 3; i++) {
      const start = performance.now();
      const results = findBestTeams({
        drivers,
        constructors,
        budget: 100.0,
        topN: 10,
      });
      const elapsed = performance.now() - start;
      durations.push(elapsed);
      lastLen = results.length;
    }

    durations.sort((a, b) => a - b);
    const median = durations[1];

    console.log(
      `[optimizer-perf] 1.45M combos — runs: [${durations.map((d) => d.toFixed(0)).join(", ")}]ms, median: ${median.toFixed(0)}ms (budget 10000ms)`
    );

    expect(lastLen).toBeGreaterThan(0);
    expect(median).toBeLessThan(10000);
  });
});
