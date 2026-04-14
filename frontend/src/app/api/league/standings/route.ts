/**
 * GET /api/league/standings — public
 *
 * Returns league-wide standings + per-race breakdown.
 */
import { asc } from "drizzle-orm";

import { db } from "@/db";
import { leagueMembers, memberRaceScores, races } from "@/db/schema";
import { withRouteErrorHandler } from "@/lib/api-helpers";

export async function GET() {
  return withRouteErrorHandler(async () => {
    const [members, scores, calendar] = await Promise.all([
      db.select().from(leagueMembers).orderBy(asc(leagueMembers.id)),
      db.select().from(memberRaceScores),
      db.select().from(races).orderBy(asc(races.round)),
    ]);

    const totalByMember = new Map<number, number>();
    const countByMember = new Map<number, number>();
    const perMemberPerRace = new Map<number, Map<number, number>>();

    for (const s of scores) {
      totalByMember.set(
        s.memberId,
        (totalByMember.get(s.memberId) ?? 0) + s.points
      );
      countByMember.set(s.memberId, (countByMember.get(s.memberId) ?? 0) + 1);
      let raceMap = perMemberPerRace.get(s.raceId);
      if (!raceMap) {
        raceMap = new Map<number, number>();
        perMemberPerRace.set(s.raceId, raceMap);
      }
      raceMap.set(s.memberId, s.points);
    }

    const memberRows = members
      .map((m) => ({
        member_id: m.id,
        name: m.name,
        total_points: Math.round((totalByMember.get(m.id) ?? 0) * 100) / 100,
        race_count: countByMember.get(m.id) ?? 0,
      }))
      .sort((a, b) => b.total_points - a.total_points);

    const raceRows = calendar.map((r) => {
      const raceMap = perMemberPerRace.get(r.id);
      const perMember: Record<number, number> = {};
      if (raceMap) {
        for (const [mId, pts] of raceMap) perMember[mId] = pts;
      }
      return {
        race_id: r.id,
        round: r.round,
        name: r.name,
        date: r.date,
        per_member: perMember,
      };
    });

    return {
      members: memberRows,
      races: raceRows,
    };
  });
}
