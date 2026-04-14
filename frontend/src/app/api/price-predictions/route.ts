/**
 * GET /api/price-predictions?race_id=N — PricePrediction[] for all assets.
 * Ported from backend/app/routers/budget.py (Python prefix is /api/price-predictions).
 */
import { and, desc, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { db } from "@/db";
import {
  constructors,
  drivers,
  fantasyPrices,
  fantasyScores,
  simulationResults,
} from "@/db/schema";
import { queryParamInt, withRouteErrorHandler } from "@/lib/api-helpers";
import type { PricePrediction } from "@/lib/api-types";

interface PriceTier {
  great: number;
  good: number;
  poor: number;
  terrible: number;
}

function getPriceTier(price: number): PriceTier {
  if (price >= 25)
    return { great: 1.0, good: 0.3, poor: -0.3, terrible: -1.0 };
  if (price >= 15)
    return { great: 0.6, good: 0.2, poor: -0.2, terrible: -0.6 };
  if (price >= 8)
    return { great: 0.4, good: 0.1, poor: -0.1, terrible: -0.4 };
  return { great: 0.3, good: 0.1, poor: -0.1, terrible: -0.3 };
}

function predictChange(avgPpm: number, price: number): [number, string] {
  const tier = getPriceTier(price);
  if (avgPpm >= 0.4) return [tier.great, "great"];
  if (avgPpm >= 0.3) return [tier.good, "good"];
  if (avgPpm >= 0.2) return [tier.poor, "poor"];
  return [tier.terrible, "terrible"];
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

export async function GET(request: NextRequest) {
  return withRouteErrorHandler(async () => {
    const raceId = queryParamInt(request, "race_id");

    const predictions: PricePrediction[] = [];

    // Drivers
    const allDrivers = await db.select().from(drivers);
    for (const d of allDrivers) {
      const priceRow = await db
        .select({ price: fantasyPrices.price })
        .from(fantasyPrices)
        .where(
          and(
            eq(fantasyPrices.assetType, "driver"),
            eq(fantasyPrices.assetId, d.id)
          )
        )
        .orderBy(desc(fantasyPrices.id))
        .limit(1);
      if (priceRow.length === 0) continue;
      const price = priceRow[0].price;

      const scores = await db
        .select({ total: fantasyScores.totalPts })
        .from(fantasyScores)
        .where(
          and(
            eq(fantasyScores.assetType, "driver"),
            eq(fantasyScores.assetId, d.id)
          )
        )
        .orderBy(desc(fantasyScores.id))
        .limit(3);

      let avgScore = 0;
      if (scores.length > 0) {
        avgScore =
          scores.reduce((a, b) => a + (b.total ?? 0), 0) / scores.length;
      } else if (raceId !== null) {
        const sim = await db
          .select({ mean: simulationResults.expectedPtsMean })
          .from(simulationResults)
          .where(
            and(
              eq(simulationResults.assetType, "driver"),
              eq(simulationResults.assetId, d.id),
              eq(simulationResults.raceId, raceId)
            )
          )
          .orderBy(desc(simulationResults.id))
          .limit(1);
        avgScore = sim[0]?.mean ?? 0;
      }

      const avgPpm = price > 0 ? avgScore / price : 0;
      const [predictedChange, category] = predictChange(avgPpm, price);

      let probInc = 0;
      let probDec = 0;
      if (avgPpm >= 0.3) {
        probInc = Math.min(0.95, 0.5 + (avgPpm - 0.3) * 5);
        probDec = 1 - probInc;
      } else if (avgPpm < 0.2) {
        probDec = Math.min(0.95, 0.5 + (0.2 - avgPpm) * 5);
        probInc = 1 - probDec;
      } else {
        probInc = 0.3;
        probDec = 0.7;
      }

      predictions.push({
        asset_type: "driver",
        asset_id: d.id,
        asset_name: `${d.firstName} ${d.lastName}`,
        current_price: price,
        avg_ppm: round3(avgPpm),
        predicted_change: predictedChange,
        change_category: category,
        probability_increase: round2(probInc),
        probability_decrease: round2(probDec),
      });
    }

    // Constructors
    const allCtors = await db.select().from(constructors);
    for (const c of allCtors) {
      const priceRow = await db
        .select({ price: fantasyPrices.price })
        .from(fantasyPrices)
        .where(
          and(
            eq(fantasyPrices.assetType, "constructor"),
            eq(fantasyPrices.assetId, c.id)
          )
        )
        .orderBy(desc(fantasyPrices.id))
        .limit(1);
      if (priceRow.length === 0) continue;
      const price = priceRow[0].price;

      const scores = await db
        .select({ total: fantasyScores.totalPts })
        .from(fantasyScores)
        .where(
          and(
            eq(fantasyScores.assetType, "constructor"),
            eq(fantasyScores.assetId, c.id)
          )
        )
        .orderBy(desc(fantasyScores.id))
        .limit(3);

      let avgScore = 0;
      if (scores.length > 0) {
        avgScore =
          scores.reduce((a, b) => a + (b.total ?? 0), 0) / scores.length;
      } else if (raceId !== null) {
        const sim = await db
          .select({ mean: simulationResults.expectedPtsMean })
          .from(simulationResults)
          .where(
            and(
              eq(simulationResults.assetType, "constructor"),
              eq(simulationResults.assetId, c.id),
              eq(simulationResults.raceId, raceId)
            )
          )
          .orderBy(desc(simulationResults.id))
          .limit(1);
        avgScore = sim[0]?.mean ?? 0;
      }

      const avgPpm = price > 0 ? avgScore / price : 0;
      const [predictedChange, category] = predictChange(avgPpm, price);

      let probInc = 0;
      let probDec = 0;
      if (avgPpm >= 0.3) {
        probInc = Math.min(0.95, 0.5 + (avgPpm - 0.3) * 5);
        probDec = 1 - probInc;
      } else if (avgPpm < 0.2) {
        probDec = Math.min(0.95, 0.5 + (0.2 - avgPpm) * 5);
        probInc = 1 - probDec;
      } else {
        probInc = 0.3;
        probDec = 0.7;
      }

      predictions.push({
        asset_type: "constructor",
        asset_id: c.id,
        asset_name: c.name,
        current_price: price,
        avg_ppm: round3(avgPpm),
        predicted_change: predictedChange,
        change_category: category,
        probability_increase: round2(probInc),
        probability_decrease: round2(probDec),
      });
    }

    return predictions;
  });
}
