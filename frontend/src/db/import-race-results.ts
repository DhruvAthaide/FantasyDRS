/**
 * Import race results from committed F1 data artifacts into Neon.
 *
 * Reads `frontend/data/f1/_index.json` for the list of available rounds,
 * loads each `results.json`, resolves FKs (race_id via races.round,
 * driver_id via drivers.code), and upserts into `race_results` keyed on
 * the composite unique `(race_id, driver_id)` index.
 *
 * Run:  npm run db:import-results
 *
 * Exit: 0 on success (even if zero rows were imported — empty is valid when
 *       the upstream data sources haven't published the race yet).
 *       1 on validation failure (malformed artifact, unreachable DB).
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";

import { db } from "./index";
import { drivers, races, raceResults, type NewRaceResult } from "./schema";

// ---------------------------------------------------------------------------
// Artifact shapes (must match backend/scripts/refresh_race_data.py writers
// and the TS interfaces defined in 02-01-RESEARCH.md §4.3)
// ---------------------------------------------------------------------------
interface RaceResultRow {
  driver_code: string;
  position: number | null;
  classified_position: string | null;
  grid_position: number | null;
  status: string;
  fastest_lap_rank: number | null;
}

interface RaceResultsArtifact {
  year: number;
  round: number;
  event_name: string;
  results: RaceResultRow[];
}

interface IndexEntry {
  year: number;
  round: number;
  event_name: string;
  folder: string;
  fetched_at: string;
  source: string;
  notes: string | null;
}

interface IndexFile {
  rounds: IndexEntry[];
}

// ---------------------------------------------------------------------------
// Runtime type guards (hand-rolled — no Zod dep)
// ---------------------------------------------------------------------------
function isRaceResultsArtifact(x: unknown): x is RaceResultsArtifact {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.year === "number" &&
    typeof o.round === "number" &&
    typeof o.event_name === "string" &&
    Array.isArray(o.results)
  );
}

function isIndexFile(x: unknown): x is IndexFile {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return Array.isArray(o.rounds);
}

// ---------------------------------------------------------------------------
// Data root resolution
// ---------------------------------------------------------------------------
function dataRoot(): string {
  // Script runs from frontend/ — data/f1/** is sibling to src/
  return path.resolve(process.cwd(), "data", "f1");
}

// ---------------------------------------------------------------------------
// Import one round
// ---------------------------------------------------------------------------
async function importRound(
  entry: IndexEntry
): Promise<{ round: number; imported: number; skipped_rows: number }> {
  const resultsPath = path.join(
    dataRoot(),
    String(entry.year),
    entry.folder,
    "results.json"
  );

  if (!existsSync(resultsPath)) {
    console.warn(`[import] skip round ${entry.round}: ${resultsPath} missing`);
    return { round: entry.round, imported: 0, skipped_rows: 0 };
  }

  const raw = readFileSync(resultsPath, "utf-8");
  const parsed: unknown = JSON.parse(raw);
  if (!isRaceResultsArtifact(parsed)) {
    throw new Error(
      `[import] ${resultsPath} does not match RaceResultsArtifact shape`
    );
  }

  if (parsed.results.length === 0) {
    console.log(
      `[import] round ${entry.round} (${entry.event_name}): 0 rows in artifact — ok`
    );
    return { round: entry.round, imported: 0, skipped_rows: 0 };
  }

  // Resolve race_id via round number
  const raceRows = await db
    .select({ id: races.id })
    .from(races)
    .where(eq(races.round, entry.round))
    .limit(1);
  if (raceRows.length === 0) {
    throw new Error(
      `[import] round ${entry.round} not present in races table — seed the calendar first`
    );
  }
  const raceId = raceRows[0].id;

  // Build code → driver_id lookup once per round
  const driverRows = await db
    .select({ id: drivers.id, code: drivers.code })
    .from(drivers);
  const codeToId = new Map(driverRows.map((d) => [d.code, d.id]));

  const toInsert: NewRaceResult[] = [];
  let skipped = 0;
  for (const row of parsed.results) {
    const driverId = codeToId.get(row.driver_code);
    if (driverId === undefined) {
      console.warn(
        `[import] round ${entry.round}: unknown driver_code "${row.driver_code}" — row skipped`
      );
      skipped++;
      continue;
    }

    const statusUpper = row.status?.toUpperCase() ?? "";
    const isDnf =
      statusUpper === "DNF" ||
      statusUpper === "DNS" ||
      statusUpper === "DSQ" ||
      (statusUpper !== "FINISHED" && statusUpper.length > 0 && !statusUpper.startsWith("+"));

    const grid = row.grid_position ?? null;
    const finish = row.position ?? null;
    const overtakes =
      grid !== null && finish !== null && !isDnf
        ? Math.max(0, grid - finish)
        : 0;

    toInsert.push({
      raceId,
      driverId,
      qualifyingPosition: grid,
      racePosition: finish,
      dnf: isDnf,
      fastestLap: row.fastest_lap_rank === 1,
      dotd: false,
      overtakes,
    });
  }

  if (toInsert.length === 0) {
    return { round: entry.round, imported: 0, skipped_rows: skipped };
  }

  const inserted = await db
    .insert(raceResults)
    .values(toInsert)
    .onConflictDoUpdate({
      target: [raceResults.raceId, raceResults.driverId],
      set: {
        qualifyingPosition: sql`excluded.qualifying_position`,
        racePosition: sql`excluded.race_position`,
        dnf: sql`excluded.dnf`,
        fastestLap: sql`excluded.fastest_lap`,
        dotd: sql`excluded.dotd`,
        overtakes: sql`excluded.overtakes`,
      },
    })
    .returning({ id: raceResults.id });

  return { round: entry.round, imported: inserted.length, skipped_rows: skipped };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const indexPath = path.join(dataRoot(), "_index.json");
  if (!existsSync(indexPath)) {
    console.log(`[import] no _index.json at ${indexPath} — nothing to import`);
    return;
  }

  const parsed: unknown = JSON.parse(readFileSync(indexPath, "utf-8"));
  if (!isIndexFile(parsed)) {
    throw new Error(`[import] _index.json at ${indexPath} is malformed`);
  }

  if (parsed.rounds.length === 0) {
    console.log("[import] _index.json has zero rounds — nothing to import");
    return;
  }

  let totalRaces = 0;
  let totalImported = 0;
  let totalSkipped = 0;
  for (const entry of parsed.rounds) {
    const { imported, skipped_rows } = await importRound(entry);
    if (imported > 0) totalRaces++;
    totalImported += imported;
    totalSkipped += skipped_rows;
  }

  console.log(
    `[import] imported: ${totalImported} results across ${totalRaces} races` +
      (totalSkipped > 0 ? ` (${totalSkipped} rows skipped)` : "")
  );
}

main().catch((err: unknown) => {
  console.error("[import] failed:", err);
  process.exit(1);
});
