"""
Fetch and process session data using FastF1 to calculate
dynamic Qpace/Rpace parameters for the simulation engine.

Supports FP1/FP2/FP3 practice sessions, qualifying results, long run analysis,
and weather data. FastF1 works during live sessions (unlike OpenF1 API).
"""

import logging
import os
import warnings
import numpy as np
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

CACHE_DIR = os.environ.get("FASTF1_CACHE", os.path.join(os.path.dirname(__file__), "..", "..", ".fastf1_cache"))
os.makedirs(CACHE_DIR, exist_ok=True)

_fastf1 = None

def _get_fastf1():
    global _fastf1
    if _fastf1 is None:
        import fastf1
        fastf1.Cache.enable_cache(CACHE_DIR)
        _fastf1 = fastf1
    return _fastf1

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


def _resolve_event_name(year: int, base_name: str) -> str | None:
    """Try multiple event name variations to find one FastF1 recognises.

    Returns the first name that successfully loads an event schedule entry,
    or *None* if nothing works.
    """
    candidates = []

    # 1. Standard "X Grand Prix"
    if "Grand Prix" not in base_name:
        candidates.append(f"{base_name} Grand Prix")
    else:
        candidates.append(base_name)

    # 2. The raw base_name itself (e.g. just "Australia")
    candidates.append(base_name.replace(" Grand Prix", ""))

    # 3. Try looking up by schedule
    try:
        schedule = _get_fastf1().get_event_schedule(year)
        if schedule is not None and not schedule.empty:
            base_lower = base_name.lower().replace(" grand prix", "")
            for _, row in schedule.iterrows():
                event = str(row.get("EventName", ""))
                country = str(row.get("Country", ""))
                location = str(row.get("Location", ""))
                if base_lower in event.lower() or base_lower in country.lower() or base_lower in location.lower():
                    if event and event not in candidates:
                        candidates.insert(0, event)  # highest priority
                    break
    except Exception as e:
        logger.debug("Could not search FastF1 schedule for '%s': %s", base_name, e)

    # Validate each candidate by trying to load it
    for name in candidates:
        try:
            _get_fastf1().get_session(year, name, "FP1")
            return name
        except Exception:
            continue

    logger.warning(
        "Could not resolve FastF1 event name for '%s' %d. Tried: %s",
        base_name, year, candidates,
    )
    return candidates[0] if candidates else base_name


def _process_fastf1_session(session_name: str, year: int, event_name: str) -> list[PracticeResult]:
    """Load a session via FastF1 and extract pace data."""
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            session = _get_fastf1().get_session(year, event_name, session_name)
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
        msg = str(e)
        if "not been loaded yet" in msg or "Failed to load" in msg:
            logger.info("%s data not yet available for %s %d (session may not be published yet)", session_name, event_name, year)
        else:
            logger.warning("FastF1 fetch failed for %s %s %d: %s", session_name, event_name, year, e)
        return []


def _extract_long_runs(year: int, event_name: str) -> dict[str, LongRunData]:
    """Extract long run / race pace data from FP2."""
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            session = _get_fastf1().get_session(year, event_name, "FP2")
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
        logger.warning("Failed to extract long runs for %s %d: %s", event_name, year, e)
        return {}


def _fetch_weather(year: int, event_name: str, session_name: str = "FP3") -> WeatherInfo:
    """Fetch weather data from the most recent session."""
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            session = _get_fastf1().get_session(year, event_name, session_name)
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
        logger.warning("Failed to fetch weather for %s %s %d: %s", session_name, event_name, year, e)

    return WeatherInfo()


def fetch_practice_data(
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

    # Resolve event name with fallback variations
    event_name = _resolve_event_name(year, meeting_name)
    if event_name is None:
        logger.warning("Could not resolve event name for '%s' %d, skipping practice data", meeting_name, year)
        return sessions

    for key, fastf1_name in session_map.items():
        results = _process_fastf1_session(fastf1_name, year, event_name)
        if results:
            for r in results:
                r.session_type = key
            sessions[key] = results
            logger.info("Loaded %d drivers from %s for %s", len(results), fastf1_name, event_name)

    return sessions


def fetch_session_metadata(
    year: int,
    meeting_name: str,
) -> dict:
    """Fetch long runs and weather data."""
    event_name = _resolve_event_name(year, meeting_name)
    if event_name is None:
        logger.warning("Could not resolve event name for '%s' %d, skipping metadata", meeting_name, year)
        return {"long_runs": {}, "weather": WeatherInfo()}

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

    # Pre-compute long run rankings
    long_run_rankings: dict[str, int] = {}
    if long_runs:
        sorted_lr = sorted(long_runs.values(), key=lambda lr: lr.avg_lap_time)
        for rank, lr in enumerate(sorted_lr):
            long_run_rankings[lr.driver_code] = rank + 1

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
            lr_position = long_run_rankings[code]
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


def _fetch_results_openf1(year: int, event_name: str, driver_number_map: dict[int, int]) -> list[dict] | None:
    """Fetch race results from OpenF1 API (api.openf1.org).

    Uses streaming position data — takes the last reported position per driver
    as the final race result.  Falls back to this when FastF1/Ergast is unavailable.

    ``driver_number_map`` maps car number → driver_id.
    """
    import json
    import urllib.request
    import urllib.error

    base = "https://api.openf1.org/v1"

    # 1. Find the Race session_key for this event
    event_lower = event_name.lower().replace(" grand prix", "")
    try:
        url = f"{base}/sessions?year={year}&session_name=Race"
        with urllib.request.urlopen(url, timeout=15) as resp:
            sessions = json.loads(resp.read())
    except Exception as e:
        logger.warning("OpenF1 sessions fetch failed: %s", e)
        return None

    race_key = None
    for s in sessions:
        loc = (s.get("location") or "").lower()
        country = (s.get("country_name") or "").lower()
        circuit = (s.get("circuit_short_name") or "").lower()
        event_full = (s.get("session_name") or "").lower()
        if event_lower in loc or event_lower in country or event_lower in circuit:
            # Prefer main race (not sprint) — sprint has session_name "Sprint"
            if event_full == "race":
                race_key = s["session_key"]
                break
    if race_key is None:
        logger.info("OpenF1: no Race session found for '%s' %d", event_name, year)
        return None

    # 2. Find qualifying session_key for grid positions
    quali_key = None
    try:
        url = f"{base}/sessions?year={year}&session_name=Qualifying"
        with urllib.request.urlopen(url, timeout=15) as resp:
            q_sessions = json.loads(resp.read())
        # Match the same event by meeting_key
        race_meeting = next((s.get("meeting_key") for s in sessions if s["session_key"] == race_key), None)
        for s in q_sessions:
            if s.get("meeting_key") == race_meeting:
                quali_key = s["session_key"]
                break
    except Exception as e:
        logger.debug("OpenF1 qualifying sessions fetch failed: %s", e)

    # 3. Fetch race position data (last entry per driver = final position)
    try:
        url = f"{base}/position?session_key={race_key}"
        with urllib.request.urlopen(url, timeout=15) as resp:
            pos_data = json.loads(resp.read())
    except Exception as e:
        logger.warning("OpenF1 position fetch failed: %s", e)
        return None

    final_positions: dict[int, int] = {}
    for entry in pos_data:
        final_positions[entry["driver_number"]] = entry["position"]

    if not final_positions:
        logger.info("OpenF1: no position data for session %s", race_key)
        return None

    # 4. Fetch qualifying positions for grid
    quali_positions: dict[int, int] = {}
    if quali_key:
        try:
            url = f"{base}/position?session_key={quali_key}"
            with urllib.request.urlopen(url, timeout=15) as resp:
                q_data = json.loads(resp.read())
            for entry in q_data:
                quali_positions[entry["driver_number"]] = entry["position"]
        except Exception as e:
            logger.debug("OpenF1 qualifying position fetch failed: %s", e)

    n_drivers = len(final_positions)
    parsed = []
    for driver_num, race_pos in final_positions.items():
        if driver_num not in driver_number_map:
            continue

        driver_id = driver_number_map[driver_num]
        grid = quali_positions.get(driver_num, n_drivers)

        # DNF heuristic: finished near last AND lost many positions from grid
        is_dnf = race_pos >= (n_drivers - 2) and grid < (n_drivers - 7)

        overtakes = max(0, grid - race_pos) if not is_dnf else 0

        parsed.append({
            "driver_id": driver_id,
            "qualifying_position": grid,
            "race_position": race_pos,
            "dnf": is_dnf,
            "fastest_lap": False,
            "dotd": False,
            "overtakes": overtakes,
        })

    if parsed:
        logger.info("OpenF1: fetched %d results for '%s' %d (session %s)", len(parsed), event_name, year, race_key)
    return parsed or None


def fetch_race_results(year: int, event_name: str, db=None, driver_map: dict | None = None) -> list[dict] | None:
    """Fetch race results and map to driver_ids.

    Tries FastF1 first, then falls back to OpenF1 API.
    Returns list of dicts matching RaceResult schema, or None if unavailable.

    Pass ``driver_map`` (code->id) when calling from a background thread
    so the function doesn't need a DB session (SQLite is not thread-safe).
    """
    # Build driver code -> driver_id mapping from DB (only if not pre-supplied)
    if driver_map is None:
        driver_map = {}
        if db:
            from app.models import Driver
            for driver in db.query(Driver).all():
                driver_map[driver.code] = driver.id

    # --- Try FastF1 first ---
    parsed = _fetch_results_fastf1(year, event_name, driver_map)

    # --- Fallback to OpenF1 API ---
    if not parsed:
        logger.info("FastF1 results unavailable, trying OpenF1 API for '%s' %d", event_name, year)
        # Build driver_number -> driver_id map
        driver_number_map: dict[int, int] = {}
        if db:
            from app.models import Driver
            for driver in db.query(Driver).all():
                driver_number_map[driver.number] = driver.id
        parsed = _fetch_results_openf1(year, event_name, driver_number_map)

    return parsed


def _fetch_results_fastf1(year: int, event_name: str, driver_map: dict[str, int]) -> list[dict] | None:
    """Fetch race results from FastF1/Ergast."""
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")

            resolved_name = _resolve_event_name(year, event_name)
            if resolved_name is None:
                logger.warning("Could not resolve event for race results: '%s' %d", event_name, year)
                return None

            session = _get_fastf1().get_session(year, resolved_name, "R")
            session.load(telemetry=False, weather=False, messages=False, laps=False)

        results_df = session.results
        if results_df is None or results_df.empty:
            logger.info("No race results available from FastF1 for %s %d", resolved_name, year)
            return None

        # Check if data is actually populated (not all NaN)
        has_valid_data = False
        for _, row in results_df.iterrows():
            pos = row.get("Position")
            cp = row.get("ClassifiedPosition")
            try:
                if pos is not None and not np.isnan(float(pos)):
                    has_valid_data = True
                    break
            except (ValueError, TypeError):
                pass
            if cp and str(cp).strip():
                has_valid_data = True
                break
        if not has_valid_data:
            logger.info("FastF1 results all NaN/empty for %s %d, skipping", resolved_name, year)
            return None

        parsed = []
        for _, row in results_df.iterrows():
            code = str(row.get("Abbreviation", ""))
            if not code or code not in driver_map:
                if code:
                    logger.warning("Driver code '%s' not found in DB, skipping", code)
                continue

            driver_id = driver_map[code]

            # Grid position – NaN-safe
            try:
                gval = float(row.get("GridPosition", 22))
                grid = 22 if np.isnan(gval) else int(gval)
            except (ValueError, TypeError):
                grid = 22
            if grid == 0:
                grid = 22  # Pit lane start

            # Race position – try ClassifiedPosition first, fall back to Position
            race_pos = 22
            for pos_col in ("ClassifiedPosition", "Position"):
                try:
                    raw = row.get(pos_col, None)
                    if raw is None:
                        continue
                    fpos = float(raw)
                    if not np.isnan(fpos):
                        race_pos = int(fpos)
                        break
                except (ValueError, TypeError):
                    continue

            # DNF detection
            status = str(row.get("Status", ""))
            is_dnf = False
            if status.upper() in ("DNS", "DNF", "DSQ"):
                is_dnf = True
            elif status and status != "Finished" and not status.startswith("+"):
                is_dnf = True

            if status.upper() == "DNS":
                race_pos = 22

            # Fastest lap
            fl_rank = row.get("FastestLapRank", None)
            has_fastest_lap = False
            try:
                has_fastest_lap = int(float(fl_rank)) == 1
            except (ValueError, TypeError):
                pass

            overtakes = max(0, grid - race_pos) if not is_dnf else 0

            parsed.append({
                "driver_id": driver_id,
                "qualifying_position": grid,
                "race_position": race_pos,
                "dnf": is_dnf,
                "fastest_lap": has_fastest_lap,
                "dotd": False,
                "overtakes": overtakes,
            })

        if not parsed:
            return None

        logger.info("FastF1: fetched %d results for %s %d", len(parsed), resolved_name, year)
        return parsed

    except Exception as e:
        msg = str(e)
        if "not been loaded yet" in msg or "Failed to load" in msg or "No data" in msg.lower():
            logger.info("Race results not yet available from FastF1 for %s %d", event_name, year)
        else:
            logger.warning("FastF1 fetch failed for race results %s %d: %s", event_name, year, e)
        return None
