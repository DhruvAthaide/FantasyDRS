import type { NextConfig } from "next";

/**
 * v1.0 Vercel-only config.
 *
 * The dual-stack proxy rewrite that forwarded unmatched /api/* requests
 * to a FastAPI backend was removed in Phase 5 Plan 05-02 — every /api/*
 * path now resolves locally. See .paul/phases/05-frontend-rewiring-and-cleanup/
 * 05-01-AUDIT.md for the pre-removal inventory.
 */
const nextConfig: NextConfig = {};

export default nextConfig;
