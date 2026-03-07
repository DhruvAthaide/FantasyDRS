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


class BestTeamRequest(BaseModel):
    budget: float = 100.0
    race_id: Optional[int] = None
    include_drivers: list[int] = []
    exclude_drivers: list[int] = []
    include_constructors: list[int] = []
    exclude_constructors: list[int] = []
    drs_multiplier: int = 2
    top_n: int = 10


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
