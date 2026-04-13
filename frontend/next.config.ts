import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Proxy unmatched /api/* paths to the legacy FastAPI backend during the
  // dual-stack migration (Phase 4). `afterFiles` ensures Next.js's own
  // route handlers take precedence — any /api/foo with a local route.ts
  // is served locally, and only unimplemented endpoints fall through to
  // the Python backend.
  async rewrites() {
    const backendUrl = process.env.BACKEND_URL || "http://localhost:8000";
    // `fallback` runs AFTER both pages/public files AND dynamic routes — so
    // local App Router handlers (including dynamic ones) take precedence and
    // only unimplemented endpoints are proxied to the legacy FastAPI backend.
    return {
      beforeFiles: [],
      afterFiles: [],
      fallback: [
        {
          source: "/api/:path*",
          destination: `${backendUrl}/api/:path*`,
        },
      ],
    };
  },
};

export default nextConfig;
