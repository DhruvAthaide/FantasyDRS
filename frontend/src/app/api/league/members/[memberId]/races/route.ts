/**
 * GET /api/league/members/[memberId]/races — public
 *
 * List every race in the calendar alongside this member's team (if set) and
 * score (if entered).
 */
import { asc, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { db } from "@/db";
import {
  leagueMembers,
  memberRaceScores,
  memberRaceTeams,
  races,
} from "@/db/schema";
import {
  BadRequestError,
  withRouteErrorHandler,
} from "@/lib/api-helpers";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ memberId: string }> }
) {
  return withRouteErrorHandler(async () => {
    const { memberId } = await params;
    const id = parseInt(memberId, 10);
    if (!Number.isFinite(id) || id <= 0) {
      throw new BadRequestError("invalid memberId");
    }

    const [memberRow] = await db
      .select()
      .from(leagueMembers)
      .where(eq(leagueMembers.id, id))
      .limit(1);
    if (!memberRow) throw new BadRequestError("member not found");

    const [calendar, teams, scores] = await Promise.all([
      db.select().from(races).orderBy(asc(races.round)),
      db
        .select()
        .from(memberRaceTeams)
        .where(eq(memberRaceTeams.memberId, id)),
      db
        .select()
        .from(memberRaceScores)
        .where(eq(memberRaceScores.memberId, id)),
    ]);

    const teamByRaceId = new Map<number, (typeof teams)[number]>();
    for (const t of teams) teamByRaceId.set(t.raceId, t);
    const scoreByRaceId = new Map<number, (typeof scores)[number]>();
    for (const s of scores) scoreByRaceId.set(s.raceId, s);

    const result = calendar.map((race) => {
      const t = teamByRaceId.get(race.id);
      const s = scoreByRaceId.get(race.id);
      return {
        race_id: race.id,
        race_round: race.round,
        race_name: race.name,
        race_date: race.date,
        team: t
          ? {
              driver_ids: t.driverIds,
              constructor_ids: t.constructorIds,
              drs_driver_id: t.drsDriverId,
              updated_at: t.updatedAt?.toISOString() ?? null,
            }
          : null,
        score: s
          ? {
              points: s.points,
              notes: s.notes,
              updated_at: s.updatedAt?.toISOString() ?? null,
            }
          : null,
      };
    });

    return {
      member: { id: memberRow.id, name: memberRow.name },
      races: result,
    };
  });
}
