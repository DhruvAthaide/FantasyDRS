/**
 * Golden-test: optimizer.ts ≡ optimizer.py (deterministic exact-match).
 *
 * Unlike engine.golden.test.ts which uses statistical tolerance, the
 * optimizer is pure-deterministic — same inputs MUST yield the same
 * top-N team list in the same order.
 *
 * Floating-point totals may have tiny precision differences between
 * Python's float and JS's number (both IEEE-754 double, but accumulation
 * order matters); those are checked with toBeCloseTo(expected, 2) since
 * the Python side rounds total_points + budget_remaining to 2 decimals.
 */
import { beforeAll, describe, expect, test } from "vitest";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  findBestTeams,
  type Asset,
  type OptimalTeam,
} from "../optimizer";

interface OptimizerScenarioInputs {
  drivers: Asset[];
  constructors: Asset[];
  budget: number;
  top_n: number;
  include_driver_ids?: number[];
  exclude_driver_ids?: number[];
  include_constructor_ids?: number[];
  exclude_constructor_ids?: number[];
  drs_multiplier?: number;
  drs_driver_id?: number;
}

interface OptimizerScenario {
  inputs: OptimizerScenarioInputs;
  outputs: OptimalTeam[];
}

interface OptimizerFixture {
  scenarios: Record<string, OptimizerScenario>;
}

const FIXTURE_URL = new URL(
  "./golden-fixtures/optimizer.json",
  import.meta.url
);
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

let fixture: OptimizerFixture;

beforeAll(() => {
  const backendAppDir = path.join(repoRoot(), "backend", "app");
  if (process.env.GOLDEN_SKIP_PYTHON !== "1" && existsSync(backendAppDir)) {
    regenerate();
  }
  fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf-8")) as OptimizerFixture;
});

function expectAssetEqual(actual: Asset, expected: Asset): void {
  expect(actual.id).toBe(expected.id);
  expect(actual.code).toBe(expected.code);
  expect(actual.asset_type).toBe(expected.asset_type);
  expect(actual.constructor_name ?? "").toBe(expected.constructor_name ?? "");
  expect(actual.constructor_color ?? "").toBe(expected.constructor_color ?? "");
  expect(actual.price).toBeCloseTo(expected.price, 5);
  expect(actual.expected_pts).toBeCloseTo(expected.expected_pts, 5);
}

function expectTeamEqual(actual: OptimalTeam, expected: OptimalTeam): void {
  expect(actual.drivers).toHaveLength(expected.drivers.length);
  for (let i = 0; i < expected.drivers.length; i++) {
    expectAssetEqual(actual.drivers[i], expected.drivers[i]);
  }
  expect(actual.constructors).toHaveLength(expected.constructors.length);
  for (let i = 0; i < expected.constructors.length; i++) {
    expectAssetEqual(actual.constructors[i], expected.constructors[i]);
  }
  expectAssetEqual(actual.drs_driver, expected.drs_driver);
  expect(actual.total_cost).toBeCloseTo(expected.total_cost, 5);
  expect(actual.total_points).toBeCloseTo(expected.total_points, 2);
  expect(actual.budget_remaining).toBeCloseTo(expected.budget_remaining, 2);
}

function runScenario(name: string): void {
  describe(`optimizer scenario: ${name}`, () => {
    let tsResults: OptimalTeam[];
    let expected: OptimalTeam[];

    beforeAll(() => {
      const sc = fixture.scenarios[name];
      tsResults = findBestTeams({
        drivers: sc.inputs.drivers,
        constructors: sc.inputs.constructors,
        budget: sc.inputs.budget,
        topN: sc.inputs.top_n,
        includeDriverIds: sc.inputs.include_driver_ids,
        excludeDriverIds: sc.inputs.exclude_driver_ids,
        includeConstructorIds: sc.inputs.include_constructor_ids,
        excludeConstructorIds: sc.inputs.exclude_constructor_ids,
        drsMultiplier: sc.inputs.drs_multiplier,
        drsDriverId: sc.inputs.drs_driver_id,
      });
      expected = sc.outputs;
    });

    test("output length matches Python", () => {
      expect(tsResults).toHaveLength(expected.length);
    });

    test("teams match Python in order", () => {
      for (let i = 0; i < expected.length; i++) {
        expectTeamEqual(tsResults[i], expected[i]);
      }
    });
  });
}

runScenario("default");
runScenario("tight_budget");
runScenario("include_driver_ver");
runScenario("exclude_driver_ver");
runScenario("custom_drs_3x");
