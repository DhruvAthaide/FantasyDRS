/**
 * Golden-test: scoring.ts ≡ scoring.py across an exhaustive input grid.
 *
 * By default, the test calls the Python fixture generator at beforeAll to
 * pick up any scoring.py changes. Set GOLDEN_SKIP_PYTHON=1 to skip the
 * regen and use committed fixtures (useful for CI without Python).
 */
import { beforeAll, describe, expect, test } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import * as tsScoring from "../scoring";

interface Fixture {
  constants: Record<string, unknown>;
  scoreQualifyingDriver: { input: number; output: number }[];
  scoreSprintQualifyingDriver: { input: number; output: number }[];
  scoreRacePosition: { input: number; output: number }[];
  scoreSprintPosition: { input: number; output: number }[];
  scorePositionsChanged: { input: [number, number]; output: number }[];
  scoreConstructorQualifyingProgression: {
    input: [number, number];
    output: number;
  }[];
  scorePitstopTime: { input: number; output: number }[];
}

const FIXTURE_URL = new URL("./golden-fixtures/scoring.json", import.meta.url);
const FIXTURE_PATH = fileURLToPath(FIXTURE_URL);

function repoRoot(): string {
  // Test runs from frontend/; repo root is one level up.
  return path.resolve(fileURLToPath(new URL("../../../../..", import.meta.url)));
}

function regenerate(): void {
  const script = path.join(repoRoot(), "backend", "scripts", "generate_golden_fixtures.py");
  execSync(`python "${script}"`, {
    cwd: repoRoot(),
    stdio: "pipe",
  });
}

let fixture: Fixture;

beforeAll(() => {
  if (process.env.GOLDEN_SKIP_PYTHON !== "1") {
    regenerate();
  }
  fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf-8")) as Fixture;
});

describe("scoring constants — Python ≡ TypeScript", () => {
  test("every constant matches", () => {
    // Normalise: Python dicts with int keys become string-keyed in JSON; TS
    // Record<number, number> uses numeric keys but JSON serializes them as
    // strings too. Compare via JSON round-trip for lookup-table equality.
    const tsConstants: Record<string, unknown> = {
      QUALI_POINTS: JSON.parse(JSON.stringify(tsScoring.QUALI_POINTS)),
      QUALI_NC_DSQ_PENALTY: tsScoring.QUALI_NC_DSQ_PENALTY,
      SPRINT_QUALI_POINTS: JSON.parse(JSON.stringify(tsScoring.SPRINT_QUALI_POINTS)),
      RACE_POINTS: JSON.parse(JSON.stringify(tsScoring.RACE_POINTS)),
      SPRINT_POINTS: JSON.parse(JSON.stringify(tsScoring.SPRINT_POINTS)),
      FASTEST_LAP_PTS: tsScoring.FASTEST_LAP_PTS,
      DRIVER_OF_THE_DAY_PTS: tsScoring.DRIVER_OF_THE_DAY_PTS,
      POSITIONS_CHANGE_MULTIPLIER: tsScoring.POSITIONS_CHANGE_MULTIPLIER,
      OVERTAKE_PTS: tsScoring.OVERTAKE_PTS,
      BEAT_TEAMMATE_PTS: tsScoring.BEAT_TEAMMATE_PTS,
      RACE_DNF_PENALTY: tsScoring.RACE_DNF_PENALTY,
      SPRINT_DNF_PENALTY: tsScoring.SPRINT_DNF_PENALTY,
      Q2_CUTOFF: tsScoring.Q2_CUTOFF,
      Q3_CUTOFF: tsScoring.Q3_CUTOFF,
      FASTEST_PITSTOP_BONUS: tsScoring.FASTEST_PITSTOP_BONUS,
    };
    expect(tsConstants).toEqual(fixture.constants);
  });
});

describe("scoreQualifyingDriver", () => {
  test.each(getCases("scoreQualifyingDriver"))(
    "position=$input → $output",
    ({ input, output }) => {
      expect(tsScoring.scoreQualifyingDriver(input)).toBe(output);
    }
  );
});

describe("scoreSprintQualifyingDriver", () => {
  test.each(getCases("scoreSprintQualifyingDriver"))(
    "position=$input → $output",
    ({ input, output }) => {
      expect(tsScoring.scoreSprintQualifyingDriver(input)).toBe(output);
    }
  );
});

describe("scoreRacePosition", () => {
  test.each(getCases("scoreRacePosition"))(
    "position=$input → $output",
    ({ input, output }) => {
      expect(tsScoring.scoreRacePosition(input)).toBe(output);
    }
  );
});

describe("scoreSprintPosition", () => {
  test.each(getCases("scoreSprintPosition"))(
    "position=$input → $output",
    ({ input, output }) => {
      expect(tsScoring.scoreSprintPosition(input)).toBe(output);
    }
  );
});

describe("scorePositionsChanged (484 cases)", () => {
  test("all pairs match Python", () => {
    for (const { input, output } of fixture.scorePositionsChanged) {
      const [gridPos, finishPos] = input;
      const actual = tsScoring.scorePositionsChanged(gridPos, finishPos);
      if (actual !== output) {
        throw new Error(
          `scorePositionsChanged(${gridPos}, ${finishPos}) → ${actual}, expected ${output}`
        );
      }
    }
  });
});

describe("scoreConstructorQualifyingProgression (484 cases)", () => {
  test("all pairs match Python", () => {
    for (const { input, output } of fixture.scoreConstructorQualifyingProgression) {
      const [p1, p2] = input;
      const actual = tsScoring.scoreConstructorQualifyingProgression(p1, p2);
      if (actual !== output) {
        throw new Error(
          `scoreConstructorQualifyingProgression(${p1}, ${p2}) → ${actual}, expected ${output}`
        );
      }
    }
  });
});

describe("scorePitstopTime (121 cases — every 0.05s boundary)", () => {
  test("all times match Python", () => {
    for (const { input, output } of fixture.scorePitstopTime) {
      const actual = tsScoring.scorePitstopTime(input);
      if (actual !== output) {
        throw new Error(
          `scorePitstopTime(${input}) → ${actual}, expected ${output}`
        );
      }
    }
  });
});

// Helper used by test.each — fixture is only populated inside beforeAll, so
// we fall back to reading the file synchronously at collection time.
function getCases<K extends keyof Fixture>(
  key: K
): Array<{ input: number; output: number }> {
  const raw = JSON.parse(readFileSync(FIXTURE_PATH, "utf-8")) as Fixture;
  return raw[key] as Array<{ input: number; output: number }>;
}
