/**
 * Seed loader — reads backend/data/seed_data.json and populates:
 *   constructors → drivers → circuits → races
 *
 * Idempotency strategy:
 *   - constructors: ON CONFLICT (ref_id) DO UPDATE
 *   - drivers:      ON CONFLICT (code)   DO UPDATE
 *   - circuits:     no natural unique index (name+country may be ambiguous);
 *                   fall back to find-or-create by name
 *   - races:        ON CONFLICT (round)  DO UPDATE (races_round_unique idx)
 *
 * FK wiring:
 *   - drivers.constructor_id ← lookup by constructor.ref_id
 *   - races.circuit_id       ← lookup by circuit.name
 *
 * Scope: initial fantasy_prices / fantasy_scores population is intentionally
 * out of scope for plan 01-01. This script seeds reference data only.
 */
import { config as loadEnv } from "dotenv";
// Load .env.local first (gitignored local creds), then .env as fallback.
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import { readFileSync } from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";

import { db } from "./index";
import {
  constructors,
  drivers,
  circuits,
  races,
  type NewConstructor,
  type NewDriver,
  type NewCircuit,
  type NewRace,
} from "./schema";

// ---------------------------------------------------------------------------
// Input shape (reflects backend/data/seed_data.json)
// ---------------------------------------------------------------------------
type SeedConstructor = {
  id: string; // maps to constructors.ref_id
  name: string;
  price: number;
  drivers: string[];
  color?: string;
};

type SeedDriver = {
  code: string;
  first_name: string;
  last_name: string;
  number?: number;
  team_id: string; // FK → constructors.ref_id
  country?: string;
  price: number;
};

type SeedCalendarEntry = {
  round: number;
  name: string;
  circuit: string;
  country?: string;
  date?: string;
  sprint?: boolean;
  overtake_difficulty?: number;
  high_speed?: number;
  street_circuit?: boolean;
  altitude?: number;
  avg_degradation?: number;
  laps?: number;
  drs_zones?: number;
};

type SeedFile = {
  constructors: SeedConstructor[];
  drivers: SeedDriver[];
  calendar: SeedCalendarEntry[];
};

// ---------------------------------------------------------------------------
// Locate seed file — repo-root relative, same regardless of where seed is run
// ---------------------------------------------------------------------------
function loadSeedFile(): SeedFile {
  const seedPath = path.resolve(
    process.cwd(),
    "..",
    "backend",
    "data",
    "seed_data.json"
  );
  const raw = readFileSync(seedPath, "utf-8");
  return JSON.parse(raw) as SeedFile;
}

// ---------------------------------------------------------------------------
// Upsert helpers — sequential inside the seeding flow so FKs resolve cleanly
// ---------------------------------------------------------------------------
async function upsertConstructors(data: SeedConstructor[]): Promise<number> {
  const rows: NewConstructor[] = data.map((c) => ({
    refId: c.id,
    name: c.name,
    color: c.color ?? null,
  }));

  const result = await db
    .insert(constructors)
    .values(rows)
    .onConflictDoUpdate({
      target: constructors.refId,
      set: {
        name: sql`excluded.name`,
        color: sql`excluded.color`,
      },
    })
    .returning({ id: constructors.id });

  return result.length;
}

async function upsertDrivers(data: SeedDriver[]): Promise<number> {
  // Build ref_id → id map for FK wiring.
  const existingConstructors = await db
    .select({ id: constructors.id, refId: constructors.refId })
    .from(constructors);
  const refToId = new Map(existingConstructors.map((r) => [r.refId, r.id]));

  const rows: NewDriver[] = data.map((d) => {
    const constructorId = refToId.get(d.team_id);
    if (constructorId === undefined) {
      throw new Error(
        `[seed] Driver ${d.code} references unknown team_id "${d.team_id}"`
      );
    }
    return {
      code: d.code,
      firstName: d.first_name,
      lastName: d.last_name,
      number: d.number ?? null,
      constructorId,
      country: d.country ?? null,
    };
  });

  const result = await db
    .insert(drivers)
    .values(rows)
    .onConflictDoUpdate({
      target: drivers.code,
      set: {
        firstName: sql`excluded.first_name`,
        lastName: sql`excluded.last_name`,
        number: sql`excluded.number`,
        constructorId: sql`excluded.constructor_id`,
        country: sql`excluded.country`,
      },
    })
    .returning({ id: drivers.id });

  return result.length;
}

/**
 * Circuits come embedded in the calendar entries. Deduplicate by circuit
 * name (the natural key in the seed source), then find-or-create each.
 * No unique index on (name, country) — rely on a serialized lookup loop.
 */
async function upsertCircuits(
  calendar: SeedCalendarEntry[]
): Promise<Map<string, number>> {
  const unique = new Map<string, SeedCalendarEntry>();
  for (const entry of calendar) {
    if (!unique.has(entry.circuit)) unique.set(entry.circuit, entry);
  }

  const nameToId = new Map<string, number>();
  for (const [name, entry] of unique) {
    const existing = await db
      .select({ id: circuits.id })
      .from(circuits)
      .where(eq(circuits.name, name))
      .limit(1);

    if (existing[0]) {
      // Update mutable traits so the seed stays authoritative on re-run.
      await db
        .update(circuits)
        .set({
          country: entry.country ?? null,
          overtakeDifficulty: entry.overtake_difficulty ?? 0.5,
          highSpeed: entry.high_speed ?? 0.5,
          streetCircuit: entry.street_circuit ?? false,
          altitude: entry.altitude ?? 0,
          avgDegradation: entry.avg_degradation ?? 0.5,
        })
        .where(eq(circuits.id, existing[0].id));
      nameToId.set(name, existing[0].id);
      continue;
    }

    const row: NewCircuit = {
      name,
      country: entry.country ?? null,
      overtakeDifficulty: entry.overtake_difficulty ?? 0.5,
      highSpeed: entry.high_speed ?? 0.5,
      streetCircuit: entry.street_circuit ?? false,
      altitude: entry.altitude ?? 0,
      avgDegradation: entry.avg_degradation ?? 0.5,
    };
    const inserted = await db
      .insert(circuits)
      .values(row)
      .returning({ id: circuits.id });
    nameToId.set(name, inserted[0].id);
  }

  return nameToId;
}

async function upsertRaces(
  calendar: SeedCalendarEntry[],
  circuitNameToId: Map<string, number>
): Promise<number> {
  const rows: NewRace[] = calendar.map((r) => {
    const circuitId = circuitNameToId.get(r.circuit);
    if (circuitId === undefined) {
      throw new Error(
        `[seed] Race round ${r.round} references unknown circuit "${r.circuit}"`
      );
    }
    return {
      round: r.round,
      name: r.name,
      circuitId,
      date: r.date ?? null,
      hasSprint: r.sprint ?? false,
      laps: r.laps ?? 57,
      drsZones: r.drs_zones ?? 3,
    };
  });

  const result = await db
    .insert(races)
    .values(rows)
    .onConflictDoUpdate({
      target: races.round,
      set: {
        name: sql`excluded.name`,
        circuitId: sql`excluded.circuit_id`,
        date: sql`excluded.date`,
        hasSprint: sql`excluded.has_sprint`,
        laps: sql`excluded.laps`,
        drsZones: sql`excluded.drs_zones`,
      },
    })
    .returning({ id: races.id });

  return result.length;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const seed = loadSeedFile();

  console.log("[seed] Loading reference data…");
  const constructorCount = await upsertConstructors(seed.constructors);
  console.log(`[seed]   constructors: ${constructorCount}`);

  const driverCount = await upsertDrivers(seed.drivers);
  console.log(`[seed]   drivers:      ${driverCount}`);

  const circuitIdMap = await upsertCircuits(seed.calendar);
  console.log(`[seed]   circuits:     ${circuitIdMap.size}`);

  const raceCount = await upsertRaces(seed.calendar, circuitIdMap);
  console.log(`[seed]   races:        ${raceCount}`);

  console.log("[seed] Done.");
}

main().catch((err: unknown) => {
  console.error("[seed] Failed:", err);
  process.exit(1);
});
