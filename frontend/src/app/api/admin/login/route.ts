/**
 * POST /api/admin/login
 *
 * Body: { email: string, password: string }
 * 200 → sets sealed HttpOnly session cookie.
 * 401 → wrong credentials OR admin not configured.
 *
 * Always fails closed if ADMIN_EMAIL / ADMIN_PASSWORD_HASH / SESSION_SECRET
 * are missing, and never distinguishes wrong-email from wrong-password in
 * the response message.
 */
import { NextResponse, type NextRequest } from "next/server";
import bcrypt from "bcryptjs";

import { adminConfigured, getSession } from "@/lib/auth";
import {
  BadRequestError,
  UnauthorizedError,
  parseJsonBody,
  withRouteErrorHandler,
} from "@/lib/api-helpers";

interface LoginBody {
  email: string;
  password: string;
}

function isLoginBody(x: unknown): x is LoginBody {
  if (x === null || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return typeof o.email === "string" && typeof o.password === "string";
}

/** Constant-time string equality. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return withRouteErrorHandler(async () => {
    if (!adminConfigured()) {
      throw new UnauthorizedError("Invalid credentials");
    }

    const body = await parseJsonBody<LoginBody>(request, isLoginBody);
    if (body.email.length === 0 || body.password.length === 0) {
      throw new BadRequestError("email and password are required");
    }

    const expectedEmail = process.env.ADMIN_EMAIL!;
    const passwordHash = process.env.ADMIN_PASSWORD_HASH!;

    const emailOk = timingSafeEqual(
      body.email.trim().toLowerCase(),
      expectedEmail.trim().toLowerCase()
    );
    const passwordOk = await bcrypt.compare(body.password, passwordHash);

    if (!emailOk || !passwordOk) {
      throw new UnauthorizedError("Invalid credentials");
    }

    const session = await getSession();
    session.isAdmin = true;
    session.email = expectedEmail;
    await session.save();

    return { ok: true };
  });
}
