/**
 * Typed accessors for the static F1 data artifacts committed under
 * `frontend/data/f1/**`.
 *
 * SERVER-ONLY — uses `node:fs`. Do NOT import from client components.
 *
 * Contract defined in `.paul/phases/02-f1-data-strategy/02-01-RESEARCH.md` §4.3
 * and produced by `backend/scripts/refresh_race_data.py`.
 *
 * Design:
 *   - Re-read files on every call; no module-level caching. Lets Vercel pick
 *     up refreshed artifacts on deploy without a process restart.
 *   - Missing file → return null. Malformed JSON → throw (fail-fast).
 *   - _index.json is the canonical list of "what data is available."
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Artifact interfaces — MUST match 02-01-RESEARCH.md §4.3 exactly
// ---------------------------------------------------------------------------
export interface RaceResultRow {
  driver_code: string;
  position: number | null;
  classified_position: string | null;
  grid_position: number | null;
  status: string;
  fastest_lap_rank: number | null;
}

export interface RaceResultsArtifact {
  year: number;
  round: number;
  event_name: string;
  results: RaceResultRow[];
}

export interface PracticeSessionEntry {
  best_lap_ms: number | null;
  run_count: number;
  long_run_avg_ms?: number | null;
  long_run_samples?: number;
}

export interface PracticeArtifact {
  year: number;
  round: number;
  sessions: {
    FP1?: Record<string, PracticeSessionEntry>;
    FP2?: Record<string, PracticeSessionEntry>;
    FP3?: Record<string, PracticeSessionEntry>;
    Q?: Record<string, PracticeSessionEntry>;
  };
}

export interface WeatherArtifact {
  year: number;
  round: number;
  source_session: "FP1" | "FP2" | "FP3" | "Q" | null;
  air_temp_c: number | null;
  track_temp_c: number | null;
  humidity_pct: number | null;
  wind_speed_kmh: number | null;
  rainfall_pct: number | null;
}

export interface MetaArtifact {
  year: number;
  round: number;
  fetched_at: string;
  fastf1_version: string;
  source: "fastf1" | "openf1-fallback" | "none";
  notes: string | null;
}

export interface AvailableRound {
  year: number;
  round: number;
  eventName: string;
  folder: string;
  fetchedAt: string;
  source: string;
  notes: string | null;
}

// ---------------------------------------------------------------------------
// Runtime type guards (exported for tests)
// ---------------------------------------------------------------------------
export function isRaceResultsArtifact(x: unknown): x is RaceResultsArtifact {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.year === "number" &&
    typeof o.round === "number" &&
    typeof o.event_name === "string" &&
    Array.isArray(o.results)
  );
}

export function isPracticeArtifact(x: unknown): x is PracticeArtifact {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.year === "number" &&
    typeof o.round === "number" &&
    typeof o.sessions === "object" &&
    o.sessions !== null
  );
}

export function isWeatherArtifact(x: unknown): x is WeatherArtifact {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return typeof o.year === "number" && typeof o.round === "number";
}

export function isMetaArtifact(x: unknown): x is MetaArtifact {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.year === "number" &&
    typeof o.round === "number" &&
    typeof o.fetched_at === "string" &&
    typeof o.fastf1_version === "string"
  );
}

interface IndexFile {
  rounds: Array<{
    year: number;
    round: number;
    event_name: string;
    folder: string;
    fetched_at: string;
    source: string;
    notes: string | null;
  }>;
}

function isIndexFile(x: unknown): x is IndexFile {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return Array.isArray(o.rounds);
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------
function defaultRoot(): string {
  return path.resolve(process.cwd(), "data", "f1");
}

function folderFor(
  rootDir: string,
  year: number,
  round: number
): string | null {
  // Resolve folder name via _index.json — avoids having to reproduce the
  // slug algorithm in TS.
  const index = readIndex(rootDir);
  if (!index) return null;
  const entry = index.rounds.find((r) => r.year === year && r.round === round);
  return entry ? path.join(rootDir, String(year), entry.folder) : null;
}

function readIndex(rootDir: string): IndexFile | null {
  const p = path.join(rootDir, "_index.json");
  if (!existsSync(p)) return null;
  const parsed: unknown = JSON.parse(readFileSync(p, "utf-8"));
  if (!isIndexFile(parsed)) {
    throw new Error(`[f1-data] malformed _index.json at ${p}`);
  }
  return parsed;
}

function readJson<T>(
  filePath: string,
  guard: (x: unknown) => x is T
): T | null {
  if (!existsSync(filePath)) return null;
  const parsed: unknown = JSON.parse(readFileSync(filePath, "utf-8"));
  if (!guard(parsed)) {
    throw new Error(`[f1-data] malformed JSON at ${filePath}`);
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export function listAvailableRounds(
  year?: number,
  rootDir: string = defaultRoot()
): AvailableRound[] {
  const index = readIndex(rootDir);
  if (!index) return [];
  return index.rounds
    .filter((r) => (year === undefined ? true : r.year === year))
    .map((r) => ({
      year: r.year,
      round: r.round,
      eventName: r.event_name,
      folder: r.folder,
      fetchedAt: r.fetched_at,
      source: r.source,
      notes: r.notes,
    }));
}

export function getRaceResults(
  year: number,
  round: number,
  rootDir: string = defaultRoot()
): RaceResultsArtifact | null {
  const folder = folderFor(rootDir, year, round);
  if (!folder) return null;
  return readJson(path.join(folder, "results.json"), isRaceResultsArtifact);
}

export function getPractice(
  year: number,
  round: number,
  rootDir: string = defaultRoot()
): PracticeArtifact | null {
  const folder = folderFor(rootDir, year, round);
  if (!folder) return null;
  return readJson(path.join(folder, "practice.json"), isPracticeArtifact);
}

export function getWeather(
  year: number,
  round: number,
  rootDir: string = defaultRoot()
): WeatherArtifact | null {
  const folder = folderFor(rootDir, year, round);
  if (!folder) return null;
  return readJson(path.join(folder, "weather.json"), isWeatherArtifact);
}

export function getMeta(
  year: number,
  round: number,
  rootDir: string = defaultRoot()
): MetaArtifact | null {
  const folder = folderFor(rootDir, year, round);
  if (!folder) return null;
  return readJson(path.join(folder, "_meta.json"), isMetaArtifact);
}
