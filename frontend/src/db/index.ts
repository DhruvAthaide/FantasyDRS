import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

/**
 * Resolve the Postgres connection string at query-time (not import-time).
 *
 * Why: Next.js builds on Vercel run this module at build-time to tree-shake
 * imports. Throwing at module scope breaks the build if env vars aren't
 * attached yet. We defer resolution to the first query instead — matches the
 * guidance in 01-01-PLAN.md Task 1.
 *
 * Resolution order (Vercel's Neon integration sets several of these):
 *   1. DATABASE_URL          (canonical Neon name)
 *   2. POSTGRES_URL          (Vercel Postgres compatibility name)
 *
 * For migrations and seeds we prefer the unpooled URL (see drizzle.config.ts).
 * For request-path queries, pooled is correct.
 */
function getConnectionString(): string {
  const url =
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL ??
    process.env.DATABASE_URL_UNPOOLED ??
    process.env.POSTGRES_URL_NON_POOLING;

  if (!url) {
    throw new Error(
      "[db] Missing connection string. Set DATABASE_URL or POSTGRES_URL (see .env.example)."
    );
  }
  return url;
}

let _client: NeonQueryFunction<false, false> | null = null;
function client(): NeonQueryFunction<false, false> {
  if (_client) return _client;
  _client = neon(getConnectionString());
  return _client;
}

// Lazy Drizzle instance — `db` is a Proxy that defers to the real client on
// first access. This keeps imports cheap and side-effect-free during build.
export const db = new Proxy(
  {} as ReturnType<typeof drizzle<typeof schema>>,
  {
    get(_target, prop, receiver) {
      const real = drizzle(client(), { schema });
      return Reflect.get(real, prop, receiver);
    },
  }
);

export { schema };
