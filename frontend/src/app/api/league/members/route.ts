/**
 * GET  /api/league/members  — public: list members with cumulative points
 * POST /api/league/members  — admin: create member { name }
 */
import { asc, sql } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { db } from "@/db";
import { leagueMembers, memberRaceScores } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import {
  BadRequestError,
  parseJsonBody,
  withRouteErrorHandler,
} from "@/lib/api-helpers";

interface CreateMemberBody {
  name: string;
}

function isCreateMemberBody(x: unknown): x is CreateMemberBody {
  if (x === null || typeof x !== "object") return false;
  return typeof (x as Record<string, unknown>).name === "string";
}

export async function GET() {
  return withRouteErrorHandler(async () => {
    const members = await db
      .select()
      .from(leagueMembers)
      .orderBy(asc(leagueMembers.id));

    const totals = await db
      .select({
        memberId: memberRaceScores.memberId,
        total: sql<number>`COALESCE(SUM(${memberRaceScores.points}), 0)`,
      })
      .from(memberRaceScores)
      .groupBy(memberRaceScores.memberId);

    const totalByMember = new Map<number, number>();
    for (const t of totals) totalByMember.set(t.memberId, Number(t.total));

    const result = members
      .map((m) => ({
        id: m.id,
        name: m.name,
        cumulative_points: totalByMember.get(m.id) ?? 0,
        created_at: m.createdAt?.toISOString() ?? null,
      }))
      .sort((a, b) => b.cumulative_points - a.cumulative_points);

    return result;
  });
}

export async function POST(request: NextRequest) {
  return withRouteErrorHandler(async () => {
    await requireAdmin();
    const body = await parseJsonBody<CreateMemberBody>(request, isCreateMemberBody);
    const name = body.name.trim();
    if (name.length === 0) throw new BadRequestError("name is required");
    if (name.length > 64) throw new BadRequestError("name too long");

    const [row] = await db
      .insert(leagueMembers)
      .values({ name })
      .returning();

    return {
      id: row.id,
      name: row.name,
      cumulative_points: 0,
      created_at: row.createdAt?.toISOString() ?? null,
    };
  });
}

