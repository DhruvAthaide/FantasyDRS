from pydantic import BaseModel
from typing import Optional


class DriverResponse(BaseModel):
    id: int
    code: str
    first_name: str
    last_name: str
    number: int
    constructor_id: int
    constructor_name: str
    constructor_color: str
    country: str
    price: float
    expected_pts: Optional[float] = None

    model_config = {"from_attributes": True}


class ConstructorResponse(BaseModel):
    id: int
    ref_id: str
    name: str
    color: str
    price: float
    driver_codes: list[str]
    expected_pts: Optional[float] = None

    model_config = {"from_attributes": True}


class RaceResponse(BaseModel):
    id: int
    round: int
    name: str
    circuit_name: str
    country: str
    date: str
    has_sprint: bool
    overtake_difficulty: float
    laps: int = 57
    drs_zones: int = 3

    model_config = {"from_attributes": True}


class SimulationResultResponse(BaseModel):
    asset_type: str
    asset_id: int
    asset_name: str
    price: float
    expected_pts_mean: float
    expected_pts_median: float
    expected_pts_std: float
    expected_pts_p10: float
    expected_pts_p90: float
    points_per_million: float


class SimulationMeta(BaseModel):
    race_id: int
    race_name: str
    n_simulations: int
    data_sources: list[str]
    has_qualifying: bool
    has_long_runs: bool
    weather: Optional[dict] = None
    simulated_at: str


class BestTeamRequest(BaseModel):
    budget: float = 100.0
    race_id: Optional[int] = None
    include_drivers: list[int] = []
    exclude_drivers: list[int] = []
    include_constructors: list[int] = []
    exclude_constructors: list[int] = []
    drs_multiplier: int = 2
    top_n: int = 10
    drs_driver_id: Optional[int] = None


class TeamResult(BaseModel):
    drivers: list[DriverResponse]
    constructors: list[ConstructorResponse]
    drs_driver: DriverResponse
    total_cost: float
    total_points: float
    budget_remaining: float


class PricePrediction(BaseModel):
    asset_type: str
    asset_id: int
    asset_name: str
    current_price: float
    avg_ppm: float
    predicted_change: float
    change_category: str
    probability_increase: float
    probability_decrease: float


class FixtureDifficultyEntry(BaseModel):
    race_id: int
    race_name: str
    race_round: int
    difficulty: float  # 0-1, higher = harder


class FixtureDifficultyRow(BaseModel):
    asset_type: str
    asset_id: int
    asset_name: str
    color: str
    fixtures: list[FixtureDifficultyEntry]


class PitstopResultCreate(BaseModel):
    constructor_id: int
    race_id: int
    stop_number: int = 1
    time_seconds: float
    is_fastest: bool = False


class PitstopResultResponse(BaseModel):
    id: int
    constructor_id: int
    constructor_name: str
    constructor_color: str
    race_id: int
    race_name: str
    stop_number: int
    time_seconds: float
    points_scored: float
    is_fastest: bool

    model_config = {"from_attributes": True}


class PitstopSummary(BaseModel):
    constructor_id: int
    constructor_name: str
    constructor_color: str
    avg_time: float
    best_time: float
    total_points: float
    num_stops: int
    fastest_count: int


class ScoreBreakdown(BaseModel):
    asset_type: str
    asset_id: int
    asset_name: str
    race_id: int
    race_name: str
    qualifying_pts: float
    race_position_pts: float
    positions_gained_pts: float
    overtake_pts: float
    fastest_lap_pts: float
    dotd_pts: float
    dnf_penalty: float
    pitstop_pts: float
    total_pts: float


class ChipRaceValue(BaseModel):
    race_id: int
    race_name: str
    race_round: int
    normal_points: float
    chip_points: float
    chip_gain: float


class ChipStrategyResponse(BaseModel):
    chip_type: str
    race_values: list[ChipRaceValue]
    best_race_id: int
    best_race_name: str
    best_gain: float


class PowerUnitStatus(BaseModel):
    driver_id: int
    driver_code: str
    driver_color: str
    components: dict[str, int]  # {component_type: total_used}
    at_risk: bool  # True if any component at or near limit


class PenaltyCalendarEntry(BaseModel):
    driver_id: int
    driver_code: str
    driver_color: str
    race_id: int
    race_name: str
    race_round: int
    penalty_cost: float  # 0-1 rating: how costly a penalty would be at this circuit
    recommended: bool


class PowerUnitUpdateRequest(BaseModel):
    driver_id: int
    component_type: str
    race_id: int
    total_used: int


class MyTeamRequest(BaseModel):
    driver_ids: list[int]  # 5 drivers
    constructor_ids: list[int]  # 2 constructors
    drs_driver_id: int
    race_id: int


class TeamComparisonResponse(BaseModel):
    my_team_points: float
    optimal_points: float
    points_left_on_table: float
    driver_points: list[dict]  # [{id, name, points}]
    constructor_points: list[dict]


class TransferRequest(BaseModel):
    driver_ids: list[int]
    constructor_ids: list[int]
    drs_driver_id: int
    race_id: int
    budget: float = 100.0


class SwapSuggestion(BaseModel):
    swap_type: str  # "driver" or "constructor"
    out_id: int
    out_name: str
    out_color: str
    out_points: float
    in_id: int
    in_name: str
    in_color: str
    in_points: float
    points_gained: float
    cost_delta: float


class RivalTeam(BaseModel):
    name: str
    driver_ids: list[int]
    constructor_ids: list[int]
    drs_driver_id: int


class LeagueSimRequest(BaseModel):
    my_team: RivalTeam
    rivals: list[RivalTeam]
    race_id: int


class LeagueSimResult(BaseModel):
    team_name: str
    expected_points: float
    win_probability: float
    differential: float  # vs my team
