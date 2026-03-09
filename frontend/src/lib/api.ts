const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/+$/, "");

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

import type {
  Driver,
  Constructor,
  Race,
  SimulationResponse,
  TeamResult,
  BestTeamRequest,
  PricePrediction,
  ScoreBreakdown,
  FixtureDifficultyRow,
  PitstopSummary,
  TeamComparisonResponse,
  ChipStrategyResponse,
  PowerUnitStatus,
  SwapSuggestion,
  RivalTeam,
  LeagueSimResult,
  DrsAnalysis,
  DriverScorecard,
  RaceResultEntry,
  SeasonSummary,
} from "@/types";

export const api = {
  getDrivers: (raceId?: number) =>
    fetchApi<Driver[]>(`/api/drivers${raceId ? `?race_id=${raceId}` : ""}`),

  getConstructors: (raceId?: number) =>
    fetchApi<Constructor[]>(`/api/constructors${raceId ? `?race_id=${raceId}` : ""}`),

  getRaces: () => fetchApi<Race[]>("/api/races"),

  getNextRace: () => fetchApi<Race | null>("/api/races/next"),

  runSimulation: (raceId: number, nSimulations: number = 10000) =>
    fetchApi<SimulationResponse>(`/api/simulate/${raceId}?n_simulations=${nSimulations}`, {
      method: "POST",
    }),

  getBestTeams: (request: BestTeamRequest) =>
    fetchApi<TeamResult[]>("/api/best-teams", {
      method: "POST",
      body: JSON.stringify(request),
    }),

  getPricePredictions: (raceId?: number) =>
    fetchApi<PricePrediction[]>(
      `/api/price-predictions${raceId ? `?race_id=${raceId}` : ""}`
    ),

  getDriverStats: (driverId: number) =>
    fetchApi<ScoreBreakdown[]>(`/api/statistics/driver/${driverId}`),

  getConstructorStats: (constructorId: number) =>
    fetchApi<ScoreBreakdown[]>(`/api/statistics/constructor/${constructorId}`),

  getAllStats: (raceId?: number) =>
    fetchApi<ScoreBreakdown[]>(
      `/api/statistics/all${raceId ? `?race_id=${raceId}` : ""}`
    ),

  getFixtureDifficulty: (assetType: "driver" | "constructor" = "driver") =>
    fetchApi<FixtureDifficultyRow[]>(`/api/fixtures/difficulty?asset_type=${assetType}`),

  getPitstopSummary: () =>
    fetchApi<PitstopSummary[]>("/api/statistics/pitstops"),

  compareMyTeam: (data: { driver_ids: number[]; constructor_ids: number[]; drs_driver_id: number; race_id: number }) =>
    fetchApi<TeamComparisonResponse>("/api/my-team/compare", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  evaluateChips: (chipType: string = "all") =>
    fetchApi<ChipStrategyResponse[]>(`/api/chips/evaluate?chip_type=${chipType}`),

  getPenaltyStatus: () =>
    fetchApi<PowerUnitStatus[]>("/api/penalties/status"),

  incrementPuComponent: (driverId: number, componentType: string) =>
    fetchApi<{ status: string; new_total: number }>(
      `/api/penalties/increment?driver_id=${driverId}&component_type=${encodeURIComponent(componentType)}`,
      { method: "POST" }
    ),

  resetPuAllocations: () =>
    fetchApi<{ status: string }>("/api/penalties/reset", { method: "POST" }),

  suggestTransfers: (data: { driver_ids: number[]; constructor_ids: number[]; drs_driver_id: number; race_id: number; budget?: number }) =>
    fetchApi<SwapSuggestion[]>("/api/transfers/suggest", {
      method: "POST",
      body: JSON.stringify({ budget: 100, ...data }),
    }),

  simulateLeague: (data: { my_team: RivalTeam; rivals: RivalTeam[]; race_id: number }) =>
    fetchApi<LeagueSimResult[]>("/api/league/simulate", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  analyzeDrs: (raceId: number, driverIds?: number[]) =>
    fetchApi<DrsAnalysis[]>(
      `/api/drs/analyze?race_id=${raceId}${driverIds ? `&driver_ids=${driverIds.join(",")}` : ""}`
    ),

  submitResults: (raceId: number, results: { driver_id: number; qualifying_position: number; race_position: number; dnf?: boolean; fastest_lap?: boolean; dotd?: boolean; overtakes?: number }[]) =>
    fetchApi<{ status: string }>(`/api/results/${raceId}`, {
      method: "POST",
      body: JSON.stringify({ results }),
    }),

  getResults: (raceId: number) =>
    fetchApi<RaceResultEntry[]>(`/api/results/${raceId}`),

  getScorecard: (raceId: number) =>
    fetchApi<DriverScorecard[]>(`/api/results/${raceId}/scorecard`),

  getResultsRaces: () =>
    fetchApi<{ race_id: number; race_name: string; race_round: number }[]>("/api/results"),

  getSeasonSummary: () =>
    fetchApi<SeasonSummary>("/api/season/summary"),

  batchSimulate: () =>
    fetchApi<{ simulated_count: number; skipped_count: number; simulated_races: string[] }>(
      "/api/simulate/batch",
      { method: "POST" }
    ),

  whatIf: (data: {
    race_id: number;
    original_driver_ids: number[];
    original_constructor_ids: number[];
    original_drs_driver_id: number;
    modified_driver_ids: number[];
    modified_constructor_ids: number[];
    modified_drs_driver_id: number;
  }) =>
    fetchApi<{
      original_total: number;
      modified_total: number;
      differential: number;
      original_breakdown: { asset_type: string; asset_id: number; name: string; color: string; base_pts: number; multiplier: number; scored_pts: number }[];
      modified_breakdown: { asset_type: string; asset_id: number; name: string; color: string; base_pts: number; multiplier: number; scored_pts: number }[];
      swaps: { type: string; out: { name: string; color: string; scored_pts: number }; in: { name: string; color: string; scored_pts: number }; diff: number }[];
      drs_changed: boolean;
      drs_diff: number;
    }>("/api/what-if", {
      method: "POST",
      body: JSON.stringify(data),
    }),
};
