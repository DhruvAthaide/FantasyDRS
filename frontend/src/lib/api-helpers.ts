/**
 * Shared helpers for Next.js App Router API route handlers.
 *
 * Replaces FastAPI's implicit 500-on-unhandled-exception + Depends+Query
 * machinery with small composable functions.
 */
import { NextResponse, type NextRequest } from "next/server";

/** Thrown to produce a 400 response with a clean message. */
export class BadRequestError extends Error {
  status = 400;
}

/** Thrown to produce a 401 response (auth required / invalid credentials). */
export class UnauthorizedError extends Error {
  status = 401;
  constructor(message = "Unauthorized") {
    super(message);
  }
}

/** Wrap an async route body; convert uncaught errors to JSON 400/401/500s. */
export async function withRouteErrorHandler<T>(
  handler: () => Promise<T>
): Promise<NextResponse> {
  try {
    const result = await handler();
    return NextResponse.json(result);
  } catch (err: unknown) {
    if (err instanceof BadRequestError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    console.error("[api] unhandled route error:", err);
    const body: { error: string; detail?: string } = {
      error: "Internal server error",
    };
    if (process.env.NODE_ENV !== "production") {
      body.detail = err instanceof Error ? err.message : String(err);
    }
    return NextResponse.json(body, { status: 500 });
  }
}

/**
 * Parse a JSON request body, optionally narrowing with a type guard.
 *
 * Throws BadRequestError (→ 400) on malformed JSON or shape mismatch.
 * Callers inside `withRouteErrorHandler` get automatic 400 conversion.
 */
export async function parseJsonBody<T>(
  request: NextRequest,
  validator?: (x: unknown) => x is T
): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new BadRequestError("Invalid JSON body");
  }
  if (validator && !validator(raw)) {
    throw new BadRequestError("Invalid request body shape");
  }
  return raw as T;
}

/** Return a query param or null if missing. */
export function queryParam(
  request: NextRequest,
  name: string
): string | null {
  return request.nextUrl.searchParams.get(name);
}

/**
 * Parse a query param as integer. Returns null on missing, absent, or NaN.
 * Mirrors FastAPI's `int | None` semantics for optional numeric query args.
 */
export function queryParamInt(
  request: NextRequest,
  name: string
): number | null {
  const raw = request.nextUrl.searchParams.get(name);
  if (raw === null || raw === "") return null;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? null : n;
}
