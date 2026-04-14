/**
 * GET /api/season/summary — aggregated season performance across all races.
 * Ported from backend/app/routers/season.py::season_summary.
 */
import { eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  constructors,
  drivers,
  raceResults,
  races,
} from "@/db/schema";
import { withRouteErrorHandler } from "@/lib/api-helpers";
import {
  scoreQualifyingDriver,
  scoreRacePosition,
  FASTEST_LAP_PTS,
  DRIVER_OF_THE_DAY_PTS,
  RACE_DNF_PENALTY,
  POSITIONS_CHANGE_MULTIPLIER,
  OVERTAKE_PTS,
} from "@/lib/simulation/scoring";

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

interface RaceResultRow {
  driverId: number | null;
  qualifyingPosition: number | null;
  racePosition: number | null;
  dnf: boolean | null;
  fastestLap: boolean | null;
  dotd: boolean | null;
  overtakes: number | null;
}

function computeDriverRacePts(r: RaceResultRow): number {
  const qPos = r.qualifyingPosition ?? 22;
  const rPos = r.racePosition ?? 22;
  const qPts = scoreQualifyingDriver(qPos);
  const rPts = r.dnf ? 0 : scoreRacePosition(rPos);
  const posChange =
    !r.dnf && r.racePosition !== null ? qPos - rPos : 0;
  const posPts = posChange * POSITIONS_CHANGE_MULTIPLIER;
  const otPts = (r.overtakes ?? 0) * OVERTAKE_PTS;
  const flPts = r.fastestLap ? FASTEST_LAP_PTS : 0;
  const dotdPts = r.dotd ? DRIVER_OF_THE_DAY_PTS : 0;
  const dnfPen = r.dnf ? RACE_DNF_PENALTY : 0;
  return qPts + rPts + posPts + otPts + flPts + dotdPts + dnfPen;
}

export async function GET() {
  return withRouteErrorHandler(async () => {
    const distinct = await db
      .selectDistinct({ raceId: raceResults.raceId })
      .from(raceResults);
    const raceIds = distinct
      .map((d) => d.raceId)
      .filter((x): x is number => x !== null);
    if (raceIds.length === 0) return { drivers: [], races_completed: 0 };

    const raceRows = await db
      .select()
      .from(races)
      .where(inArray(races.id, raceIds));
    const raceById = new Map(raceRows.map((r) => [r.id, r]));

    const allDrivers = await db.select().from(drivers);
    const driverById = new Map(allDrivers.map((d) => [d.id, d]));

    const allCtors = await db.select().from(constructors);
    const ctorById = new Map(allCtors.map((c) => [c.id, c]));

    interface SeasonEntry {
      driver_id: number;
      code: string;
      name: string;
      constructor_color: string;
      race_points: Array<{
        race_id: number;
        race_round: number;
        race_name: string;
        points: number;
      }>;
      total_pts: number;
      best_pts: number;
      best_race: string;
      worst_pts: number;
      worst_race: string;
      avg_pts?: number;
      races_completed?: number;
    }

    const driverSeasons = new Map<number, SeasonEntry>();

    const sortedRaceIds = [...raceIds].sort(
      (a, b) => (raceById.get(a)?.round ?? 0) - (raceById.get(b)?.round ?? 0)
    );

    for (const rid of sortedRaceIds) {
      const race = raceById.get(rid);
      if (!race) continue;
      const rows = await db
        .select()
        .from(raceResults)
        .where(eq(raceResults.raceId, rid));

      for (const r of rows) {
        if (r.driverId === null) continue;
        const pts = computeDriverRacePts(r);
        const d = driverById.get(r.driverId);
        const c = d?.constructorId !== null && d?.constructorId !== undefined
          ? ctorById.get(d.constructorId)
          : undefined;
        const shortName = race.name.replace(" Grand Prix", " GP");

        let entry = driverSeasons.get(r.driverId);
        if (!entry) {
          entry = {
            driver_id: r.driverId,
            code: d?.code ?? "?",
            name: d ? `${d.firstName} ${d.lastName}` : "?",
            constructor_color: c?.color ?? "#888",
            race_points: [],
            total_pts: 0,
            best_pts: -Infinity,
            best_race: "",
            worst_pts: Infinity,
            worst_race: "",
          };
          driverSeasons.set(r.driverId, entry);
        }
        entry.race_points.push({
          race_id: rid,
          race_round: race.round,
          race_name: shortName,
          points: round1(pts),
        });
        entry.total_pts = round1(entry.total_pts + pts);
        if (pts > entry.best_pts) {
          entry.best_pts = round1(pts);
          entry.best_race = shortName;
        }
        if (pts < entry.worst_pts) {
          entry.worst_pts = round1(pts);
          entry.worst_race = shortName;
        }
      }
    }

    const result: SeasonEntry[] = [];
    for (const ds of driverSeasons.values()) {
      const n = ds.race_points.length;
      ds.avg_pts = n > 0 ? round1(ds.total_pts / n) : 0;
      ds.races_completed = n;
      result.push(ds);
    }
    result.sort((a, b) => b.total_pts - a.total_pts);

    return { drivers: result, races_completed: raceIds.length };
  });
}
