"""
Fetch and process session data using FastF1 to calculate
dynamic Qpace/Rpace parameters for the simulation engine.

Supports FP1/FP2/FP3 practice sessions, qualifying results, long run analysis,
and weather data. FastF1 works during live sessions (unlike OpenF1 API).
"""

import logging
import warnings
import numpy as np
import fastf1
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

import os
CACHE_DIR = os.environ.get("FASTF1_CACHE", os.path.join(os.path.dirname(__file__), "..", "..", ".fastf1_cache"))
os.makedirs(CACHE_DIR, exist_ok=True)
fastf1.Cache.enable_cache(CACHE_DIR)

# Qualifying dominates when available
WEIGHTS = {
    "fp1": 0.05,
    "fp2": 0.10,
    "fp3": 0.20,
    "qualifying": 0.65,
}


@dataclass
class PracticeResult:
    driver_number: int
    driver_code: str
    session_type: str
    best_lap_time: float | None
    representative_lap: float | None
    position: int
    gap_to_leader: float


@dataclass
class LongRunData:
    driver_code: str
    avg_lap_time: float
    lap_count: int
    degradation_per_lap: float


@dataclass
class WeatherInfo:
    air_temp: float | None = None
    track_temp: float | None = None
    humidity: float | None = None
    wind_speed: float | None = None
    rainfall: bool = False


@dataclass
class DynamicDriverParams:
    driver_code: str
    qpace_mean: float
    qpace_std: float
    rpace_mean: float
    rpace_std: float
    dnf_probability: float
    fl_probability: float
    data_sources: list[str] = field(default_factory=list)
    quali_position: int | None = None


def _process_fastf1_session(session_name: str, year: int, event_name: str) -> list[PracticeResult]:
    """Load a session via FastF1 and extract pace data."""
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            session = fastf1.get_session(year, event_name, session_name)
            session.load(telemetry=False, weather=False, messages=False)

        laps = session.laps
        if laps.empty:
            return []

        results = []
        for driver_code in laps["Driver"].unique():
            driver_laps = laps[laps["Driver"] == driver_code]["LapTime"].dropna()
            if driver_laps.empty:
                continue

            times = [lt.total_seconds() for lt in driver_laps if lt.total_seconds() > 0]
            if not times:
                continue

            best = min(times)
            threshold = best * 1.07
            valid = [t for t in times if t <= threshold]
            if not valid:
                valid = [best]

            top3 = sorted(valid)[:3]
            representative = sum(top3) / len(top3)

            driver_num = 0
            try:
                driver_num = int(laps[laps["Driver"] == driver_code]["DriverNumber"].iloc[0])
            except (ValueError, IndexError):
                pass

            results.append(PracticeResult(
                driver_number=driver_num,
                driver_code=driver_code,
                session_type="",
                best_lap_time=best,
                representative_lap=representative,
                position=0,
                gap_to_leader=0,
            ))

        results.sort(key=lambda r: r.representative_lap or float("inf"))
        if results:
            leader_time = results[0].representative_lap or 0
            for i, r in enumerate(results):
                r.position = i + 1
                r.gap_to_leader = (r.representative_lap - leader_time) if leader_time else 0

        return results

    except Exception as e:
        logger.warning(f"Failed to load {session_name} via FastF1: {e}")
        return []


def _extract_long_runs(year: int, event_name: str) -> dict[str, LongRunData]:
    """Extract long run / race pace data from FP2."""
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            session = fastf1.get_session(year, event_name, "FP2")
            session.load(telemetry=False, weather=False, messages=False)

        laps = session.laps
        if laps.empty:
            return {}

        long_runs = {}
        for driver_code in laps["Driver"].unique():
            driver_laps = laps[laps["Driver"] == driver_code].copy()
            driver_laps = driver_laps[driver_laps["LapTime"].notna()]
            if len(driver_laps) < 5:
                continue

            times = [lt.total_seconds() for lt in driver_laps["LapTime"] if lt.total_seconds() > 0]
            if len(times) < 5:
                continue

            best = min(times)
            threshold_low = best * 1.005
            threshold_high = best * 1.05
            long_run_laps = [t for t in times if threshold_low <= t <= threshold_high]

            if len(long_run_laps) >= 4:
                avg_time = sum(long_run_laps) / len(long_run_laps)
                if len(long_run_laps) >= 3:
                    x = np.arange(len(long_run_laps))
                    slope = float(np.polyfit(x, long_run_laps, 1)[0])
                else:
                    slope = 0.0

                long_runs[driver_code] = LongRunData(
                    driver_code=driver_code,
                    avg_lap_time=avg_time,
                    lap_count=len(long_run_laps),
                    degradation_per_lap=max(0, slope),
                )

        return long_runs

    except Exception as e:
        logger.warning(f"Failed to extract long runs: {e}")
        return {}


def _fetch_weather(year: int, event_name: str, session_name: str = "FP3") -> WeatherInfo:
    """Fetch weather data from the most recent session."""
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            session = fastf1.get_session(year, event_name, session_name)
            session.load(telemetry=False, laps=False, messages=False)

        weather = session.weather_data
        if weather is not None and not weather.empty:
            last = weather.iloc[-1]
            return WeatherInfo(
                air_temp=float(last.get("AirTemp", 0)) if "AirTemp" in last else None,
                track_temp=float(last.get("TrackTemp", 0)) if "TrackTemp" in last else None,
                humidity=float(last.get("Humidity", 0)) if "Humidity" in last else None,
                wind_speed=float(last.get("WindSpeed", 0)) if "WindSpeed" in last else None,
                rainfall=bool(last.get("Rainfall", False)) if "Rainfall" in last else False,
            )
    except Exception as e:
        logger.warning(f"Failed to fetch weather: {e}")

    return WeatherInfo()


async def fetch_practice_data(
    year: int,
    meeting_name: str,
) -> dict[str, list[PracticeResult]]:
    """
    Fetch FP1, FP2, FP3, and Qualifying data for a race weekend.
    Returns dict keyed by session type.
    """
    sessions = {}
    session_map = {
        "fp1": "FP1",
        "fp2": "FP2",
        "fp3": "FP3",
        "qualifying": "Q",
    }

    event_name = meeting_name
    if "Grand Prix" not in event_name:
        event_name = f"{event_name} Grand Prix"

    for key, fastf1_name in session_map.items():
        results = _process_fastf1_session(fastf1_name, year, event_name)
        if results:
            for r in results:
                r.session_type = key
            sessions[key] = results
            logger.info(f"Loaded {len(results)} drivers from {fastf1_name}")

    return sessions


async def fetch_session_metadata(
    year: int,
    meeting_name: str,
) -> dict:
    """Fetch long runs and weather data."""
    event_name = meeting_name
    if "Grand Prix" not in event_name:
        event_name = f"{event_name} Grand Prix"

    long_runs = _extract_long_runs(year, event_name)

    weather = WeatherInfo()
    for sess in ["Q", "FP3", "FP2", "FP1"]:
        weather = _fetch_weather(year, event_name, sess)
        if weather.air_temp is not None:
            break

    return {"long_runs": long_runs, "weather": weather}


def calculate_dynamic_params(
    practice_data: dict[str, list[PracticeResult]],
    default_params: dict[str, dict],
    overtake_difficulty: float = 0.5,
    long_runs: dict[str, LongRunData] | None = None,
) -> dict[str, DynamicDriverParams]:
    """
    Calculate dynamic Qpace/Rpace from session data.
    Qualifying dominates qpace when available. Long runs improve rpace.
    """
    all_driver_codes = set()
    for session_results in practice_data.values():
        for r in session_results:
            all_driver_codes.add(r.driver_code)
    for code in default_params:
        all_driver_codes.add(code)

    quali_positions = {}
    if "qualifying" in practice_data:
        for r in practice_data["qualifying"]:
            quali_positions[r.driver_code] = r.position

    results = {}
    for code in all_driver_codes:
        defaults = default_params.get(code, {
            "qpace_mean": 12.0, "qpace_std": 4.0,
            "dnf_pct": 0.06, "fl_pct": 1 / 22, "avg_pos_gained": 0.3,
        })

        fp_positions = {}
        data_sources = []

        for session_key in ["fp1", "fp2", "fp3", "qualifying"]:
            session_results = practice_data.get(session_key, [])
            for r in session_results:
                if r.driver_code == code:
                    fp_positions[session_key] = r.position
                    data_sources.append(session_key)
                    break

        # Weighted Qpace
        weighted_sum = 0.0
        total_weight = 0.0
        for session_key in ["fp1", "fp2", "fp3", "qualifying"]:
            if session_key in fp_positions:
                weight = WEIGHTS[session_key]
                weighted_sum += fp_positions[session_key] * weight
                total_weight += weight

        default_qpace = defaults["qpace_mean"]
        remaining_weight = 1.0 - total_weight
        if remaining_weight > 0:
            weighted_sum += default_qpace * remaining_weight
            total_weight += remaining_weight

        qpace_mean = weighted_sum / total_weight if total_weight > 0 else default_qpace

        has_quali = "qualifying" in data_sources
        if has_quali:
            qpace_mean = quali_positions.get(code, qpace_mean)
            qpace_std = 1.2  # Very tight — actual grid position
        else:
            base_std = defaults["qpace_std"]
            confidence_factor = 1.0 - (len(data_sources) * 0.20)
            confidence_factor = max(0.35, confidence_factor)
            qpace_std = base_std * confidence_factor

        # Rpace
        avg_pos_gained = defaults["avg_pos_gained"]
        overtake_ease = 1.0 - overtake_difficulty

        if long_runs and code in long_runs:
            lr = long_runs[code]
            all_lr_times = sorted(lr2.avg_lap_time for lr2 in long_runs.values())
            lr_position = all_lr_times.index(lr.avg_lap_time) + 1
            rpace_mean = (lr_position * 0.6 + qpace_mean * 0.4) - (avg_pos_gained * overtake_ease)
            rpace_std = qpace_std * 1.0
        else:
            rpace_mean = qpace_mean - (avg_pos_gained * overtake_ease)
            rpace_std = qpace_std * 1.2

        base_fl = defaults["fl_pct"]
        if len(data_sources) > 0:
            if qpace_mean <= 4:
                fl_prob = base_fl * 2.5
            elif qpace_mean <= 8:
                fl_prob = base_fl * 1.5
            elif qpace_mean <= 14:
                fl_prob = base_fl
            else:
                fl_prob = base_fl * 0.4
        else:
            fl_prob = base_fl

        results[code] = DynamicDriverParams(
            driver_code=code,
            qpace_mean=round(qpace_mean, 2),
            qpace_std=round(qpace_std, 2),
            rpace_mean=round(rpace_mean, 2),
            rpace_std=round(rpace_std, 2),
            dnf_probability=defaults["dnf_pct"],
            fl_probability=round(fl_prob, 4),
            data_sources=data_sources,
            quali_position=quali_positions.get(code),
        )

    return results
