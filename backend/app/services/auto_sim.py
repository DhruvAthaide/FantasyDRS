"""
Auto-simulation and auto-ingestion service for FantasyDRS.

Handles:
- Automatic simulation of the next race on startup and refresh
- Staleness checking to avoid redundant re-simulation
- Auto-ingestion of past race results via FastF1
- Strategy brief generation from simulation data
"""

import asyncio
import hashlib
import json
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


def _compute_params_version() -> str:
    """Compute a hash of DRIVER_DEFAULTS + CONSTRUCTOR parameters.
    When parameters change, this hash changes, invalidating cached simulations."""
    data = json.dumps({
        "drivers": DRIVER_DEFAULTS,
        "pitstops": CONSTRUCTOR_PITSTOP_DEFAULTS,
        "car_pace": CONSTRUCTOR_CAR_PACE_STD,
    }, sort_keys=True)
    return hashlib.md5(data.encode()).hexdigest()[:12]


# Current parameter version (computed once at import time)
_PARAMS_VERSION = _compute_params_version()

# Track which parameter version was used for each race's simulation
_sim_params_version: dict[int, str] = {}


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
    # Similarity ranges from ~0.5 (very different) to 1.5 (identical)
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
                "recent_positions": [],  # for form trend
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
            # DNF does NOT count toward race pace / positions gained
            # Track the DNF for trend purposes but mark it
            s["recent_positions"].append((rounds_ago, None))
        else:
            s["weighted_race"] += (r.race_position or 22) * weight
            s["race_finish_weight"] += weight
            s["weighted_pos_gained"] += ((r.qualifying_position or 22) - (r.race_position or 22)) * weight
            s["recent_positions"].append((rounds_ago, r.race_position or 22))

        if r.fastest_lap:
            s["fl_weighted"] += weight

    adjustments = {}
    for driver_id, s in driver_stats.items():
        tw = s["total_weight"]
        avg_quali = s["weighted_quali"] / tw if tw > 0 else 11.5

        # qpace_std shrinks as we have more data (more confident)
        effective_n = tw
        qpace_std = max(1.5, 4.0 / (1 + effective_n * 0.3))

        # DNF percentage with Bayesian prior (prior_weight pulls toward 6% baseline)
        prior_weight = 1.5
        dnf_pct = (s["dnf_weighted"] + prior_weight * 0.06) / (tw + prior_weight)

        # Fastest lap percentage with Bayesian prior
        base_fl = 1 / 22
        fl_pct = (s["fl_weighted"] + prior_weight * base_fl) / (tw + prior_weight)

        # Avg positions gained (only from races where driver finished)
        rfw = s["race_finish_weight"]
        avg_pos_gained = s["weighted_pos_gained"] / rfw if rfw > 0 else 0.0

        # Form trend: compare recent races vs older races
        # Positive = improving, negative = declining
        form_trend = 0.0
        finished_positions = [(ago, pos) for ago, pos in s["recent_positions"] if pos is not None]
        if len(finished_positions) >= 3:
            # Split into recent half and older half
            finished_positions.sort(key=lambda x: x[0])  # sort by recency (lower = more recent)
            mid = len(finished_positions) // 2
            recent_avg = sum(pos for _, pos in finished_positions[:mid]) / mid
            older_avg = sum(pos for _, pos in finished_positions[mid:]) / (len(finished_positions) - mid)
            # Positive form_trend means improving (lower recent position = better)
            form_trend = older_avg - recent_avg

        # Apply form trend to qpace_mean: improving drivers get a small boost
        # Each position of improvement shifts qpace by 0.3
        form_adjustment = form_trend * 0.3
        adjusted_qpace = avg_quali - form_adjustment
        # Clamp to reasonable range
        adjusted_qpace = max(1.0, min(22.0, adjusted_qpace))

        adjustments[driver_id] = {
            "qpace_mean": round(adjusted_qpace, 2),
            "qpace_std": round(qpace_std, 2),
            "dnf_pct": round(dnf_pct, 4),
            "fl_pct": round(fl_pct, 4),
            "avg_pos_gained": round(avg_pos_gained, 2),
            "form_trend": round(form_trend, 2),
            "total_races": s["total_races"],
        }

    logger.info(
        "History adjustments computed for %d drivers from %d prior races",
        len(adjustments), len(prior_races),
    )

    # Sanity check: if nearly all drivers have the same qpace_mean, the data
    # is likely corrupt (e.g., all positions were ingested as P22).
    if len(adjustments) >= 10:
        qpaces = [a["qpace_mean"] for a in adjustments.values()]
        spread = max(qpaces) - min(qpaces)
        if spread < 2.0:
            logger.warning(
                "History qpace spread is only %.1f — likely corrupt data "
                "(min=%.1f, max=%.1f). Discarding history adjustments.",
                spread, min(qpaces), max(qpaces),
            )
            return {}

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

            # Use history for avg_pos_gained and dnf_pct if available
            avg_pg = hist["avg_pos_gained"] if hist else defaults.get("avg_pos_gained", 0.3)
            dnf_prob = dp.dnf_probability
            fl_prob = dp.fl_probability

            # Blend history dnf_pct with practice-derived value (history is more reliable)
            if hist:
                dnf_prob = hist["dnf_pct"] * 0.7 + dp.dnf_probability * 0.3
                fl_prob = hist["fl_pct"] * 0.5 + dp.fl_probability * 0.5

            # Use rpace data to derive avg_positions_gained when available
            # If rpace_mean < qpace_mean, driver tends to gain positions in the race
            if dp.rpace_mean and dp.qpace_mean and dp.rpace_mean != dp.qpace_mean:
                pace_delta = dp.qpace_mean - dp.rpace_mean  # positive = gains positions
                # Blend practice-derived pace delta with history
                if hist:
                    avg_pg = hist["avg_pos_gained"] * 0.5 + pace_delta * 0.5
                else:
                    avg_pg = defaults.get("avg_pos_gained", 0.3) * 0.4 + pace_delta * 0.6

            logger.debug("Using practice data for %s (sources: %s)", d.code, dp.data_sources)
            params.append(DriverParams(
                id=d.id, code=d.code,
                constructor_ref=constructor.ref_id if constructor else "",
                qpace_mean=dp.qpace_mean, qpace_std=dp.qpace_std,
                dnf_probability=dnf_prob,
                fl_probability=fl_prob,
                avg_positions_gained=avg_pg, grid_penalty=penalty,
            ))
        elif history_adjustments and d.id in history_adjustments:
            hist = history_adjustments[d.id]
            defaults = DRIVER_DEFAULTS.get(d.code, {
                "qpace_mean": 12.0, "qpace_std": 2.5,
                "dnf_pct": 0.06, "fl_pct": 0.02, "avg_pos_gained": 0.1,
            })

            # Blend history with static defaults — history should refine, not replace.
            # More prior races = more weight to history; few races = lean on defaults.
            n_races = hist.get("total_races", 0) if isinstance(hist, dict) else 0
            # Weight ramps from 0.3 (1 race) to 0.8 (5+ races)
            hist_weight = min(0.8, 0.2 + n_races * 0.12)
            def_weight = 1.0 - hist_weight

            blended_qpace = defaults["qpace_mean"] * def_weight + hist["qpace_mean"] * hist_weight
            # Clamp to avoid nonsensical values from bad data
            blended_qpace = max(1.0, min(20.0, blended_qpace))

            blended_std = defaults["qpace_std"] * def_weight + hist["qpace_std"] * hist_weight
            blended_dnf = defaults["dnf_pct"] * def_weight + hist["dnf_pct"] * hist_weight
            blended_fl = defaults["fl_pct"] * def_weight + hist["fl_pct"] * hist_weight
            blended_pg = defaults["avg_pos_gained"] * def_weight + hist["avg_pos_gained"] * hist_weight

            logger.debug(
                "Blended history+defaults for %s: qpace=%.2f (hist=%.2f def=%.2f w=%.0f%%) form=%+.2f",
                d.code, blended_qpace, hist["qpace_mean"], defaults["qpace_mean"],
                hist_weight * 100, hist.get("form_trend", 0),
            )
            params.append(DriverParams(
                id=d.id, code=d.code,
                constructor_ref=constructor.ref_id if constructor else "",
                qpace_mean=blended_qpace, qpace_std=blended_std,
                dnf_probability=blended_dnf, fl_probability=blended_fl,
                avg_positions_gained=blended_pg, grid_penalty=penalty,
            ))
        else:
            defaults = DRIVER_DEFAULTS.get(d.code, {
                "qpace_mean": 12.0, "qpace_std": 2.5,
                "dnf_pct": 0.06, "fl_pct": 0.02, "avg_pos_gained": 0.1,
            })
            logger.debug("Using static defaults for %s", d.code)
            params.append(DriverParams(
                id=d.id, code=d.code,
                constructor_ref=constructor.ref_id if constructor else "",
                qpace_mean=defaults["qpace_mean"], qpace_std=defaults["qpace_std"],
                dnf_probability=defaults["dnf_pct"], fl_probability=defaults["fl_pct"],
                avg_positions_gained=defaults["avg_pos_gained"], grid_penalty=penalty,
            ))

    # Log summary counts
    practice_count = sum(1 for d in drivers if dynamic_params and d.code in dynamic_params)
    history_count = sum(
        1 for d in drivers
        if (not dynamic_params or d.code not in dynamic_params)
        and history_adjustments and d.id in history_adjustments
    )
    default_count = len(drivers) - practice_count - history_count
    logger.info(
        "Driver params: %d from practice, %d from history, %d from defaults",
        practice_count, history_count, default_count,
    )

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
    """Check if existing simulation results are stale.
    Returns True if results are older than STALENESS_HOURS or if the
    simulation parameters have changed since the last run."""
    latest = (
        db.query(SimulationResult)
        .filter_by(race_id=race_id)
        .order_by(SimulationResult.simulated_at.desc())
        .first()
    )
    if not latest or not latest.simulated_at:
        return True

    # Check if parameters have changed since last simulation
    cached_version = _sim_params_version.get(race_id)
    if cached_version != _PARAMS_VERSION:
        logger.info(
            "Parameters changed for race %d (cached=%s, current=%s) — marking stale",
            race_id, cached_version, _PARAMS_VERSION,
        )
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
                logger.warning("Failed to fetch session metadata: %s", e)

            if practice_data:
                dynamic_params = calculate_dynamic_params(
                    practice_data, DRIVER_DEFAULTS, overtake_diff, long_runs=long_runs,
                )
                all_sources = set()
                for dp in dynamic_params.values():
                    all_sources.update(dp.data_sources)
                data_sources_summary = sorted(all_sources)
                logger.info("Practice data available for %d drivers", len(dynamic_params))
        except Exception as e:
            logger.warning("Failed to fetch practice data: %s. Falling back to defaults.", e)

    # History adjustments
    history_adjustments = _compute_history_adjustments(db, race, target_circuit=circuit)
    if history_adjustments:
        logger.info("History adjustments available for %d drivers", len(history_adjustments))
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

    logger.info("Simulated %s (%d iterations, sources: %s)", race.name, n_simulations, data_sources_summary)

    # Record which parameter version was used for this simulation
    _sim_params_version[race_id] = _PARAMS_VERSION

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

    # Build driver_map once on the main thread (thread-safe read from SQLite)
    driver_map = {d.code: d.id for d in db.query(Driver).all()}

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

            # Run fetch_race_results in a thread with only serializable args
            # (no DB session) — it returns data, caller writes to DB
            ingested = await asyncio.to_thread(
                fetch_race_results, year, meeting_name, driver_map=driver_map,
            )

            if ingested is None:
                ingestion_log.append({
                    "race_name": race.name, "status": "unavailable",
                })
                continue

            # Write results to DB on the main (async) thread
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

            logger.info("Auto-ingested %d driver results for %s", len(ingested), race.name)
            ingestion_log.append({
                "race_name": race.name, "status": "ingested",
                "driver_count": len(ingested),
            })
        except Exception as e:
            db.rollback()
            logger.warning("Failed to auto-ingest results for %s: %s", race.name, e)
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
