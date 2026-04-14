/**
 * PUT /api/league/members/[memberId]/races/[raceId]/team — admin
 * Upsert the member's team for this race.
 */
import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { db } from "@/db";
import { leagueMembers, memberRaceTeams, races } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import {
  BadRequestError,
  parseJsonBody,
  withRouteErrorHandler,
} from "@/lib/api-helpers";

interface TeamBody {
  driver_ids: number[];
  constructor_ids: number[];
  drs_driver_id: number | null;
}

function isTeamBody(x: unknown): x is TeamBody {
  if (x === null || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (!Array.isArray(o.driver_ids)) return false;
  if (!Array.isArray(o.constructor_ids)) return false;
  if (
    o.drs_driver_id !== null &&
    typeof o.drs_driver_id !== "number"
  )
    return false;
  if (!o.driver_ids.every((v) => typeof v === "number")) return false;
  if (!o.constructor_ids.every((v) => typeof v === "number")) return false;
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

    const body = await parseJsonBody<TeamBody>(request, isTeamBody);
    if (body.driver_ids.length !== 5) {
      throw new BadRequestError("driver_ids must have exactly 5 entries");
    }
    if (body.constructor_ids.length !== 2) {
      throw new BadRequestError("constructor_ids must have exactly 2 entries");
    }
    if (
      body.drs_driver_id !== null &&
      !body.driver_ids.includes(body.drs_driver_id)
    ) {
      throw new BadRequestError("drs_driver_id must be one of driver_ids");
    }

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
      .select({ id: memberRaceTeams.id })
      .from(memberRaceTeams)
      .where(
        and(
          eq(memberRaceTeams.memberId, mId),
          eq(memberRaceTeams.raceId, rId)
        )
      )
      .limit(1);

    const values = {
      memberId: mId,
      raceId: rId,
      driverIds: body.driver_ids,
      constructorIds: body.constructor_ids,
      drsDriverId: body.drs_driver_id,
      updatedAt: new Date(),
    };

    if (existing.length > 0) {
      await db
        .update(memberRaceTeams)
        .set(values)
        .where(eq(memberRaceTeams.id, existing[0].id));
    } else {
      await db.insert(memberRaceTeams).values(values);
    }

    return { ok: true };
  });
}
