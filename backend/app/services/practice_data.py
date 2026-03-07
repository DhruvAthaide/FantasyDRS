"""
Fetch and process practice session data from OpenF1 API to calculate
dynamic Qpace/Rpace parameters for the simulation engine.

This replaces the static defaults in parameters.py with real FP1/FP2/FP3 data
when available.
"""

import os
import httpx
import numpy as np
from dataclasses import dataclass

OPENF1_BASE = "https://api.openf1.org/v1"
OPENF1_API_KEY = os.environ.get("OPENF1_API_KEY", "")

# Weights for combining data sources into Qpace estimate
# FP3 gets highest weight (closest to qualifying, quali sim runs)
# With new 2026 regs, practice data is far more valuable than defaults
WEIGHTS = {
    "fp1": 0.15,
    "fp2": 0.25,
    "fp3": 0.45,
    "recent_quali": 0.0,
    "season_avg": 0.0,
    "circuit_history": 0.0,
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
class DynamicDriverParams:
    driver_code: str
    qpace_mean: float
    qpace_std: float
    rpace_mean: float
    rpace_std: float
    dnf_probability: float
    fl_probability: float
    data_sources: list[str]  # Which sessions contributed to the estimate


def _get_headers() -> dict:
    """Build request headers, including API key if available."""
    headers = {}
    if OPENF1_API_KEY:
        headers["Authorization"] = f"Bearer {OPENF1_API_KEY}"
    return headers


async def fetch_session_key(year: int, meeting_name: str, session_type: str) -> int | None:
    """Get OpenF1 session key for a specific session."""
    async with httpx.AsyncClient(timeout=15, headers=_get_headers()) as client:
        resp = await client.get(
            f"{OPENF1_BASE}/sessions",
            params={
                "year": year,
                "session_name": session_type,
                "meeting_name": meeting_name,
            },
        )
        if resp.status_code != 200:
            return None
        data = resp.json()
        return data[0]["session_key"] if data else None


async def fetch_session_laps(session_key: int) -> list[dict]:
    """Fetch all lap times for a session from OpenF1."""
    async with httpx.AsyncClient(timeout=30, headers=_get_headers()) as client:
        resp = await client.get(
            f"{OPENF1_BASE}/laps",
            params={"session_key": session_key},
        )
        if resp.status_code != 200:
            return []
        return resp.json()


async def fetch_driver_list(session_key: int) -> dict[int, str]:
    """Fetch driver number -> code mapping for a session."""
    async with httpx.AsyncClient(timeout=15, headers=_get_headers()) as client:
        resp = await client.get(
            f"{OPENF1_BASE}/drivers",
            params={"session_key": session_key},
        )
        if resp.status_code != 200:
            return {}
        return {d["driver_number"]: d["name_acronym"] for d in resp.json()}


def process_session_laps(laps: list[dict], driver_map: dict[int, str]) -> list[PracticeResult]:
    """
    Process raw lap data into representative pace for each driver.

    Filters out:
    - Installation laps (very slow, first few laps)
    - Outlier laps (> 107% of session best)
    - Incomplete laps (no lap_duration)
    """
    if not laps:
        return []

    # Group laps by driver
    driver_laps: dict[int, list[float]] = {}
    for lap in laps:
        driver_num = lap.get("driver_number")
        duration = lap.get("lap_duration")
        if driver_num is None or duration is None:
            continue
        if duration <= 0:
            continue
        driver_laps.setdefault(driver_num, []).append(duration)

    if not driver_laps:
        return []

    # Find session best lap for outlier filtering
    all_times = [t for times in driver_laps.values() for t in times]
    if not all_times:
        return []
    session_best = min(all_times)
    threshold = session_best * 1.07  # 107% rule

    results = []
    driver_bests = {}

    for driver_num, times in driver_laps.items():
        # Filter outliers
        valid_times = [t for t in times if t <= threshold]
        if not valid_times:
            valid_times = [min(times)]  # At least use their best lap

        best_time = min(valid_times)
        # Representative lap = average of top 3 fastest valid laps
        top_laps = sorted(valid_times)[:3]
        representative = sum(top_laps) / len(top_laps)

        code = driver_map.get(driver_num, f"#{driver_num}")
        driver_bests[driver_num] = best_time

        results.append(PracticeResult(
            driver_number=driver_num,
            driver_code=code,
            session_type="",
            best_lap_time=best_time,
            representative_lap=representative,
            position=0,
            gap_to_leader=0,
        ))

    # Sort by representative lap and assign positions
    results.sort(key=lambda r: r.representative_lap or float("inf"))
    leader_time = results[0].representative_lap if results else 0

    for i, r in enumerate(results):
        r.position = i + 1
        r.gap_to_leader = (r.representative_lap - leader_time) if leader_time else 0

    return results


async def fetch_practice_data(
    year: int,
    meeting_name: str,
) -> dict[str, list[PracticeResult]]:
    """
    Fetch FP1, FP2, FP3 data for a given race weekend.
    Returns dict keyed by session type.
    """
    sessions = {}

    for session_type in ["Practice 1", "Practice 2", "Practice 3"]:
        session_key = await fetch_session_key(year, meeting_name, session_type)
        if not session_key:
            continue

        laps = await fetch_session_laps(session_key)
        driver_map = await fetch_driver_list(session_key)
        results = process_session_laps(laps, driver_map)

        key = session_type.lower().replace("practice ", "fp")
        for r in results:
            r.session_type = key

        sessions[key] = results

    return sessions


def calculate_dynamic_params(
    practice_data: dict[str, list[PracticeResult]],
    default_params: dict[str, dict],
    overtake_difficulty: float = 0.5,
) -> dict[str, DynamicDriverParams]:
    """
    Calculate dynamic Qpace/Rpace from practice session data.

    Blends practice positions with default parameters using configured weights.
    More practice data available = higher confidence in the estimate.
    """
    all_driver_codes = set()
    for session_results in practice_data.values():
        for r in session_results:
            all_driver_codes.add(r.driver_code)

    # Also include drivers from defaults who might not have practice data
    for code in default_params:
        all_driver_codes.add(code)

    results = {}
    for code in all_driver_codes:
        defaults = default_params.get(code, {
            "qpace_mean": 12.0,
            "qpace_std": 3.5,
            "dnf_pct": 0.07,
            "fl_pct": 0.02,
            "avg_pos_gained": 0.3,
        })

        # Collect position data from each practice session
        fp_positions = {}
        data_sources = []

        for session_key in ["fp1", "fp2", "fp3"]:
            session_results = practice_data.get(session_key, [])
            for r in session_results:
                if r.driver_code == code:
                    fp_positions[session_key] = r.position
                    data_sources.append(session_key)
                    break

        # Calculate weighted Qpace
        weighted_sum = 0.0
        total_weight = 0.0

        # Practice session contributions
        for session_key, weight_key in [("fp1", "fp1"), ("fp2", "fp2"), ("fp3", "fp3")]:
            if session_key in fp_positions:
                weight = WEIGHTS[weight_key]
                weighted_sum += fp_positions[session_key] * weight
                total_weight += weight

        # Default parameter contributions (always available)
        default_qpace = defaults["qpace_mean"]
        remaining_weight = 1.0 - total_weight
        weighted_sum += default_qpace * remaining_weight
        total_weight += remaining_weight

        qpace_mean = weighted_sum / total_weight if total_weight > 0 else default_qpace

        # Qpace std: reduce significantly with more data (more confident)
        base_std = defaults["qpace_std"]
        confidence_factor = 1.0 - (len(data_sources) * 0.20)  # Up to 60% reduction with all 3 FP sessions
        confidence_factor = max(0.35, confidence_factor)
        qpace_std = base_std * confidence_factor

        # Rpace from Qpace + overtake adjustment
        avg_pos_gained = defaults["avg_pos_gained"]
        overtake_ease = 1.0 - overtake_difficulty
        rpace_mean = qpace_mean - (avg_pos_gained * overtake_ease)
        rpace_std = qpace_std * 1.2

        # FL probability scales with pace (better pace = higher FL chance)
        base_fl = defaults["fl_pct"]
        if len(data_sources) > 0:
            # With practice data, scale FL chance based on actual pace
            if qpace_mean <= 4:
                fl_prob = base_fl * 2.5
            elif qpace_mean <= 8:
                fl_prob = base_fl * 1.5
            elif qpace_mean <= 14:
                fl_prob = base_fl
            else:
                fl_prob = base_fl * 0.4
        else:
            # No practice data — equal FL chance for all
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
        )

    return results
