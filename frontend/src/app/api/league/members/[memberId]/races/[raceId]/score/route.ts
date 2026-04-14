/**
 * PUT /api/league/members/[memberId]/races/[raceId]/score — admin
 * Upsert the member's weekly points for this race.
 */
import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { db } from "@/db";
import { leagueMembers, memberRaceScores, races } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import {
  BadRequestError,
  parseJsonBody,
  withRouteErrorHandler,
} from "@/lib/api-helpers";

interface ScoreBody {
  points: number;
  notes?: string | null;
}

function isScoreBody(x: unknown): x is ScoreBody {
  if (x === null || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (typeof o.points !== "number" || !Number.isFinite(o.points)) return false;
  if (
    o.notes !== undefined &&
    o.notes !== null &&
    typeof o.notes !== "string"
  )
    return false;
  return true;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ memberId: string; raceId: string }> }
) {
  return withRouteErrorHandler(async () => {
    await requireAdmin();
    const { memberId, raceId } = await params;
    const mId = parseInt(memberId, 10);
    const rId = parseInt(raceId, 10);
    if (!Number.isFinite(mId) || !Number.isFinite(rId)) {
      throw new BadRequestError("invalid id");
    }

    const body = await parseJsonBody<ScoreBody>(request, isScoreBody);

    const [member] = await db
      .select({ id: leagueMembers.id })
      .from(leagueMembers)
      .where(eq(leagueMembers.id, mId))
      .limit(1);
    if (!member) throw new BadRequestError("member not found");

    const [race] = await db
      .select({ id: races.id })
      .from(races)
      .where(eq(races.id, rId))
      .limit(1);
    if (!race) throw new BadRequestError("race not found");

    const existing = await db
      .select({ id: memberRaceScores.id })
      .from(memberRaceScores)
      .where(
        and(
          eq(memberRaceScores.memberId, mId),
          eq(memberRaceScores.raceId, rId)
        )
      )
      .limit(1);

    const values = {
      memberId: mId,
      raceId: rId,
      points: body.points,
      notes: body.notes ?? null,
      updatedAt: new Date(),
    };

    if (existing.length > 0) {
      await db
        .update(memberRaceScores)
        .set(values)
        .where(eq(memberRaceScores.id, existing[0].id));
    } else {
      await db.insert(memberRaceScores).values(values);
    }

    return { ok: true };
  });
}
