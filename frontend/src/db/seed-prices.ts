/**
 * Opening-day fantasy_prices seed.
 *
 * Reads backend/data/seed_data.json and writes one row per (driver, constructor)
 * into fantasy_prices with the static opening-day price.
 *
 * Clean-slate semantics: deletes ALL existing fantasy_prices rows first, then
 * inserts the 33 rows. This is safe because fantasy_prices lacks a natural
 * unique key (multiple rows accumulate over time as prices shift) and this
 * script is for initial season setup.
 *
 * Run:  cd frontend && npm run db:seed-prices
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import { readFileSync } from "node:fs";
import path from "node:path";

import { db } from "./index";
import { constructors, drivers, fantasyPrices } from "./schema";

interface SeedDriver {
  code: string;
  price: number;
}
interface SeedConstructor {
  id: string; // maps to constructors.ref_id
  price: number;
}
interface SeedFile {
  drivers: SeedDriver[];
  constructors: SeedConstructor[];
}

function loadSeed(): SeedFile {
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

async function main(): Promise<void> {
  const seed = loadSeed();

  // Build lookup maps from current DB state
  const driverRows = await db
    .select({ id: drivers.id, code: drivers.code })
    .from(drivers);
  const driverIdByCode = new Map(driverRows.map((d) => [d.code, d.id]));

  const ctorRows = await db
    .select({ id: constructors.id, refId: constructors.refId })
    .from(constructors);
  const ctorIdByRef = new Map(ctorRows.map((c) => [c.refId, c.id]));

  // Build inserts, warning on any missing FK
  const inserts: Array<typeof fantasyPrices.$inferInsert> = [];
  let skippedDrivers = 0;
  let skippedCtors = 0;

  for (const d of seed.drivers) {
    const id = driverIdByCode.get(d.code);
    if (id === undefined) {
      console.warn(`[seed-prices] driver code "${d.code}" not in DB — skipped`);
      skippedDrivers++;
      continue;
    }
    inserts.push({
      assetType: "driver",
      assetId: id,
      raceId: null,
      price: d.price,
      priceChange: 0,
    });
  }

  for (const c of seed.constructors) {
    const id = ctorIdByRef.get(c.id);
    if (id === undefined) {
      console.warn(
        `[seed-prices] constructor ref "${c.id}" not in DB — skipped`
      );
      skippedCtors++;
      continue;
    }
    inserts.push({
      assetType: "constructor",
      assetId: id,
      raceId: null,
      price: c.price,
      priceChange: 0,
    });
  }

  // Clean-slate: wipe + reinsert
  await db.delete(fantasyPrices);
  if (inserts.length > 0) {
    await db.insert(fantasyPrices).values(inserts);
  }

  const nDrivers = inserts.filter((r) => r.assetType === "driver").length;
  const nCtors = inserts.filter((r) => r.assetType === "constructor").length;
  console.log(
    `[seed-prices] drivers: ${nDrivers}, constructors: ${nCtors}, total: ${inserts.length}` +
      (skippedDrivers + skippedCtors > 0
        ? ` (skipped: ${skippedDrivers} drivers + ${skippedCtors} constructors)`
        : "")
  );
}

main().catch((err: unknown) => {
  console.error("[seed-prices] failed:", err);
  process.exit(1);
});
