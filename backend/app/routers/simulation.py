import asyncio
import logging
import math
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from datetime import datetime

logger = logging.getLogger(__name__)

from app.database import get_db
from app.models import Driver, Constructor, Race, Circuit, FantasyPrice, SimulationResult, RaceResult
from app.schemas import SimulationResultResponse, BestTeamRequest, TeamResult, DriverResponse, ConstructorResponse, SimulationMeta, MyTeamRequest, TeamComparisonResponse
from app.simulation.engine import DriverParams, ConstructorParams, CircuitTraits, WeatherConfig, simulate_race_weekend
from app.simulation.optimizer import find_best_teams, Asset
from app.simulation.parameters import DRIVER_DEFAULTS, CONSTRUCTOR_PITSTOP_DEFAULTS, CONSTRUCTOR_CAR_PACE_STD, get_dynamic_car_pace_std
from app.services.practice_data import fetch_practice_data, fetch_session_metadata, calculate_dynamic_params

router = APIRouter(prefix="/api", tags=["simulation"])


def _circuit_similarity(c1: Circuit, c2: Circuit) -> float:
    """Compute similarity between two circuits using Euclidean distance on normalized traits.
    Returns a value between 0.5 and 1.5 — identical circuits get 1.5, maximally
    different get 0.5. Never zeroes out a result, just scales it."""
    traits1 = [
        c1.overtake_difficulty or 0.5,
        c1.high_speed or 0.5,
        float(c1.street_circuit or False),
        c1.avg_degradation or 0.5,
    ]
    traits2 = [
        c2.overtake_difficulty or 0.5,
        c2.high_speed or 0.5,
        float(c2.street_circuit or False),
        c2.avg_degradation or 0.5,
    ]
    dist = math.sqrt(sum((a - b) ** 2 for a, b in zip(traits1, traits2)))
    # Max possible distance: sqrt(4) = 2.0; normalize to 0-1, then map to 0.5-1.5
    return 1.5 - (dist / 2.0)


def _compute_history_adjustments(
    db: Session,
    race: Race,
    target_circuit: Circuit | None = None,
) -> dict[int, dict]:
    """Compute adjusted driver parameters from previous race results this season.

    Uses exponential recency weighting so recent races influence predictions
    far more than early-season results. When target_circuit is provided, also
    weights by circuit similarity (similar tracks contribute more).

    Returns empty dict for Round 1 (no prior data).
    """
    if race.round <= 1:
        return {}

    DECAY_FACTOR = 0.85  # per-round decay; lower = older results fade faster

    # Find all races with lower round numbers in the same season
    year = race.date[:4] if race.date and len(race.date) >= 4 else "2026"
    prior_races = (
        db.query(Race)
        .filter(Race.round < race.round, Race.date.isnot(None), Race.date.like(f"{year}%"))
        .all()
    )
    if not prior_races:
        return {}

    # Build round-number lookup and circuit lookup for each race_id
    race_round_map = {r.id: r.round for r in prior_races}
    prior_race_ids = list(race_round_map.keys())

    # [A4] Pre-compute circuit similarity for each prior race
    race_circuit_similarity: dict[int, float] = {}
    if target_circuit:
        for r in prior_races:
            prior_circuit = db.get(Circuit, r.circuit_id) if r.circuit_id else None
            if prior_circuit:
                race_circuit_similarity[r.id] = _circuit_similarity(target_circuit, prior_circuit)
            else:
                race_circuit_similarity[r.id] = 1.0  # neutral if no circuit data

    # Get all results from prior races
    prior_results = (
        db.query(RaceResult)
        .filter(RaceResult.race_id.in_(prior_race_ids))
        .all()
    )
    if not prior_results:
        return {}

    # Aggregate per driver with recency weights
    driver_stats: dict[int, dict] = {}
    for r in prior_results:
        if r.driver_id not in driver_stats:
            driver_stats[r.driver_id] = {
                "weighted_quali": 0.0,
                "weighted_race": 0.0,
                "weighted_pos_gained": 0.0,
                "total_weight": 0.0,
                "race_finish_weight": 0.0,
                "dnf_weighted": 0.0,
                "fl_weighted": 0.0,
                "total_races": 0,
            }

        rounds_ago = race.round - race_round_map[r.race_id]
        weight = DECAY_FACTOR ** rounds_ago

        # [A4] Scale weight by circuit similarity
        if target_circuit and r.race_id in race_circuit_similarity:
            weight *= race_circuit_similarity[r.race_id]

        s = driver_stats[r.driver_id]
        s["total_races"] += 1
        s["total_weight"] += weight
        s["weighted_quali"] += (r.qualifying_position or 22) * weight

        if r.dnf:
            s["dnf_weighted"] += weight
        else:
            s["weighted_race"] += (r.race_position or 22) * weight
            s["race_finish_weight"] += weight
            s["weighted_pos_gained"] += ((r.qualifying_position or 22) - (r.race_position or 22)) * weight

        if r.fastest_lap:
            s["fl_weighted"] += weight

    # Convert to adjusted params
    adjustments = {}
    for driver_id, s in driver_stats.items():
        n = s["total_races"]
        tw = s["total_weight"]

        # Weighted average qualifying position
        avg_quali = s["weighted_quali"] / tw if tw > 0 else 11.5
        qpace_mean = avg_quali

        # Confidence narrows with more data (effective sample size from weights)
        # Use sum of weights as effective N — decayed old races count less
        effective_n = tw
        qpace_std = max(1.5, 4.0 / (1 + effective_n * 0.3))

        # DNF probability: weighted ratio with Bayesian smoothing toward 6%
        prior_weight = 1.5  # virtual prior weight
        dnf_pct = (s["dnf_weighted"] + prior_weight * 0.06) / (tw + prior_weight)

        # Fastest lap probability: weighted with smoothing toward 1/22
        base_fl = 1 / 22
        fl_pct = (s["fl_weighted"] + prior_weight * base_fl) / (tw + prior_weight)

        # Weighted average positions gained (only from non-DNF races)
        rfw = s["race_finish_weight"]
        if rfw > 0:
            avg_pos_gained = s["weighted_pos_gained"] / rfw
        else:
            avg_pos_gained = 0.0

        adjustments[driver_id] = {
            "qpace_mean": round(qpace_mean, 2),
            "qpace_std": round(qpace_std, 2),
            "dnf_pct": round(dnf_pct, 4),
            "fl_pct": round(fl_pct, 4),
            "avg_pos_gained": round(avg_pos_gained, 2),
        }

    return adjustments


def _build_driver_params(
    db: Session,
    dynamic_params: dict | None = None,
    grid_penalties: dict[int, int] | None = None,
    history_adjustments: dict[int, dict] | None = None,
) -> list[DriverParams]:
    """Build driver params, using dynamic practice data when available,
    falling back to history-adjusted defaults, then static defaults."""
    drivers = db.query(Driver).all()
    params = []
    for d in drivers:
        constructor = db.get(Constructor, d.constructor_id)
        penalty = (grid_penalties or {}).get(d.id, 0)

        if dynamic_params and d.code in dynamic_params:
            dp = dynamic_params[d.code]
            # Use history for avg_pos_gained if available, else static default
            hist = (history_adjustments or {}).get(d.id)
            defaults = DRIVER_DEFAULTS.get(d.code, {
                "dnf_pct": 0.06, "fl_pct": 1/22, "avg_pos_gained": 0.3,
            })
            avg_pg = hist["avg_pos_gained"] if hist else defaults.get("avg_pos_gained", 0.3)
            params.append(DriverParams(
                id=d.id,
                code=d.code,
                constructor_ref=constructor.ref_id if constructor else "",
                qpace_mean=dp.qpace_mean,
                qpace_std=dp.qpace_std,
                dnf_probability=dp.dnf_probability,
                fl_probability=dp.fl_probability,
                avg_positions_gained=avg_pg,
                grid_penalty=penalty,
            ))
        elif history_adjustments and d.id in history_adjustments:
            # No practice data but we have previous race results — use those
            hist = history_adjustments[d.id]
            params.append(DriverParams(
                id=d.id,
                code=d.code,
                constructor_ref=constructor.ref_id if constructor else "",
                qpace_mean=hist["qpace_mean"],
                qpace_std=hist["qpace_std"],
                dnf_probability=hist["dnf_pct"],
                fl_probability=hist["fl_pct"],
                avg_positions_gained=hist["avg_pos_gained"],
                grid_penalty=penalty,
            ))
        else:
            defaults = DRIVER_DEFAULTS.get(d.code, {
                "qpace_mean": 12.0, "qpace_std": 4.0,
                "dnf_pct": 0.06, "fl_pct": 1/22, "avg_pos_gained": 0.3,
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
                grid_penalty=penalty,
            ))
    return params


def _build_constructor_params(db: Session, driver_params: list[DriverParams]) -> list[ConstructorParams]:
    constructors = db.query(Constructor).all()
    driver_id_by_constructor = {}
    for dp in driver_params:
        driver_id_by_constructor.setdefault(dp.constructor_ref, []).append(dp.id)

    dynamic_pace = get_dynamic_car_pace_std(db)

    params = []
    for c in constructors:
        pitstop_pts = CONSTRUCTOR_PITSTOP_DEFAULTS.get(c.ref_id, 4.0)
        car_std = dynamic_pace.get(c.ref_id, CONSTRUCTOR_CAR_PACE_STD.get(c.ref_id, 1.5))
        params.append(ConstructorParams(
            id=c.id,
            ref_id=c.ref_id,
            driver_ids=driver_id_by_constructor.get(c.ref_id, []),
            expected_pitstop_pts=pitstop_pts,
            car_pace_std=car_std,
        ))
    return params


@router.post("/simulate/{race_id}")
async def run_simulation(
    race_id: int,
    use_practice_data: bool = True,
    n_simulations: int = 50000,
    grid_penalties: dict[int, int] | None = None,
    db: Session = Depends(get_db),
):
    """Run simulation (force mode). Thin wrapper around auto_sim."""
    from app.services.auto_sim import run_auto_simulation, _build_response

    result = await run_auto_simulation(
        db, race_id, force=True,
        n_simulations=n_simulations,
        grid_penalties=grid_penalties,
        use_practice_data=use_practice_data,
    )

    if result.get("status") == "error":
        return {"results": [], "meta": {}}

    # Build response in the same format as before
    sim_results = _build_response(db, race_id)
    response = [SimulationResultResponse(**r) for r in sim_results]

    meta = SimulationMeta(
        race_id=race_id,
        race_name=result.get("race_name", ""),
        n_simulations=result.get("n_simulations", n_simulations),
        data_sources=result.get("data_sources", []),
        has_qualifying=result.get("has_qualifying", False),
        has_long_runs=result.get("has_long_runs", False),
        weather=result.get("weather"),
        simulated_at=result.get("simulated_at", ""),
    )

    return {"results": response, "meta": meta}


@router.get("/simulation/{race_id}/cached")
def get_cached_simulation(race_id: int, db: Session = Depends(get_db)):
    """Return cached simulation results instantly (no computation)."""
    from app.services.auto_sim import _build_response, _sim_meta_cache

    race = db.get(Race, race_id)
    if not race:
        return {"status": "not_found", "race_id": race_id, "results": []}

    sim_results = _build_response(db, race_id)
    if not sim_results:
        return {"status": "no_data", "race_id": race_id, "race_name": race.name, "results": []}

    latest = (
        db.query(SimulationResult)
        .filter_by(race_id=race_id)
        .order_by(SimulationResult.simulated_at.desc())
        .first()
    )

    meta = _sim_meta_cache.get(race_id, {})

    return {
        "status": "ok",
        "race_id": race_id,
        "race_name": race.name,
        "results": sim_results,
        "simulated_at": latest.simulated_at.isoformat() if latest and latest.simulated_at else None,
        "data_sources": meta.get("data_sources", []),
        "has_qualifying": meta.get("has_qualifying", False),
        "has_long_runs": meta.get("has_long_runs", False),
        "weather": meta.get("weather"),
    }


@router.api_route("/refresh", methods=["GET", "POST"])
async def refresh(db: Session = Depends(get_db)):
    """Auto-ingest results + re-simulate if stale. Called by external cron."""
    from app.services.auto_sim import auto_ingest_results, run_auto_simulation, get_next_race_from_db

    ingestion_log = await auto_ingest_results(db)

    next_race = get_next_race_from_db(db)
    sim_result = None
    if next_race:
        sim_result = await run_auto_simulation(db, next_race.id)

    return {
        "ingestion": ingestion_log,
        "simulation": sim_result,
    }


@router.post("/simulation/{race_id}/strategy-brief")
def get_strategy_brief(race_id: int, db: Session = Depends(get_db)):
    """Generate a rule-based strategy brief from simulation data."""
    from app.services.auto_sim import generate_strategy_brief

    brief = generate_strategy_brief(db, race_id)
    if not brief:
        return {"status": "no_data", "message": "No simulation data available for this race."}
    return brief


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
        drs_driver_id=request.drs_driver_id,
    )

    result = []
    for team in teams:
        driver_responses = []
        for da in team.drivers:
            d = db.get(Driver, da.id)
            if d is None:
                continue
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
            if c is None:
                continue
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
        if drs_d is None:
            continue
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


@router.post("/my-team/compare", response_model=TeamComparisonResponse)
def compare_my_team(request: MyTeamRequest, db: Session = Depends(get_db)):
    """Compare user's team points vs the optimal team for a given race."""
    drs_multiplier = 2

    # Calculate my team's points
    driver_points = []
    for did in request.driver_ids:
        sim = (
            db.query(SimulationResult)
            .filter_by(asset_type="driver", asset_id=did, race_id=request.race_id)
            .order_by(SimulationResult.id.desc())
            .first()
        )
        pts = sim.expected_pts_mean if sim else 0
        if did == request.drs_driver_id:
            pts *= drs_multiplier
        driver = db.get(Driver, did)
        driver_points.append({
            "id": did,
            "name": driver.code if driver else "?",
            "points": round(pts, 2),
            "is_drs": did == request.drs_driver_id,
        })

    constructor_points = []
    for cid in request.constructor_ids:
        sim = (
            db.query(SimulationResult)
            .filter_by(asset_type="constructor", asset_id=cid, race_id=request.race_id)
            .order_by(SimulationResult.id.desc())
            .first()
        )
        pts = sim.expected_pts_mean if sim else 0
        constructor = db.get(Constructor, cid)
        constructor_points.append({
            "id": cid,
            "name": constructor.name if constructor else "?",
            "points": round(pts, 2),
        })

    my_total = sum(d["points"] for d in driver_points) + sum(c["points"] for c in constructor_points)

    # Get optimal team points (top-1 from optimizer)
    best_teams_request = BestTeamRequest(race_id=request.race_id, top_n=1, drs_multiplier=drs_multiplier)
    optimal = get_best_teams(best_teams_request, db)
    optimal_pts = optimal[0].total_points if optimal else my_total

    return TeamComparisonResponse(
        my_team_points=round(my_total, 2),
        optimal_points=round(optimal_pts, 2),
        points_left_on_table=round(optimal_pts - my_total, 2),
        driver_points=driver_points,
        constructor_points=constructor_points,
    )


@router.post("/simulate/batch")
async def batch_simulate(
    n_simulations: int = 10000,
    db: Session = Depends(get_db),
):
    """Simulate all races that don't have simulation results yet.
    Used by Chip Planner to populate data for all races."""
    n_simulations = max(1000, min(50000, n_simulations))
    races = db.query(Race).order_by(Race.round).all()

    simulated = []
    skipped = []
    for race in races:
        has_sim = db.query(SimulationResult).filter_by(race_id=race.id).first()
        if has_sim:
            skipped.append(race.name)
            continue

        circuit = db.get(Circuit, race.circuit_id)
        circuit_traits = CircuitTraits(
            overtake_difficulty=circuit.overtake_difficulty if circuit else 0.5,
            high_speed=circuit.high_speed if circuit else 0.5,
            street_circuit=circuit.street_circuit if circuit else False,
            altitude=circuit.altitude if circuit else 0,
            avg_degradation=circuit.avg_degradation if circuit else 0.5,
        )

        history_adjustments = _compute_history_adjustments(db, race, target_circuit=circuit)
        driver_params = _build_driver_params(db, None, None, history_adjustments)
        constructor_params = _build_constructor_params(db, driver_params)

        results = await asyncio.to_thread(
            simulate_race_weekend,
            drivers=driver_params,
            constructors=constructor_params,
            circuit=circuit_traits,
            is_sprint=race.has_sprint,
            n_simulations=n_simulations,
        )

        try:
            for r in results:
                db.add(SimulationResult(
                    race_id=race.id,
                    asset_type=r.asset_type,
                    asset_id=r.asset_id,
                    expected_pts_mean=round(r.mean, 2),
                    expected_pts_median=round(r.median, 2),
                    expected_pts_std=round(r.std, 2),
                    expected_pts_p10=round(r.p10, 2),
                    expected_pts_p90=round(r.p90, 2),
                    simulated_at=datetime.utcnow(),
                ))
            db.commit()
            simulated.append(race.name)
        except Exception:
            db.rollback()
            logger.warning(f"Failed to save simulation results for {race.name}")
            skipped.append(race.name)

    return {
        "simulated_count": len(simulated),
        "skipped_count": len(skipped),
        "simulated_races": simulated,
    }
