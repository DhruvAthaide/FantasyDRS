/**
 * TypeScript mirrors of the pydantic response schemas in
 * backend/app/schemas.py.
 *
 * Field names intentionally kept snake_case to preserve the API contract
 * that frontend/src/lib/api.ts already consumes — renaming would force a
 * client rewrite in Phase 5 for no benefit.
 *
 * Any change to a pydantic model MUST be mirrored here and vice-versa.
 */

export interface DriverResponse {
  id: number;
  code: string;
  first_name: string;
  last_name: string;
  number: number | null;
  constructor_id: number;
  constructor_name: string;
  constructor_color: string;
  country: string | null;
  price: number;
  expected_pts: number | null;
}

export interface ConstructorResponse {
  id: number;
  ref_id: string;
  name: string;
  color: string;
  price: number;
  driver_codes: string[];
  expected_pts: number | null;
}

export interface RaceResponse {
  id: number;
  round: number;
  name: string;
  circuit_name: string;
  country: string;
  date: string;
  has_sprint: boolean;
  overtake_difficulty: number;
  laps: number;
  drs_zones: number;
}

export interface FixtureDifficultyEntry {
  race_id: number;
  race_name: string;
  race_round: number;
  difficulty: number;
}

export interface FixtureDifficultyRow {
  asset_type: "driver" | "constructor";
  asset_id: number;
  asset_name: string;
  color: string;
  fixtures: FixtureDifficultyEntry[];
}

export type FormTrend = "improving" | "stable" | "declining";
export type FormTrendMap = Record<number, FormTrend>;

// ---------------------------------------------------------------------------
// Simulation-domain types (Plan 04-02)
// ---------------------------------------------------------------------------

export interface SimulationResultResponse {
  asset_type: "driver" | "constructor";
  asset_id: number;
  asset_name: string;
  price: number;
  expected_pts_mean: number;
  expected_pts_median: number;
  expected_pts_std: number;
  expected_pts_p10: number;
  expected_pts_p90: number;
  points_per_million: number;
}

export interface SimulationMeta {
  race_id: number;
  race_name: string;
  n_simulations: number;
  data_sources: string[];
  has_qualifying: boolean;
  has_long_runs: boolean;
  weather: unknown | null;
  simulated_at: string;
}

export interface BestTeamRequest {
  budget?: number;
  race_id?: number | null;
  include_drivers?: number[];
  exclude_drivers?: number[];
  include_constructors?: number[];
  exclude_constructors?: number[];
  drs_multiplier?: number;
  top_n?: number;
  drs_driver_id?: number | null;
}

export interface TeamResult {
  drivers: DriverResponse[];
  constructors: ConstructorResponse[];
  drs_driver: DriverResponse;
  total_cost: number;
  total_points: number;
  budget_remaining: number;
}

export interface MyTeamRequest {
  driver_ids: number[];
  constructor_ids: number[];
  drs_driver_id: number;
  race_id: number;
}

export interface TeamComparisonDriverPoint {
  id: number;
  name: string;
  points: number;
  is_drs?: boolean;
}

export interface TeamComparisonConstructorPoint {
  id: number;
  name: string;
  points: number;
}

export interface TeamComparisonResponse {
  my_team_points: number;
  optimal_points: number;
  points_left_on_table: number;
  driver_points: TeamComparisonDriverPoint[];
  constructor_points: TeamComparisonConstructorPoint[];
}

export interface StrategyBriefResponse {
  race_name: string;
  circuit_name: string;
  top_pick: string;
  value_play: string;
  danger_zone: string;
  drs_call: string;
  circuit_traits: string[];
  simulated_at: string;
}

// ---------------------------------------------------------------------------
// Plan 04-04 additions — schema mirrors for the bulk 11 routers
// ---------------------------------------------------------------------------

export interface ScoreBreakdown {
  asset_type: "driver" | "constructor";
  asset_id: number;
  asset_name: string;
  race_id: number;
  race_name: string;
  qualifying_pts: number;
  race_position_pts: number;
  positions_gained_pts: number;
  overtake_pts: number;
  fastest_lap_pts: number;
  dotd_pts: number;
  dnf_penalty: number;
  pitstop_pts: number;
  total_pts: number;
}

export interface PitstopResultCreate {
  constructor_id: number;
  race_id: number;
  stop_number?: number;
  time_seconds: number;
  is_fastest?: boolean;
}

export interface PitstopResultResponse {
  id: number;
  constructor_id: number;
  constructor_name: string;
  constructor_color: string;
  race_id: number;
  race_name: string;
  stop_number: number;
  time_seconds: number;
  points_scored: number;
  is_fastest: boolean;
}

export interface PitstopSummary {
  constructor_id: number;
  constructor_name: string;
  constructor_color: string;
  avg_time: number;
  best_time: number;
  total_points: number;
  num_stops: number;
  fastest_count: number;
}

export interface PricePrediction {
  asset_type: "driver" | "constructor";
  asset_id: number;
  asset_name: string;
  current_price: number;
  avg_ppm: number;
  predicted_change: number;
  change_category: string;
  probability_increase: number;
  probability_decrease: number;
}

export interface ChipRaceValue {
  race_id: number;
  race_name: string;
  race_round: number;
  normal_points: number;
  chip_points: number;
  chip_gain: number;
}

export interface ChipStrategyResponse {
  chip_type: string;
  race_values: ChipRaceValue[];
  best_race_id: number;
  best_race_name: string;
  best_gain: number;
}

export interface TransferRequest {
  driver_ids: number[];
  constructor_ids: number[];
  drs_driver_id: number;
  race_id: number;
  budget?: number;
}

export interface SwapSuggestion {
  swap_type: "driver" | "constructor";
  out_id: number;
  out_name: string;
  out_color: string;
  out_points: number;
  in_id: number;
  in_name: string;
  in_color: string;
  in_points: number;
  points_gained: number;
  cost_delta: number;
}

export interface PowerUnitStatus {
  driver_id: number;
  driver_code: string;
  driver_color: string;
  components: Record<string, number>;
  at_risk: boolean;
}

export interface PenaltyCalendarEntry {
  driver_id: number;
  driver_code: string;
  driver_color: string;
  race_id: number;
  race_name: string;
  race_round: number;
  penalty_cost: number;
  recommended: boolean;
}

export interface PowerUnitUpdateRequest {
  driver_id: number;
  component_type: string;
  race_id: number;
  total_used: number;
}

export interface RivalTeam {
  name: string;
  driver_ids: number[];
  constructor_ids: number[];
  drs_driver_id: number;
}

export interface LeagueSimRequest {
  my_team: RivalTeam;
  rivals: RivalTeam[];
  race_id: number;
}

export interface LeagueSimResult {
  team_name: string;
  expected_points: number;
  win_probability: number;
  differential: number;
}

export interface CompareDriverResult {
  driver_id: number;
  code: string;
  name: string;
  constructor_color: string;
  pace_rating: number;
  consistency: number;
  value: number;
  form_trend: FormTrend;
  circuit_fit: number;
  risk: number;
  expected_pts: number;
  price: number;
}

export interface CompareConstructorResult {
  constructor_id: number;
  name: string;
  color: string;
  pace_rating: number;
  consistency: number;
  value: number;
  expected_pts: number;
  price: number;
}

export interface CachedSimResponse {
  status: "ok" | "not_found" | "no_data";
  race_id: number;
  race_name?: string;
  results: SimulationResultResponse[];
  simulated_at?: string | null;
  data_sources?: string[];
  has_qualifying?: boolean;
  has_long_runs?: boolean;
  weather?: unknown | null;
}
