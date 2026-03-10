"""
Auto-simulation and auto-ingestion service for FantasyDRS.

Handles:
- Automatic simulation of the next race on startup and refresh
- Staleness checking to avoid redundant re-simulation
- Auto-ingestion of past race results via FastF1
- Strategy brief generation from simulation data
"""

import asyncio
import logging
from datetime import datetime, date, timezone, timedelta
from sqlalchemy.orm import Session

from app.models import (
    Driver, Constructor, Race, Circuit, FantasyPrice,
    SimulationResult, RaceResult,
)
from app.simulation.engine import (
    DriverParams, ConstructorParams, CircuitTraits, WeatherConfig,
    simulate_race_weekend,
)
from app.simulation.parameters import (
    DRIVER_DEFAULTS, CONSTRUCTOR_PITSTOP_DEFAULTS, CONSTRUCTOR_CAR_PACE_STD,
    get_dynamic_car_pace_std,
)
from app.services.practice_data import (
    fetch_practice_data, fetch_session_metadata, calculate_dynamic_params,
)

logger = logging.getLogger(__name__)

STALENESS_HOURS = 2
DEFAULT_SIMULATIONS = 50000

# In-memory cache of last simulation metadata per race (survives between requests, lost on restart)
_sim_meta_cache: dict[int, dict] = {}


# ---------------------------------------------------------------------------
# Helpers (imported logic from simulation.py to avoid circular imports)
# ---------------------------------------------------------------------------

def _circuit_similarity(c1: Circuit, c2: Circuit) -> float:
    import math
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
    return 1.5 - (dist / 2.0)


def _compute_history_adjustments(
    db: Session,
    race: Race,
    target_circuit: Circuit | None = None,
) -> dict[int, dict]:
    if race.round <= 1:
        return {}

    DECAY_FACTOR = 0.85

    year = race.date[:4] if race.date and len(race.date) >= 4 else "2026"
    prior_races = (
        db.query(Race)
        .filter(Race.round < race.round, Race.date.isnot(None), Race.date.like(f"{year}%"))
        .all()
    )
    if not prior_races:
        return {}

    race_round_map = {r.id: r.round for r in prior_races}
    prior_race_ids = list(race_round_map.keys())

    race_circuit_similarity: dict[int, float] = {}
    if target_circuit:
        for r in prior_races:
            prior_circuit = db.get(Circuit, r.circuit_id) if r.circuit_id else None
            if prior_circuit:
                race_circuit_similarity[r.id] = _circuit_similarity(target_circuit, prior_circuit)
            else:
                race_circuit_similarity[r.id] = 1.0

    prior_results = (
        db.query(RaceResult)
        .filter(RaceResult.race_id.in_(prior_race_ids))
        .all()
    )
    if not prior_results:
        return {}

    driver_stats: dict[int, dict] = {}
    for r in prior_results:
        if r.driver_id not in driver_stats:
            driver_stats[r.driver_id] = {
                "weighted_quali": 0.0, "weighted_race": 0.0,
                "weighted_pos_gained": 0.0, "total_weight": 0.0,
                "race_finish_weight": 0.0, "dnf_weighted": 0.0,
                "fl_weighted": 0.0, "total_races": 0,
            }

        rounds_ago = race.round - race_round_map[r.race_id]
        weight = DECAY_FACTOR ** rounds_ago

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

    adjustments = {}
    for driver_id, s in driver_stats.items():
        tw = s["total_weight"]
        avg_quali = s["weighted_quali"] / tw if tw > 0 else 11.5
        effective_n = tw
        qpace_std = max(1.5, 4.0 / (1 + effective_n * 0.3))

        prior_weight = 1.5
        dnf_pct = (s["dnf_weighted"] + prior_weight * 0.06) / (tw + prior_weight)
        base_fl = 1 / 22
        fl_pct = (s["fl_weighted"] + prior_weight * base_fl) / (tw + prior_weight)

        rfw = s["race_finish_weight"]
        avg_pos_gained = s["weighted_pos_gained"] / rfw if rfw > 0 else 0.0

        adjustments[driver_id] = {
            "qpace_mean": round(avg_quali, 2),
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
    drivers = db.query(Driver).all()
    params = []
    for d in drivers:
        constructor = db.get(Constructor, d.constructor_id)
        penalty = (grid_penalties or {}).get(d.id, 0)

        if dynamic_params and d.code in dynamic_params:
            dp = dynamic_params[d.code]
            hist = (history_adjustments or {}).get(d.id)
            defaults = DRIVER_DEFAULTS.get(d.code, {
                "dnf_pct": 0.06, "fl_pct": 1/22, "avg_pos_gained": 0.3,
            })
            avg_pg = hist["avg_pos_gained"] if hist else defaults.get("avg_pos_gained", 0.3)
            params.append(DriverParams(
                id=d.id, code=d.code,
                constructor_ref=constructor.ref_id if constructor else "",
                qpace_mean=dp.qpace_mean, qpace_std=dp.qpace_std,
                dnf_probability=dp.dnf_probability,
                fl_probability=dp.fl_probability,
                avg_positions_gained=avg_pg, grid_penalty=penalty,
            ))
        elif history_adjustments and d.id in history_adjustments:
            hist = history_adjustments[d.id]
            params.append(DriverParams(
                id=d.id, code=d.code,
                constructor_ref=constructor.ref_id if constructor else "",
                qpace_mean=hist["qpace_mean"], qpace_std=hist["qpace_std"],
                dnf_probability=hist["dnf_pct"], fl_probability=hist["fl_pct"],
                avg_positions_gained=hist["avg_pos_gained"], grid_penalty=penalty,
            ))
        else:
            defaults = DRIVER_DEFAULTS.get(d.code, {
                "qpace_mean": 12.0, "qpace_std": 4.0,
                "dnf_pct": 0.06, "fl_pct": 1/22, "avg_pos_gained": 0.3,
            })
            params.append(DriverParams(
                id=d.id, code=d.code,
                constructor_ref=constructor.ref_id if constructor else "",
                qpace_mean=defaults["qpace_mean"], qpace_std=defaults["qpace_std"],
                dnf_probability=defaults["dnf_pct"], fl_probability=defaults["fl_pct"],
                avg_positions_gained=defaults["avg_pos_gained"], grid_penalty=penalty,
            ))
    return params


def _build_constructor_params(db: Session, driver_params: list[DriverParams]) -> list[ConstructorParams]:
    constructors = db.query(Constructor).all()
    driver_id_by_constructor = {}
    for dp in driver_params:
        driver_id_by_constructor.setdefault(dp.constructor_ref, []).append(dp.id)

    # Use dynamic car pace if enough race data exists, otherwise fall back to defaults
    dynamic_pace = get_dynamic_car_pace_std(db)

    params = []
    for c in constructors:
        pitstop_pts = CONSTRUCTOR_PITSTOP_DEFAULTS.get(c.ref_id, 4.0)
        car_std = dynamic_pace.get(c.ref_id, CONSTRUCTOR_CAR_PACE_STD.get(c.ref_id, 1.5))
        params.append(ConstructorParams(
            id=c.id, ref_id=c.ref_id,
            driver_ids=driver_id_by_constructor.get(c.ref_id, []),
            expected_pitstop_pts=pitstop_pts, car_pace_std=car_std,
        ))
    return params


# ---------------------------------------------------------------------------
# Core functions
# ---------------------------------------------------------------------------

def get_next_race_from_db(db: Session) -> Race | None:
    """Get the next upcoming race."""
    today_str = date.today().isoformat()
    now_utc = datetime.now(timezone.utc)

    candidates = (
        db.query(Race)
        .filter(Race.date >= today_str)
        .order_by(Race.date)
        .all()
    )

    for race in candidates:
        if race.date == today_str:
            if now_utc.hour >= 18:
                continue
        return race

    # Fallback: last race of the season
    return db.query(Race).order_by(Race.round.desc()).first()


def _is_stale(db: Session, race_id: int) -> bool:
    """Check if existing simulation results are stale."""
    latest = (
        db.query(SimulationResult)
        .filter_by(race_id=race_id)
        .order_by(SimulationResult.simulated_at.desc())
        .first()
    )
    if not latest or not latest.simulated_at:
        return True

    age = datetime.utcnow() - latest.simulated_at
    return age > timedelta(hours=STALENESS_HOURS)


def _build_response(db: Session, race_id: int) -> list[dict]:
    """Build response dicts from stored SimulationResults."""
    results = (
        db.query(SimulationResult)
        .filter_by(race_id=race_id)
        .all()
    )
    response = []
    for r in results:
        if r.asset_type == "driver":
            asset = db.get(Driver, r.asset_id)
            name = f"{asset.first_name} {asset.last_name}" if asset else "Unknown"
        else:
            asset = db.get(Constructor, r.asset_id)
            name = asset.name if asset else "Unknown"

        price_row = (
            db.query(FantasyPrice)
            .filter_by(asset_type=r.asset_type, asset_id=r.asset_id)
            .order_by(FantasyPrice.id.desc())
            .first()
        )
        price = price_row.price if price_row else 0

        response.append({
            "asset_type": r.asset_type,
            "asset_id": r.asset_id,
            "asset_name": name,
            "price": price,
            "expected_pts_mean": r.expected_pts_mean,
            "expected_pts_median": r.expected_pts_median,
            "expected_pts_std": r.expected_pts_std,
            "expected_pts_p10": r.expected_pts_p10,
            "expected_pts_p90": r.expected_pts_p90,
            "points_per_million": round(r.expected_pts_mean / price, 3) if price > 0 else 0,
        })
    return response


async def run_auto_simulation(
    db: Session,
    race_id: int,
    force: bool = False,
    n_simulations: int = DEFAULT_SIMULATIONS,
    grid_penalties: dict[int, int] | None = None,
    use_practice_data: bool = True,
) -> dict:
    """Run simulation for a race, respecting staleness unless forced."""
    race = db.get(Race, race_id)
    if not race:
        return {"status": "error", "message": "Race not found"}

    # Check staleness
    if not force and not _is_stale(db, race_id):
        latest = (
            db.query(SimulationResult)
            .filter_by(race_id=race_id)
            .order_by(SimulationResult.simulated_at.desc())
            .first()
        )
        return {
            "status": "cached",
            "race_id": race_id,
            "race_name": race.name,
            "simulated_at": latest.simulated_at.isoformat() if latest and latest.simulated_at else None,
        }

    circuit = db.get(Circuit, race.circuit_id)
    overtake_diff = circuit.overtake_difficulty if circuit else 0.5

    circuit_traits = CircuitTraits(
        overtake_difficulty=circuit.overtake_difficulty if circuit else 0.5,
        high_speed=circuit.high_speed if circuit else 0.5,
        street_circuit=circuit.street_circuit if circuit else False,
        altitude=circuit.altitude if circuit else 0,
        avg_degradation=circuit.avg_degradation if circuit else 0.5,
    )

    n_simulations = max(1000, min(50000, n_simulations))

    # Fetch practice/session data
    dynamic_params = None
    data_sources_summary = []
    weather_info = None
    long_runs = None

    if use_practice_data:
        try:
            year = int(race.date[:4]) if race.date else 2026
            meeting_name = race.name.replace(" Grand Prix", "")

            practice_data = await asyncio.to_thread(fetch_practice_data, year, meeting_name)

            try:
                metadata = await asyncio.to_thread(fetch_session_metadata, year, meeting_name)
                long_runs = metadata.get("long_runs")
                w = metadata.get("weather")
                if w and w.air_temp is not None:
                    weather_info = {
                        "air_temp": w.air_temp, "track_temp": w.track_temp,
                        "humidity": w.humidity, "wind_speed": w.wind_speed,
                        "rainfall": w.rainfall,
                    }
            except Exception as e:
                logger.warning(f"Failed to fetch session metadata: {e}")

            if practice_data:
                dynamic_params = calculate_dynamic_params(
                    practice_data, DRIVER_DEFAULTS, overtake_diff, long_runs=long_runs,
                )
                all_sources = set()
                for dp in dynamic_params.values():
                    all_sources.update(dp.data_sources)
                data_sources_summary = sorted(all_sources)
        except Exception as e:
            logger.warning(f"Failed to fetch practice data: {e}. Falling back to defaults.")

    # History adjustments
    history_adjustments = _compute_history_adjustments(db, race, target_circuit=circuit)
    if history_adjustments:
        logger.info(f"Using previous results from {len(history_adjustments)} drivers")
        if "previous_results" not in data_sources_summary:
            data_sources_summary.append("previous_results")

    driver_params = _build_driver_params(db, dynamic_params, grid_penalties, history_adjustments)
    constructor_params = _build_constructor_params(db, driver_params)

    weather_config = WeatherConfig()
    if weather_info and weather_info.get("rainfall"):
        weather_config = WeatherConfig(is_wet=True)

    results = await asyncio.to_thread(
        simulate_race_weekend,
        drivers=driver_params, constructors=constructor_params,
        circuit=circuit_traits, is_sprint=race.has_sprint,
        n_simulations=n_simulations, weather=weather_config,
    )

    try:
        # Delete old results for this race
        db.query(SimulationResult).filter_by(race_id=race_id).delete()

        # Store new results
        now = datetime.utcnow()
        for r in results:
            db.add(SimulationResult(
                race_id=race_id, asset_type=r.asset_type, asset_id=r.asset_id,
                expected_pts_mean=round(r.mean, 2), expected_pts_median=round(r.median, 2),
                expected_pts_std=round(r.std, 2), expected_pts_p10=round(r.p10, 2),
                expected_pts_p90=round(r.p90, 2), simulated_at=now,
            ))
        db.commit()
    except Exception:
        db.rollback()
        raise

    logger.info(f"Simulated {race.name} ({n_simulations} iterations, sources: {data_sources_summary})")

    meta = {
        "data_sources": data_sources_summary,
        "has_qualifying": "qualifying" in data_sources_summary,
        "has_long_runs": bool(long_runs),
        "weather": weather_info,
    }
    _sim_meta_cache[race_id] = meta

    return {
        "status": "simulated",
        "race_id": race_id,
        "race_name": race.name,
        "n_simulations": n_simulations,
        **meta,
        "simulated_at": now.isoformat(),
    }


# ---------------------------------------------------------------------------
# Auto-ingest race results from FastF1
# ---------------------------------------------------------------------------

async def auto_ingest_results(db: Session) -> list[dict]:
    """Find completed races without stored results and ingest via FastF1."""
    from app.services.practice_data import fetch_race_results

    today_str = date.today().isoformat()
    past_races = (
        db.query(Race)
        .filter(Race.date < today_str)
        .order_by(Race.round)
        .all()
    )

    ingestion_log = []
    for race in past_races:
        existing = db.query(RaceResult).filter_by(race_id=race.id).first()
        if existing:
            ingestion_log.append({
                "race_name": race.name, "status": "already_exists",
            })
            continue

        try:
            year = int(race.date[:4]) if race.date else 2026
            meeting_name = race.name.replace(" Grand Prix", "")
            ingested = await asyncio.to_thread(fetch_race_results, year, meeting_name, db)

            if ingested is None:
                ingestion_log.append({
                    "race_name": race.name, "status": "unavailable",
                })
                continue

            for r in ingested:
                db.add(RaceResult(
                    race_id=race.id,
                    driver_id=r["driver_id"],
                    qualifying_position=r["qualifying_position"],
                    race_position=r["race_position"],
                    dnf=r["dnf"],
                    fastest_lap=r["fastest_lap"],
                    dotd=r.get("dotd", False),
                    overtakes=r.get("overtakes", 0),
                ))
            db.commit()

            logger.info(f"Auto-ingested {len(ingested)} driver results for {race.name}")
            ingestion_log.append({
                "race_name": race.name, "status": "ingested",
                "driver_count": len(ingested),
            })
        except Exception as e:
            logger.warning(f"Failed to auto-ingest results for {race.name}: {e}")
            ingestion_log.append({
                "race_name": race.name, "status": "error", "error": str(e),
            })

    return ingestion_log


# ---------------------------------------------------------------------------
# Strategy Brief Generator
# ---------------------------------------------------------------------------

def generate_strategy_brief(
    db: Session,
    race_id: int,
) -> dict | None:
    """Generate a rule-based strategy brief explaining simulation predictions."""
    race = db.get(Race, race_id)
    if not race:
        return None

    circuit = db.get(Circuit, race.circuit_id)
    if not circuit:
        return None

    # Get sim results
    sim_results = (
        db.query(SimulationResult)
        .filter_by(race_id=race_id)
        .all()
    )
    if not sim_results:
        return None

    # Separate drivers and constructors
    driver_sims = sorted(
        [s for s in sim_results if s.asset_type == "driver"],
        key=lambda s: s.expected_pts_mean,
        reverse=True,
    )
    constructor_sims = sorted(
        [s for s in sim_results if s.asset_type == "constructor"],
        key=lambda s: s.expected_pts_mean,
        reverse=True,
    )

    if not driver_sims:
        return None

    # Top pick
    top = driver_sims[0]
    top_driver = db.get(Driver, top.asset_id)
    top_constructor = db.get(Constructor, top_driver.constructor_id) if top_driver else None

    traits = []
    if circuit.high_speed and circuit.high_speed > 0.7:
        traits.append("high-speed circuit")
    if circuit.street_circuit:
        traits.append("street circuit")
    if circuit.avg_degradation and circuit.avg_degradation > 0.5:
        traits.append("high tire degradation")
    if circuit.overtake_difficulty and circuit.overtake_difficulty > 0.7:
        traits.append("limited overtaking")
    elif circuit.overtake_difficulty and circuit.overtake_difficulty < 0.3:
        traits.append("strong overtaking opportunities")

    circuit_desc = ", ".join(traits) if traits else "balanced circuit characteristics"

    top_pick_text = (
        f"{top_driver.code if top_driver else 'Unknown'} leads predictions with "
        f"{top.expected_pts_mean:.1f} xPts. "
        f"{circuit_desc.capitalize()} at {circuit.name} "
        f"suits {top_constructor.name if top_constructor else 'their team'}'s package."
    )

    # Value pick (best PPM)
    value_picks = []
    for s in driver_sims:
        price_row = (
            db.query(FantasyPrice)
            .filter_by(asset_type="driver", asset_id=s.asset_id)
            .order_by(FantasyPrice.id.desc())
            .first()
        )
        price = price_row.price if price_row else 0
        ppm = s.expected_pts_mean / price if price > 0 else 0
        driver = db.get(Driver, s.asset_id)
        value_picks.append({
            "code": driver.code if driver else "?",
            "ppm": ppm,
            "xpts": s.expected_pts_mean,
            "price": price,
        })
    value_picks.sort(key=lambda v: v["ppm"], reverse=True)
    best_value = value_picks[0] if value_picks else None

    value_text = ""
    if best_value:
        value_text = (
            f"{best_value['code']} offers the best value at "
            f"{best_value['ppm']:.2f} PPM ({best_value['xpts']:.1f} xPts for "
            f"${best_value['price']:.1f}M)."
        )

    # Danger zone (highest volatility)
    volatile = sorted(driver_sims, key=lambda s: s.expected_pts_std, reverse=True)
    danger = volatile[0] if volatile else None
    danger_driver = db.get(Driver, danger.asset_id) if danger else None

    danger_text = ""
    if danger_driver and danger:
        p10_p90_range = danger.expected_pts_p90 - danger.expected_pts_p10
        danger_text = (
            f"{danger_driver.code} has the widest range: "
            f"{danger.expected_pts_p10:.1f} to {danger.expected_pts_p90:.1f} xPts "
            f"(spread of {p10_p90_range:.1f}). High risk, high reward."
        )

    # DRS recommendation
    drs_text = (
        f"{top_driver.code if top_driver else 'Unknown'} is the safest DRS pick "
        f"with {top.expected_pts_mean:.1f} base xPts (2x = {top.expected_pts_mean * 2:.1f}). "
    )
    # Check if there's an upside DRS pick (high p90)
    p90_sorted = sorted(driver_sims, key=lambda s: s.expected_pts_p90, reverse=True)
    if p90_sorted and p90_sorted[0].asset_id != top.asset_id:
        upside = p90_sorted[0]
        upside_driver = db.get(Driver, upside.asset_id)
        if upside_driver:
            drs_text += (
                f"For upside, consider {upside_driver.code} "
                f"(P90 ceiling of {upside.expected_pts_p90:.1f} × 2 = {upside.expected_pts_p90 * 2:.1f})."
            )

    # Data confidence
    latest_sim = max(sim_results, key=lambda s: s.simulated_at or datetime.min)
    simulated_at = latest_sim.simulated_at.isoformat() if latest_sim.simulated_at else "unknown"

    return {
        "race_name": race.name,
        "circuit_name": circuit.name,
        "top_pick": top_pick_text,
        "value_play": value_text,
        "danger_zone": danger_text,
        "drs_call": drs_text,
        "circuit_traits": traits,
        "simulated_at": simulated_at,
    }
