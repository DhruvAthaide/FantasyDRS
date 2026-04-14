/**
 * POST /api/transfers/suggest — top-15 single-swap suggestions.
 * Ported from backend/app/routers/transfers.py.
 */
import { and, desc, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { db } from "@/db";
import {
  constructors,
  drivers,
  fantasyPrices,
  simulationResults,
} from "@/db/schema";
import {
  parseJsonBody,
  withRouteErrorHandler,
} from "@/lib/api-helpers";
import type { SwapSuggestion, TransferRequest } from "@/lib/api-types";

function isTransferRequest(x: unknown): x is TransferRequest {
  if (x === null || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    Array.isArray(o.driver_ids) &&
    Array.isArray(o.constructor_ids) &&
    typeof o.drs_driver_id === "number" &&
    typeof o.race_id === "number"
  );
}

async function simPts(
  assetType: "driver" | "constructor",
  assetId: number,
  raceId: number
): Promise<number> {
  const row = await db
    .select({ mean: simulationResults.expectedPtsMean })
    .from(simulationResults)
    .where(
      and(
        eq(simulationResults.assetType, assetType),
        eq(simulationResults.assetId, assetId),
        eq(simulationResults.raceId, raceId)
      )
    )
    .orderBy(desc(simulationResults.id))
    .limit(1);
  return row[0]?.mean ?? 0;
}

async function priceOf(
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
  return row[0]?.price ?? 0;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

export async function POST(request: NextRequest) {
  return withRouteErrorHandler(async () => {
    const body = await parseJsonBody<TransferRequest>(request, isTransferRequest);
    const budget = body.budget ?? 100.0;

    const allDrivers = await db.select().from(drivers);
    const allCtors = await db.select().from(constructors);

    // Current team total cost
    let currentCost = 0;
    for (const did of body.driver_ids) currentCost += await priceOf("driver", did);
    for (const cid of body.constructor_ids)
      currentCost += await priceOf("constructor", cid);

    const suggestions: SwapSuggestion[] = [];

    // Driver swaps
    for (const outId of body.driver_ids) {
      const outPts = await simPts("driver", outId, body.race_id);
      const outPrice = await priceOf("driver", outId);
      const outDriverRow = allDrivers.find((d) => d.id === outId);
      const outCtor =
        outDriverRow?.constructorId !== null && outDriverRow?.constructorId !== undefined
          ? allCtors.find((c) => c.id === outDriverRow.constructorId)
          : undefined;

      for (const cand of allDrivers) {
        if (body.driver_ids.includes(cand.id)) continue;
        const inPts = await simPts("driver", cand.id, body.race_id);
        const inPrice = await priceOf("driver", cand.id);
        const newCost = currentCost - outPrice + inPrice;
        if (newCost > budget) continue;

        const effectiveOut =
          outId === body.drs_driver_id ? outPts * 2 : outPts;
        const effectiveIn = inPts;
        const pointsGained = effectiveIn - effectiveOut;

        const inCtor =
          cand.constructorId !== null
            ? allCtors.find((c) => c.id === cand.constructorId)
            : undefined;

        suggestions.push({
          swap_type: "driver",
          out_id: outId,
          out_name: outDriverRow?.code ?? "?",
          out_color: outCtor?.color ?? "#6b7280",
          out_points: round2(effectiveOut),
          in_id: cand.id,
          in_name: cand.code,
          in_color: inCtor?.color ?? "#6b7280",
          in_points: round2(effectiveIn),
          points_gained: round2(pointsGained),
          cost_delta: round2(inPrice - outPrice),
        });
      }
    }

    // Constructor swaps
    for (const outId of body.constructor_ids) {
      const outPts = await simPts("constructor", outId, body.race_id);
      const outPrice = await priceOf("constructor", outId);
      const outCtor = allCtors.find((c) => c.id === outId);

      for (const cand of allCtors) {
        if (body.constructor_ids.includes(cand.id)) continue;
        const inPts = await simPts("constructor", cand.id, body.race_id);
        const inPrice = await priceOf("constructor", cand.id);
        const newCost = currentCost - outPrice + inPrice;
        if (newCost > budget) continue;

        suggestions.push({
          swap_type: "constructor",
          out_id: outId,
          out_name: outCtor?.name ?? "?",
          out_color: outCtor?.color ?? "#6b7280",
          out_points: round2(outPts),
          in_id: cand.id,
          in_name: cand.name,
          in_color: cand.color ?? "#6b7280",
          in_points: round2(inPts),
          points_gained: round2(inPts - outPts),
          cost_delta: round2(inPrice - outPrice),
        });
      }
    }

    suggestions.sort((a, b) => b.points_gained - a.points_gained);
    return suggestions.slice(0, 15);
  });
}
