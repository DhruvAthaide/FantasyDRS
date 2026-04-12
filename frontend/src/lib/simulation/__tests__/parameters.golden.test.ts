/**
 * Golden-test: parameters.ts ≡ parameters.py.
 *
 * Checks all three data dicts (DRIVER_DEFAULTS, CONSTRUCTOR_PITSTOP_DEFAULTS,
 * CONSTRUCTOR_CAR_PACE_STD) match the Python source exactly. DB-dependent
 * helpers in parameters.py (get_dynamic_*) are intentionally NOT tested here
 * — they belong in a later plan with a Drizzle-backed port.
 */
import { beforeAll, describe, expect, test } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  DRIVER_DEFAULTS,
  CONSTRUCTOR_PITSTOP_DEFAULTS,
  CONSTRUCTOR_CAR_PACE_STD,
} from "../parameters";

interface Fixture {
  DRIVER_DEFAULTS: Record<string, Record<string, number>>;
  CONSTRUCTOR_PITSTOP_DEFAULTS: Record<string, number>;
  CONSTRUCTOR_CAR_PACE_STD: Record<string, number>;
}

const FIXTURE_URL = new URL(
  "./golden-fixtures/parameters.json",
  import.meta.url
);
const FIXTURE_PATH = fileURLToPath(FIXTURE_URL);

function repoRoot(): string {
  return path.resolve(fileURLToPath(new URL("../../../../..", import.meta.url)));
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

let fixture: Fixture;

beforeAll(() => {
  if (process.env.GOLDEN_SKIP_PYTHON !== "1") {
    regenerate();
  }
  fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf-8")) as Fixture;
});

describe("DRIVER_DEFAULTS — 22 drivers × 5 fields", () => {
  test("TS ≡ Python", () => {
    // JSON round-trip normalises number precision for deep-equal comparison.
    const tsAsPlain = JSON.parse(JSON.stringify(DRIVER_DEFAULTS));
    expect(tsAsPlain).toEqual(fixture.DRIVER_DEFAULTS);
  });

  test("every expected driver code is present", () => {
    const expected = Object.keys(fixture.DRIVER_DEFAULTS).sort();
    const actual = Object.keys(DRIVER_DEFAULTS).sort();
    expect(actual).toEqual(expected);
    expect(actual).toHaveLength(22);
  });
});

describe("CONSTRUCTOR_PITSTOP_DEFAULTS — 11 constructors", () => {
  test("TS ≡ Python", () => {
    const tsAsPlain = JSON.parse(JSON.stringify(CONSTRUCTOR_PITSTOP_DEFAULTS));
    expect(tsAsPlain).toEqual(fixture.CONSTRUCTOR_PITSTOP_DEFAULTS);
  });
});

describe("CONSTRUCTOR_CAR_PACE_STD — 11 constructors", () => {
  test("TS ≡ Python", () => {
    const tsAsPlain = JSON.parse(JSON.stringify(CONSTRUCTOR_CAR_PACE_STD));
    expect(tsAsPlain).toEqual(fixture.CONSTRUCTOR_CAR_PACE_STD);
  });
});
