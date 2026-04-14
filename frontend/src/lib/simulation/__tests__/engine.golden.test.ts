/**
 * Golden-test: engine.ts ≡ engine.py (statistical parity, not bit parity).
 *
 * For n_simulations=10000, TS Mulberry32 and Python numpy.PCG64 sample
 * different streams but converge to the same distribution. Per-asset metric
 * tolerances (documented in 03-02-PLAN.md AC-4) catch real porting bugs
 * while tolerating RNG stream differences.
 */
import { beforeAll, describe, expect, test } from "vitest";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  simulateRaceWeekend,
  type DriverParams,
  type ConstructorParams,
  type CircuitTraits,
  type WeatherConfig,
  type SimResult,
} from "../engine";

interface EngineFixtureOutput {
  asset_type: "driver" | "constructor";
  asset_id: number;
  mean: number;
  median: number;
  std: number;
  p10: number;
  p90: number;
}

interface EngineFixtureScenario {
  inputs: {
    drivers: DriverParams[];
    constructors: ConstructorParams[];
    circuit: CircuitTraits | null;
    weather: WeatherConfig | null;
    is_sprint: boolean;
    n_simulations: number;
    seed: number;
  };
  outputs: EngineFixtureOutput[];
}

interface EngineFixture {
  scenarios: Record<string, EngineFixtureScenario>;
}

const FIXTURE_URL = new URL("./golden-fixtures/engine.json", import.meta.url);
const FIXTURE_PATH = fileURLToPath(FIXTURE_URL);

function repoRoot(): string {
  return path.resolve(
    fileURLToPath(new URL("../../../../..", import.meta.url))
  );
}

function regenerate(): void {
  const script = path.join(
    repoRoot(),
    "backend",
    "scripts",
    "generate_golden_fixtures.py"
  );
  execSync(`python "${script}"`, { cwd: repoRoot(), stdio: "pipe" });
}

let fixture: EngineFixture;

beforeAll(() => {
  const backendAppDir = path.join(repoRoot(), "backend", "app");
  if (process.env.GOLDEN_SKIP_PYTHON !== "1" && existsSync(backendAppDir)) {
    regenerate();
  }
  fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf-8")) as EngineFixture;
});

// Tolerance table from 03-02-PLAN.md AC-4
const TOL = {
  mean: { abs: 1.5 },
  median: { abs: 2.0 },
  std: { abs: 1.5, rel: 0.15 },
  p10: { abs: 3.0 },
  p90: { abs: 3.0 },
} as const;

function tolerancePass(
  metric: keyof typeof TOL,
  ts: number,
  py: number
): boolean {
  const t = TOL[metric];
  const delta = Math.abs(ts - py);
  if ("rel" in t) {
    const allowed = Math.max(t.abs, t.rel * Math.abs(py));
    return delta <= allowed;
  }
  return delta <= t.abs;
}

function runScenario(name: string): void {
  describe(`engine scenario: ${name}`, () => {
    let tsResults: SimResult[];
    let expected: EngineFixtureOutput[];
    const maxDeltas: Record<keyof typeof TOL, number> = {
      mean: 0,
      median: 0,
      std: 0,
      p10: 0,
      p90: 0,
    };

    beforeAll(() => {
      const sc = fixture.scenarios[name];
      tsResults = simulateRaceWeekend({
        drivers: sc.inputs.drivers,
        constructors: sc.inputs.constructors,
        circuit: sc.inputs.circuit ?? undefined,
        weather: sc.inputs.weather ?? undefined,
        isSprint: sc.inputs.is_sprint,
        nSimulations: sc.inputs.n_simulations,
        seed: sc.inputs.seed,
      });
      expected = sc.outputs;
    });

    test("all assets match within tolerance + report max deltas", () => {
      const failures: string[] = [];

      for (const exp of expected) {
        const actual = tsResults.find(
          (r) =>
            r.asset_type === exp.asset_type && r.asset_id === exp.asset_id
        );
        if (!actual) {
          failures.push(
            `missing ${exp.asset_type}#${exp.asset_id} in TS output`
          );
          continue;
        }

        const metrics: (keyof typeof TOL)[] = [
          "mean",
          "median",
          "std",
          "p10",
          "p90",
        ];
        for (const m of metrics) {
          const d = Math.abs(actual[m] - exp[m]);
          if (d > maxDeltas[m]) maxDeltas[m] = d;
          if (!tolerancePass(m, actual[m], exp[m])) {
            failures.push(
              `${exp.asset_type}#${exp.asset_id} ${m}: TS=${actual[m].toFixed(3)} PY=${exp[m].toFixed(3)} Δ=${d.toFixed(3)}`
            );
          }
        }
      }

      // Summary line for tolerance tuning
      console.log(
        `[${name}] max deltas — mean=${maxDeltas.mean.toFixed(3)} median=${maxDeltas.median.toFixed(3)} std=${maxDeltas.std.toFixed(3)} p10=${maxDeltas.p10.toFixed(3)} p90=${maxDeltas.p90.toFixed(3)}`
      );

      if (failures.length > 0) {
        throw new Error(
          `${failures.length} tolerance failures:\n  ${failures.slice(0, 20).join("\n  ")}${failures.length > 20 ? `\n  ... ${failures.length - 20} more` : ""}`
        );
      }
    });
  });
}

runScenario("baseline_dry_race");
runScenario("sprint_dry");
runScenario("wet_race");
runScenario("street_circuit");
