/**
 * POST /api/admin/logout
 * Destroys the admin session cookie.
 */
import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { withRouteErrorHandler } from "@/lib/api-helpers";

export async function POST(): Promise<NextResponse> {
  return withRouteErrorHandler(async () => {
    const session = await getSession();
    session.destroy();
    return { ok: true };
  });
}
