/**
 * GET /api/admin/session
 *
 * Returns the current admin session status. Safe to call from any client
 * (UI gating). Never returns the password hash or any secret.
 */
import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { withRouteErrorHandler } from "@/lib/api-helpers";

export async function GET(): Promise<NextResponse> {
  return withRouteErrorHandler(async () => {
    const session = await getSession();
    return {
      isAdmin: session.isAdmin === true,
      email: session.email ?? null,
    };
  });
}
