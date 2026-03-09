export interface Driver {
  id: number;
  code: string;
  first_name: string;
  last_name: string;
  number: number;
  constructor_id: number;
  constructor_name: string;
  constructor_color: string;
  country: string;
  price: number;
  expected_pts: number | null;
}

export interface Constructor {
  id: number;
  ref_id: string;
  name: string;
  color: string;
  price: number;
  driver_codes: string[];
  expected_pts: number | null;
}

export interface Race {
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

export interface SimulationResult {
  asset_type: string;
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
  weather: {
    air_temp: number;
    track_temp: number;
    humidity: number;
    wind_speed: number;
    rainfall: boolean;
  } | null;
  simulated_at: string;
}

export interface SimulationResponse {
  results: SimulationResult[];
  meta: SimulationMeta;
}

export interface TeamResult {
  drivers: Driver[];
  constructors: Constructor[];
  drs_driver: Driver;
  total_cost: number;
  total_points: number;
  budget_remaining: number;
}

export interface PricePrediction {
  asset_type: string;
  asset_id: number;
  asset_name: string;
  current_price: number;
  avg_ppm: number;
  predicted_change: number;
  change_category: string;
  probability_increase: number;
  probability_decrease: number;
}

export interface ScoreBreakdown {
  asset_type: string;
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

export interface FixtureDifficultyEntry {
  race_id: number;
  race_name: string;
  race_round: number;
  difficulty: number;
}

export interface FixtureDifficultyRow {
  asset_type: string;
  asset_id: number;
  asset_name: string;
  color: string;
  fixtures: FixtureDifficultyEntry[];
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

export interface TeamComparisonResponse {
  my_team_points: number;
  optimal_points: number;
  points_left_on_table: number;
  driver_points: { id: number; name: string; points: number; is_drs?: boolean }[];
  constructor_points: { id: number; name: string; points: number }[];
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

export interface BestTeamRequest {
  budget: number;
  race_id?: number;
  include_drivers: number[];
  exclude_drivers: number[];
  include_constructors: number[];
  exclude_constructors: number[];
  drs_multiplier: number;
  top_n: number;
  drs_driver_id?: number;
}

export interface SwapSuggestion {
  swap_type: string;
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

export interface RivalTeam {
  name: string;
  driver_ids: number[];
  constructor_ids: number[];
  drs_driver_id: number;
}

export interface LeagueSimResult {
  team_name: string;
  expected_points: number;
  win_probability: number;
  differential: number;
}

export interface DrsAnalysis {
  driver_id: number;
  code: string;
  name: string;
  constructor_color: string;
  price: number;
  expected_1x: number;
  expected_2x: number;
  extra_from_drs: number;
  p10_2x: number;
  p90_2x: number;
  std: number;
  risk_score: number;
  tier: "safe" | "upside" | "neutral" | "avoid";
}

export interface DriverScorecard {
  driver_id: number;
  code: string;
  name: string;
  constructor_color: string;
  qualifying_position: number;
  race_position: number;
  dnf: boolean;
  fastest_lap: boolean;
  dotd: boolean;
  overtakes: number;
  qualifying_pts: number;
  race_pts: number;
  positions_gained_pts: number;
  overtake_pts: number;
  fastest_lap_pts: number;
  dotd_pts: number;
  dnf_penalty: number;
  total_pts: number;
  predicted_pts: number | null;
  prediction_diff: number | null;
}

export interface RaceResultEntry {
  driver_id: number;
  code: string;
  name: string;
  constructor_color: string;
  qualifying_position: number;
  race_position: number;
  dnf: boolean;
  fastest_lap: boolean;
  dotd: boolean;
  overtakes: number;
}

export interface SeasonRacePoint {
  race_id: number;
  race_round: number;
  race_name: string;
  points: number;
}

export interface SeasonDriverSummary {
  driver_id: number;
  code: string;
  name: string;
  constructor_color: string;
  race_points: SeasonRacePoint[];
  total_pts: number;
  avg_pts: number;
  best_pts: number;
  best_race: string;
  worst_pts: number;
  worst_race: string;
  races_completed: number;
}

export interface SeasonSummary {
  drivers: SeasonDriverSummary[];
  races_completed: number;
}
