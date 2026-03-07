import asyncio
import logging
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from datetime import datetime

logger = logging.getLogger(__name__)

from app.database import get_db
from app.models import Driver, Constructor, Race, Circuit, FantasyPrice, SimulationResult
from app.schemas import SimulationResultResponse, BestTeamRequest, TeamResult, DriverResponse, ConstructorResponse
from app.simulation.engine import DriverParams, ConstructorParams, simulate_race_weekend
from app.simulation.optimizer import find_best_teams, Asset
from app.simulation.parameters import DRIVER_DEFAULTS, CONSTRUCTOR_PITSTOP_DEFAULTS
from app.services.practice_data import fetch_practice_data, calculate_dynamic_params

router = APIRouter(prefix="/api", tags=["simulation"])


def _build_driver_params(
    db: Session,
    dynamic_params: dict | None = None,
) -> list[DriverParams]:
    """Build driver params, using dynamic practice data when available."""
    drivers = db.query(Driver).all()
    params = []
    for d in drivers:
        constructor = db.get(Constructor, d.constructor_id)

        if dynamic_params and d.code in dynamic_params:
            dp = dynamic_params[d.code]
            defaults = DRIVER_DEFAULTS.get(d.code, {
                "dnf_pct": 0.07, "fl_pct": 0.02, "avg_pos_gained": 0.3,
            })
            params.append(DriverParams(
                id=d.id,
                code=d.code,
                constructor_ref=constructor.ref_id if constructor else "",
                qpace_mean=dp.qpace_mean,
                qpace_std=dp.qpace_std,
                dnf_probability=dp.dnf_probability,
                fl_probability=dp.fl_probability,
                avg_positions_gained=defaults.get("avg_pos_gained", 0.3),
            ))
        else:
            defaults = DRIVER_DEFAULTS.get(d.code, {
                "qpace_mean": 12.0, "qpace_std": 3.5,
                "dnf_pct": 0.07, "fl_pct": 0.02, "avg_pos_gained": 0.3,
            })
            params.append(DriverParams(
                id=d.id,
                code=d.code,
                constructor_ref=constructor.ref_id if constructor else "",
                qpace_mean=defaults["qpace_mean"],
                qpace_std=defaults["qpace_std"],
                dnf_probability=defaults["dnf_pct"],
                fl_probability=defaults["fl_pct"],
                avg_positions_gained=defaults["avg_pos_gained"],
            ))
    return params


def _build_constructor_params(db: Session, driver_params: list[DriverParams]) -> list[ConstructorParams]:
    constructors = db.query(Constructor).all()
    driver_id_by_constructor = {}
    for dp in driver_params:
        driver_id_by_constructor.setdefault(dp.constructor_ref, []).append(dp.id)

    params = []
    for c in constructors:
        pitstop_pts = CONSTRUCTOR_PITSTOP_DEFAULTS.get(c.ref_id, 3.0)
        params.append(ConstructorParams(
            id=c.id,
            ref_id=c.ref_id,
            driver_ids=driver_id_by_constructor.get(c.ref_id, []),
            expected_pitstop_pts=pitstop_pts,
        ))
    return params


@router.post("/simulate/{race_id}", response_model=list[SimulationResultResponse])
async def run_simulation(
    race_id: int,
    use_practice_data: bool = True,
    db: Session = Depends(get_db),
):
    race = db.get(Race, race_id)
    if not race:
        return []

    circuit = db.get(Circuit, race.circuit_id)
    overtake_diff = circuit.overtake_difficulty if circuit else 0.5

    # Try to fetch practice session data from OpenF1
    dynamic_params = None
    practice_sources = []
    if use_practice_data:
        try:
            # Extract year from race date
            year = int(race.date[:4]) if race.date else 2026
            meeting_name = race.name.replace(" Grand Prix", "")

            practice_data = await fetch_practice_data(year, meeting_name)

            if practice_data:
                dynamic_params = calculate_dynamic_params(
                    practice_data,
                    DRIVER_DEFAULTS,
                    overtake_diff,
                )
                for code, dp in dynamic_params.items():
                    practice_sources.extend(dp.data_sources)
        except Exception as e:
            logger.warning(f"Failed to fetch practice data: {e}. Falling back to defaults.")

    driver_params = _build_driver_params(db, dynamic_params)
    constructor_params = _build_constructor_params(db, driver_params)

    results = simulate_race_weekend(
        drivers=driver_params,
        constructors=constructor_params,
        overtake_difficulty=overtake_diff,
        is_sprint=race.has_sprint,
        n_simulations=10000,
    )

    # Store results and build response
    response = []
    for r in results:
        sim_result = SimulationResult(
            race_id=race_id,
            asset_type=r.asset_type,
            asset_id=r.asset_id,
            expected_pts_mean=round(r.mean, 2),
            expected_pts_median=round(r.median, 2),
            expected_pts_std=round(r.std, 2),
            expected_pts_p10=round(r.p10, 2),
            expected_pts_p90=round(r.p90, 2),
            simulated_at=datetime.utcnow(),
        )
        db.add(sim_result)

        if r.asset_type == "driver":
            driver = db.get(Driver, r.asset_id)
            name = f"{driver.first_name} {driver.last_name}" if driver else "Unknown"
        else:
            constructor = db.get(Constructor, r.asset_id)
            name = constructor.name if constructor else "Unknown"

        price_row = (
            db.query(FantasyPrice)
            .filter_by(asset_type=r.asset_type, asset_id=r.asset_id)
            .order_by(FantasyPrice.id.desc())
            .first()
        )
        price = price_row.price if price_row else 0

        response.append(SimulationResultResponse(
            asset_type=r.asset_type,
            asset_id=r.asset_id,
            asset_name=name,
            price=price,
            expected_pts_mean=round(r.mean, 2),
            expected_pts_median=round(r.median, 2),
            expected_pts_std=round(r.std, 2),
            expected_pts_p10=round(r.p10, 2),
            expected_pts_p90=round(r.p90, 2),
            points_per_million=round(r.mean / price, 3) if price > 0 else 0,
        ))

    db.commit()
    return response


@router.post("/best-teams", response_model=list[TeamResult])
def get_best_teams(request: BestTeamRequest, db: Session = Depends(get_db)):
    all_drivers = db.query(Driver).all()
    all_constructors = db.query(Constructor).all()

    driver_assets = []
    for d in all_drivers:
        price_row = (
            db.query(FantasyPrice)
            .filter_by(asset_type="driver", asset_id=d.id)
            .order_by(FantasyPrice.id.desc())
            .first()
        )
        sim = None
        if request.race_id:
            sim = (
                db.query(SimulationResult)
                .filter_by(asset_type="driver", asset_id=d.id, race_id=request.race_id)
                .order_by(SimulationResult.id.desc())
                .first()
            )
        constructor = db.get(Constructor, d.constructor_id)
        driver_assets.append(Asset(
            id=d.id,
            code=d.code,
            price=price_row.price if price_row else 0,
            expected_pts=sim.expected_pts_mean if sim else 0,
            asset_type="driver",
            constructor_name=constructor.name if constructor else "",
            constructor_color=constructor.color if constructor else "#888",
        ))

    constructor_assets = []
    for c in all_constructors:
        price_row = (
            db.query(FantasyPrice)
            .filter_by(asset_type="constructor", asset_id=c.id)
            .order_by(FantasyPrice.id.desc())
            .first()
        )
        sim = None
        if request.race_id:
            sim = (
                db.query(SimulationResult)
                .filter_by(asset_type="constructor", asset_id=c.id, race_id=request.race_id)
                .order_by(SimulationResult.id.desc())
                .first()
            )
        constructor_assets.append(Asset(
            id=c.id,
            code=c.ref_id,
            price=price_row.price if price_row else 0,
            expected_pts=sim.expected_pts_mean if sim else 0,
            asset_type="constructor",
            constructor_name=c.name,
            constructor_color=c.color,
        ))

    teams = find_best_teams(
        drivers=driver_assets,
        constructors=constructor_assets,
        budget=request.budget,
        include_driver_ids=request.include_drivers,
        exclude_driver_ids=request.exclude_drivers,
        include_constructor_ids=request.include_constructors,
        exclude_constructor_ids=request.exclude_constructors,
        drs_multiplier=request.drs_multiplier,
        top_n=request.top_n,
    )

    result = []
    for team in teams:
        driver_responses = []
        for da in team.drivers:
            d = db.get(Driver, da.id)
            driver_responses.append(DriverResponse(
                id=d.id,
                code=d.code,
                first_name=d.first_name,
                last_name=d.last_name,
                number=d.number,
                constructor_id=d.constructor_id,
                constructor_name=da.constructor_name,
                constructor_color=da.constructor_color,
                country=d.country,
                price=da.price,
                expected_pts=da.expected_pts,
            ))

        constructor_responses = []
        for ca in team.constructors:
            c = db.get(Constructor, ca.id)
            driver_codes = [d.code for d in db.query(Driver).filter_by(constructor_id=c.id).all()]
            constructor_responses.append(ConstructorResponse(
                id=c.id,
                ref_id=c.ref_id,
                name=c.name,
                color=c.color,
                price=ca.price,
                driver_codes=driver_codes,
                expected_pts=ca.expected_pts,
            ))

        drs_d = db.get(Driver, team.drs_driver.id)
        drs_response = DriverResponse(
            id=drs_d.id,
            code=drs_d.code,
            first_name=drs_d.first_name,
            last_name=drs_d.last_name,
            number=drs_d.number,
            constructor_id=drs_d.constructor_id,
            constructor_name=team.drs_driver.constructor_name,
            constructor_color=team.drs_driver.constructor_color,
            country=drs_d.country,
            price=team.drs_driver.price,
            expected_pts=team.drs_driver.expected_pts,
        )

        result.append(TeamResult(
            drivers=driver_responses,
            constructors=constructor_responses,
            drs_driver=drs_response,
            total_cost=team.total_cost,
            total_points=team.total_points,
            budget_remaining=team.budget_remaining,
        ))

    return result
