/**
 * GET /api/fixtures/difficulty?asset_type=driver|constructor
 * Ported from backend/app/routers/fixtures.py — heuristic difficulty score
 * per (driver|constructor × race) pair.
 *
 * Formulas preserved exactly from Python; test coverage on this comes via
 * Phase 6 UAT rather than Phase 3's golden harness.
 */
import { asc, desc, eq, and } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/db";
import {
  drivers,
  constructors,
  circuits,
  races,
  fantasyPrices,
} from "@/db/schema";
import { queryParam, withRouteErrorHandler } from "@/lib/api-helpers";
import type {
  FixtureDifficultyEntry,
  FixtureDifficultyRow,
} from "@/lib/api-types";

// ---------------------------------------------------------------------------
// Price + strength helpers (port of fixtures.py helpers)
// ---------------------------------------------------------------------------
async function getAssetPrice(
  assetType: "driver" | "constructor",
  assetId: number
): Promise<number> {
  const row = await db
    .select({ price: fantasyPrices.price })
    .from(fantasyPrices)
    .where(
      and(
        eq(fantasyPrices.assetType, assetType),
        eq(fantasyPrices.assetId, assetId)
      )
    )
    .orderBy(desc(fantasyPrices.id))
    .limit(1);
  return row.length > 0 ? row[0].price : 10.0;
}

function priceToStrength(
  price: number,
  minPrice: number,
  maxPrice: number
): number {
  if (maxPrice === minPrice) return 0.5;
  return (price - minPrice) / (maxPrice - minPrice);
}

// ---------------------------------------------------------------------------
// Per-asset-type difficulty functions (mirror Python exactly)
// ---------------------------------------------------------------------------
type CircuitRow = typeof circuits.$inferSelect;

function circuitDifficultyForDriver(
  strength: number,
  circuit: CircuitRow
): number {
  const ot = circuit.overtakeDifficulty ?? 0.5;
  const street = circuit.streetCircuit ? 1.0 : 0.0;
  const deg = circuit.avgDegradation ?? 0.5;

  const otFactor = strength > 0.6 ? 1 - ot * 0.5 : ot * 0.8;
  const streetFactor = street * (strength > 0.6 ? 0.3 : 0.5);
  const degFactor = deg * (strength > 0.6 ? 0.2 : 0.4);

  const raw = otFactor * 0.5 + streetFactor * 0.25 + degFactor * 0.25;
  return Math.max(0, Math.min(1, raw));
}

function circuitDifficultyForConstructor(
  strength: number,
  circuit: CircuitRow
): number {
  const ot = circuit.overtakeDifficulty ?? 0.5;
  const hs = circuit.highSpeed ?? 0.5;
  const deg = circuit.avgDegradation ?? 0.5;

  const hsFactor = strength > 0.6 ? 1 - hs * 0.4 : hs * 0.3;
  const otFactor = ot * (strength > 0.6 ? 0.3 : 0.6);
  const degFactor = deg * (strength > 0.6 ? 0.2 : 0.4);

  const raw = otFactor * 0.4 + hsFactor * 0.3 + degFactor * 0.3;
  return Math.max(0, Math.min(1, raw));
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  const assetType = queryParam(request, "asset_type") ?? "driver";
  if (assetType !== "driver" && assetType !== "constructor") {
    return NextResponse.json(
      { error: "Invalid asset_type (must be 'driver' or 'constructor')" },
      { status: 400 }
    );
  }

  return withRouteErrorHandler(async () => {
    // Races ordered by round + their circuits
    const raceRows = await db.select().from(races).orderBy(asc(races.round));
    const circuitById = new Map<number, CircuitRow>();
    for (const r of raceRows) {
      if (r.circuitId !== null && !circuitById.has(r.circuitId)) {
        const c = await db
          .select()
          .from(circuits)
          .where(eq(circuits.id, r.circuitId))
          .limit(1);
        if (c.length > 0) circuitById.set(r.circuitId, c[0]);
      }
    }

    const rows: FixtureDifficultyRow[] = [];

    if (assetType === "driver") {
      const allDrivers = await db.select().from(drivers);
      if (allDrivers.length === 0) return rows;

      const prices = new Map<number, number>();
      for (const d of allDrivers) {
        prices.set(d.id, await getAssetPrice("driver", d.id));
      }
      const values = [...prices.values()];
      const minP = Math.min(...values);
      const maxP = Math.max(...values);

      for (const driver of allDrivers) {
        const strength = priceToStrength(prices.get(driver.id)!, minP, maxP);

        let color = "#6b7280";
        if (driver.constructorId !== null) {
          const c = await db
            .select({ color: constructors.color })
            .from(constructors)
            .where(eq(constructors.id, driver.constructorId))
            .limit(1);
          if (c.length > 0 && c[0].color) color = c[0].color;
        }

        const fixtures: FixtureDifficultyEntry[] = [];
        for (const race of raceRows) {
          if (race.circuitId === null) continue;
          const circuit = circuitById.get(race.circuitId);
          if (!circuit) continue;
          const diff = circuitDifficultyForDriver(strength, circuit);
          fixtures.push({
            race_id: race.id,
            race_name: race.name,
            race_round: race.round,
            difficulty: round3(diff),
          });
        }

        rows.push({
          asset_type: "driver",
          asset_id: driver.id,
          asset_name: driver.code,
          color,
          fixtures,
        });
      }
    } else {
      const allCtors = await db.select().from(constructors);
      if (allCtors.length === 0) return rows;

      const prices = new Map<number, number>();
      for (const c of allCtors) {
        prices.set(c.id, await getAssetPrice("constructor", c.id));
      }
      const values = [...prices.values()];
      const minP = Math.min(...values);
      const maxP = Math.max(...values);

      for (const c of allCtors) {
        const strength = priceToStrength(prices.get(c.id)!, minP, maxP);
        const color = c.color ?? "#6b7280";

        const fixtures: FixtureDifficultyEntry[] = [];
        for (const race of raceRows) {
          if (race.circuitId === null) continue;
          const circuit = circuitById.get(race.circuitId);
          if (!circuit) continue;
          const diff = circuitDifficultyForConstructor(strength, circuit);
          fixtures.push({
            race_id: race.id,
            race_name: race.name,
            race_round: race.round,
            difficulty: round3(diff),
          });
        }

        rows.push({
          asset_type: "constructor",
          asset_id: c.id,
          asset_name: c.name,
          color,
          fixtures,
        });
      }
    }

    return rows;
  });
}
