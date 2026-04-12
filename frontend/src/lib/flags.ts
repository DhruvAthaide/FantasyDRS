/**
 * Compile-time feature flags.
 *
 * Defaults are the v1.0-Vercel safe values. Flip via `NEXT_PUBLIC_*` env vars
 * only when the underlying capability is re-enabled (e.g., a long-running
 * backend for live FastF1 session loads — see 02-01-RESEARCH.md §3 for the
 * original disable decision).
 *
 * NEXT_PUBLIC_* env vars are compile-time constants in Next.js. Runtime
 * toggling is intentionally NOT supported.
 */

/**
 * Gate for the 12 `/api/telemetry/*` endpoints. When `false`, the client-side
 * methods in `src/lib/api.ts` short-circuit to empty responses and the
 * driver-analysis UI shows a placeholder.
 *
 * Default: `false` (v1.0 ships without live telemetry on Vercel).
 */
export const FEATURE_TELEMETRY_LIVE: boolean =
  process.env.NEXT_PUBLIC_FEATURE_TELEMETRY_LIVE === "true";

/** Namespaced import convenience. */
export const FLAGS = {
  FEATURE_TELEMETRY_LIVE,
} as const;
