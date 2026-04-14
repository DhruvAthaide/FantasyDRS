/**
 * PATCH  /api/league/members/[memberId] — admin: rename
 * DELETE /api/league/members/[memberId] — admin: delete (cascades teams + scores)
 */
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { db } from "@/db";
import {
  leagueMembers,
  memberRaceScores,
  memberRaceTeams,
} from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import {
  BadRequestError,
  parseJsonBody,
  withRouteErrorHandler,
} from "@/lib/api-helpers";

interface RenameBody {
  name: string;
}

function isRenameBody(x: unknown): x is RenameBody {
  if (x === null || typeof x !== "object") return false;
  return typeof (x as Record<string, unknown>).name === "string";
}

function parseMemberId(raw: string): number {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new BadRequestError("invalid memberId");
  }
  return n;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ memberId: string }> }
) {
  return withRouteErrorHandler(async () => {
    await requireAdmin();
    const { memberId } = await params;
    const id = parseMemberId(memberId);

    const body = await parseJsonBody<RenameBody>(request, isRenameBody);
    const name = body.name.trim();
    if (name.length === 0) throw new BadRequestError("name is required");
    if (name.length > 64) throw new BadRequestError("name too long");

    const [row] = await db
      .update(leagueMembers)
      .set({ name })
      .where(eq(leagueMembers.id, id))
      .returning();

    if (!row) throw new BadRequestError("member not found");

    return { id: row.id, name: row.name };
  });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ memberId: string }> }
) {
  return withRouteErrorHandler(async () => {
    await requireAdmin();
    const { memberId } = await params;
    const id = parseMemberId(memberId);

    await db
      .delete(memberRaceTeams)
      .where(eq(memberRaceTeams.memberId, id));
    await db
      .delete(memberRaceScores)
      .where(eq(memberRaceScores.memberId, id));
    await db.delete(leagueMembers).where(eq(leagueMembers.id, id));

    return { ok: true };
  });
}
