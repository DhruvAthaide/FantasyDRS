/**
 * v1.0 rate-limiter middleware.
 *
 * Two tiers:
 *   - Heavy endpoints (POST /api/simulate/batch): 1 req per 10s per IP
 *   - All other /api/* POST: 30 req/min per IP
 *   - GET: unrestricted (reads are cheap)
 *
 * Serverless caveat: each Vercel function instance maintains its own
 * counter map — a sustained attacker could multiplex across instances.
 * For v1.0 traffic volume this is acceptable. A Vercel Edge Config or
 * Upstash KV-backed limiter is the post-launch upgrade path.
 */
import { NextResponse, type NextRequest } from "next/server";

const HEAVY_ROUTES: ReadonlyArray<RegExp> = [/^\/api\/simulate\/batch$/];
const HEAVY_LIMIT_MS = 10_000; //     1 req per 10s per IP
const GENERAL_LIMIT_PER_MIN = 30; //  30 POSTs per minute per IP

const heavyLastSeen = new Map<string, number>();
const generalBuckets = new Map<string, { count: number; resetAt: number }>();

function clientKey(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
}

export function middleware(req: NextRequest): NextResponse {
  if (req.method !== "POST") return NextResponse.next();

  const path = req.nextUrl.pathname;
  const key = clientKey(req);

  if (HEAVY_ROUTES.some((re) => re.test(path))) {
    const bucketKey = `heavy:${key}:${path}`;
    const last = heavyLastSeen.get(bucketKey) ?? 0;
    const now = Date.now();
    if (now - last < HEAVY_LIMIT_MS) {
      return NextResponse.json(
        {
          error:
            "Rate limit: this endpoint accepts 1 request per 10 seconds per IP",
        },
        { status: 429 }
      );
    }
    heavyLastSeen.set(bucketKey, now);
    return NextResponse.next();
  }

  if (path.startsWith("/api/")) {
    const bucketKey = `general:${key}`;
    const now = Date.now();
    let bucket = generalBuckets.get(bucketKey);
    if (!bucket || bucket.resetAt < now) {
      bucket = { count: 0, resetAt: now + 60_000 };
      generalBuckets.set(bucketKey, bucket);
    }
    bucket.count += 1;
    if (bucket.count > GENERAL_LIMIT_PER_MIN) {
      return NextResponse.json(
        { error: "Rate limit: 30 POST requests per minute per IP" },
        { status: 429 }
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
