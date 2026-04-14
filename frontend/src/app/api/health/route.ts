/**
 * GET /api/health — liveness + DB connectivity sentinel.
 *
 * Cheap to poll: one `SELECT 1` against Neon, no joins. Safe for external
 * uptime monitors.
 */
import { sql } from "drizzle-orm";

import { db } from "@/db";
import { withRouteErrorHandler } from "@/lib/api-helpers";

// Captured once at module-load — the build time for this serverless instance
const BUILT_AT = new Date().toISOString();

export async function GET() {
  return withRouteErrorHandler(async () => {
    let dbOk = false;
    try {
      await db.execute(sql`SELECT 1`);
      dbOk = true;
    } catch {
      dbOk = false;
    }
    return {
      status: dbOk ? "ok" : "db_error",
      db: dbOk ? "ok" : "error",
      built_at: BUILT_AT,
    };
  });
}
