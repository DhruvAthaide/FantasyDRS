/**
 * Admin auth (Plan 07-01).
 *
 * Single-admin model: credentials live in env vars (ADMIN_EMAIL,
 * ADMIN_PASSWORD_HASH, SESSION_SECRET). No users table. Sealed HttpOnly
 * cookie via iron-session; works on Vercel Edge + Node without any session
 * store.
 */
import { cookies } from "next/headers";
import { getIronSession, type SessionOptions } from "iron-session";

import { UnauthorizedError } from "@/lib/api-helpers";

export interface AdminSession {
  isAdmin?: boolean;
  email?: string;
}

const ONE_WEEK_SECONDS = 60 * 60 * 24 * 7;

export const sessionOptions: SessionOptions = {
  // password must be 32+ chars; iron-session enforces this at call-time.
  password: process.env.SESSION_SECRET ?? "",
  cookieName: "pitwall_admin",
  cookieOptions: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ONE_WEEK_SECONDS,
  },
};

/**
 * Load the current admin session from the request cookies.
 * Returns `{ isAdmin: false }`-ish (empty object) if no session.
 */
export async function getSession() {
  const cookieStore = await cookies();
  return getIronSession<AdminSession>(cookieStore, sessionOptions);
}

/**
 * Assert the caller is an authenticated admin. Throws UnauthorizedError
 * (→ 401 via withRouteErrorHandler) otherwise.
 */
export async function requireAdmin(): Promise<AdminSession> {
  const session = await getSession();
  if (!session.isAdmin) {
    throw new UnauthorizedError();
  }
  return session;
}

/** True iff all three required admin env vars are present. */
export function adminConfigured(): boolean {
  return Boolean(
    process.env.ADMIN_EMAIL &&
      process.env.ADMIN_PASSWORD_HASH &&
      process.env.SESSION_SECRET &&
      process.env.SESSION_SECRET.length >= 32
  );
}
