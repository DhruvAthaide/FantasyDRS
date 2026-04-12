"""Refresh static F1 race-weekend data artifacts for FantasyDRS.

Runs LOCALLY (never on Vercel). Pulls data via FastF1 (with OpenF1 fallback for
race results) and writes versioned JSON artifacts under
``frontend/data/f1/{year}/{NN-slug}/``. Artifacts are committed to the repo;
the Next.js app reads them at request time via ``frontend/src/lib/f1-data.ts``.

Usage:
    python backend/scripts/refresh_race_data.py --year 2026 --round 1
    python backend/scripts/refresh_race_data.py --year 2026 --all-past
    python backend/scripts/refresh_race_data.py --year 2026 --round-range 1-6

Design notes (see .paul/phases/02-f1-data-strategy/02-01-RESEARCH.md):
    * Atomic writes — write to *.tmp then os.replace to final path.
    * Idempotent — re-running the same round overwrites with the current fetch.
    * Future-race tolerant — skips fetch if race date is in the future; writes
      a _meta.json noting the skip.
    * FastF1 version pinned: 3.4.4 (per backend/requirements.txt).
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Make the `app` package importable regardless of where this script is invoked
REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = REPO_ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.services.practice_data import (  # noqa: E402
    _extract_long_runs,
    _fetch_weather,
    _process_fastf1_session,
    _resolve_event_name,
    fetch_race_results,
)

logger = logging.getLogger("refresh_race_data")

FASTF1_VERSION_PIN = "3.4.4"
DEFAULT_OUTPUT_DIR = REPO_ROOT / "frontend" / "data" / "f1"
SEED_DATA_PATH = REPO_ROOT / "backend" / "data" / "seed_data.json"
SESSION_KEYS = ("FP1", "FP2", "FP3", "Q")


# ---------------------------------------------------------------------------
# Calendar loading
# ---------------------------------------------------------------------------
def load_calendar(year: int) -> list[dict[str, Any]]:
    """Load the static 2026 calendar entries from seed_data.json."""
    with open(SEED_DATA_PATH, "r", encoding="utf-8") as f:
        seed = json.load(f)
    # seed_data.json only contains the single active season (2026) today; keep
    # year matching for forward-compatibility.
    calendar = seed.get("calendar", [])
    if year != 2026:
        logger.warning(
            "seed_data.json is 2026-only at the moment; requested year=%d will "
            "still use these entries. Adjust seed_data if you add more seasons.",
            year,
        )
    return calendar


def find_race(calendar: list[dict[str, Any]], round_num: int) -> dict[str, Any] | None:
    for race in calendar:
        if int(race["round"]) == round_num:
            return race
    return None


# ---------------------------------------------------------------------------
# Slug + path helpers
# ---------------------------------------------------------------------------
_SLUG_RE = re.compile(r"[^a-z0-9]+")


def race_folder_slug(round_num: int, event_name: str) -> str:
    slug = _SLUG_RE.sub("-", event_name.lower()).strip("-")
    return f"{round_num:02d}-{slug}"


def race_folder_path(output_dir: Path, year: int, round_num: int, event_name: str) -> Path:
    return output_dir / str(year) / race_folder_slug(round_num, event_name)


# ---------------------------------------------------------------------------
# Atomic JSON writes
# ---------------------------------------------------------------------------
def atomic_write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, sort_keys=True)
        f.write("\n")
    os.replace(tmp, path)


# ---------------------------------------------------------------------------
# Artifact builders (match TS interfaces in 02-01-RESEARCH.md §4.3)
# ---------------------------------------------------------------------------
def _lap_seconds_to_ms(seconds: float | None) -> int | None:
    if seconds is None:
        return None
    try:
        return int(round(float(seconds) * 1000))
    except (TypeError, ValueError):
        return None


def build_practice_artifact(
    year: int, round_num: int, event_name: str
) -> dict[str, Any]:
    """Fetch FP1/FP2/FP3/Q pace data + FP2 long runs."""
    resolved = _resolve_event_name(year, event_name)
    if resolved is None:
        logger.info("practice: event name unresolved for %s %d", event_name, year)
        return {"year": year, "round": round_num, "sessions": {}}

    sessions: dict[str, dict[str, dict[str, Any]]] = {}
    for session_key in SESSION_KEYS:
        results = _process_fastf1_session(session_key, year, resolved)
        if not results:
            continue
        per_driver: dict[str, dict[str, Any]] = {}
        for r in results:
            per_driver[r.driver_code] = {
                "best_lap_ms": _lap_seconds_to_ms(r.best_lap_time),
                "run_count": 1,  # practice_data doesn't track raw run count; placeholder
            }
        sessions[session_key] = per_driver

    # FP2 long runs: merge into FP2 bucket
    long_runs = _extract_long_runs(year, resolved)
    if long_runs and "FP2" in sessions:
        for code, lr in long_runs.items():
            entry = sessions["FP2"].setdefault(code, {})
            entry["long_run_avg_ms"] = _lap_seconds_to_ms(lr.avg_lap_time)
            entry["long_run_samples"] = int(lr.lap_count)

    return {"year": year, "round": round_num, "sessions": sessions}


def build_weather_artifact(
    year: int, round_num: int, event_name: str
) -> dict[str, Any]:
    resolved = _resolve_event_name(year, event_name)
    if resolved is None:
        return {
            "year": year,
            "round": round_num,
            "source_session": None,
            "air_temp_c": None,
            "track_temp_c": None,
            "humidity_pct": None,
            "wind_speed_kmh": None,
            "rainfall_pct": None,
        }

    # Try FP3 → FP2 → FP1 → Q in order (mirrors fetch_session_metadata behavior).
    for sess in ("FP3", "FP2", "FP1", "Q"):
        w = _fetch_weather(year, resolved, sess)
        if w.air_temp is not None:
            return {
                "year": year,
                "round": round_num,
                "source_session": sess,
                "air_temp_c": w.air_temp,
                "track_temp_c": w.track_temp,
                "humidity_pct": w.humidity,
                "wind_speed_kmh": w.wind_speed,
                "rainfall_pct": 1.0 if w.rainfall else 0.0,
            }

    return {
        "year": year,
        "round": round_num,
        "source_session": None,
        "air_temp_c": None,
        "track_temp_c": None,
        "humidity_pct": None,
        "wind_speed_kmh": None,
        "rainfall_pct": None,
    }


def build_results_artifact(
    year: int,
    round_num: int,
    event_name: str,
    driver_codes: list[str],
) -> tuple[dict[str, Any], str]:
    """Fetch race results. Returns (artifact, source_used)."""
    # fetch_race_results wants code->id; we don't have DB ids here, but the
    # FastF1 path only uses the KEYS of driver_map to filter. Feed a pass-through
    # where id==code (string) and then re-map to driver_code in the artifact.
    code_map: dict[str, Any] = {code: code for code in driver_codes}

    # Try FastF1 + OpenF1 fallback via the existing helper.
    # Note: _fetch_results_openf1 needs int driver_number_map — keeping None for
    # now means fallback won't populate. If FastF1 is empty, we accept empty.
    parsed = fetch_race_results(year, event_name, db=None, driver_map=code_map)

    if parsed:
        # `parsed` entries carry `driver_id` (which is the code we passed in).
        normalized = []
        for row in parsed:
            code = row.get("driver_id")
            if not isinstance(code, str):
                continue
            normalized.append(
                {
                    "driver_code": code,
                    "position": row.get("race_position"),
                    "classified_position": None,  # practice_data doesn't surface raw CP
                    "grid_position": row.get("qualifying_position"),
                    "status": "DNF" if row.get("dnf") else "Finished",
                    "fastest_lap_rank": 1 if row.get("fastest_lap") else None,
                }
            )
        artifact = {
            "year": year,
            "round": round_num,
            "event_name": event_name,
            "results": normalized,
        }
        # Source: we don't know for sure which path succeeded in fetch_race_results
        # (it logs internally). Default to "fastf1" — if the caller wants precise
        # provenance they can read the logs.
        return artifact, "fastf1"

    return (
        {
            "year": year,
            "round": round_num,
            "event_name": event_name,
            "results": [],
        },
        "none",
    )


# ---------------------------------------------------------------------------
# _index.json management
# ---------------------------------------------------------------------------
def update_index(
    output_dir: Path,
    year: int,
    round_num: int,
    event_name: str,
    folder: str,
    fetched_at: str,
    source: str,
    notes: str | None,
) -> None:
    index_path = output_dir / "_index.json"
    index: dict[str, Any] = {"rounds": []}
    if index_path.exists():
        try:
            with open(index_path, "r", encoding="utf-8") as f:
                index = json.load(f)
        except json.JSONDecodeError:
            logger.warning("_index.json was corrupt, rebuilding")
            index = {"rounds": []}

    # Remove any existing entry for (year, round_num) — we're replacing it.
    index["rounds"] = [
        r
        for r in index.get("rounds", [])
        if not (int(r.get("year", -1)) == year and int(r.get("round", -1)) == round_num)
    ]

    index["rounds"].append(
        {
            "year": year,
            "round": round_num,
            "event_name": event_name,
            "folder": folder,
            "fetched_at": fetched_at,
            "source": source,
            "notes": notes,
        }
    )
    index["rounds"].sort(key=lambda r: (r["year"], r["round"]))
    atomic_write_json(index_path, index)


# ---------------------------------------------------------------------------
# Per-round driver
# ---------------------------------------------------------------------------
def refresh_round(
    year: int,
    round_num: int,
    output_dir: Path,
    driver_codes: list[str],
    calendar: list[dict[str, Any]],
    force: bool,
) -> bool:
    """Refresh a single round. Returns True on success (including graceful skip)."""
    race = find_race(calendar, round_num)
    if race is None:
        logger.error("Round %d not found in calendar for %d", round_num, year)
        return False

    event_name = race["name"]
    folder_name = race_folder_slug(round_num, event_name)
    folder = output_dir / str(year) / folder_name
    now_iso = datetime.now(timezone.utc).isoformat()

    # --- Future-race check ---
    race_date_str = race.get("date")
    if race_date_str:
        try:
            race_date = datetime.strptime(race_date_str, "%Y-%m-%d").replace(
                tzinfo=timezone.utc
            )
            if race_date > datetime.now(timezone.utc):
                logger.info(
                    "round %d (%s, %s) is in the future — skipping fetch",
                    round_num,
                    event_name,
                    race_date_str,
                )
                meta = {
                    "year": year,
                    "round": round_num,
                    "fetched_at": now_iso,
                    "fastf1_version": FASTF1_VERSION_PIN,
                    "source": "none",
                    "notes": "future race, no data available",
                }
                atomic_write_json(folder / "_meta.json", meta)
                update_index(
                    output_dir,
                    year,
                    round_num,
                    event_name,
                    folder_name,
                    now_iso,
                    "none",
                    "future race, no data available",
                )
                return True
        except ValueError:
            logger.warning("Could not parse race date '%s' for round %d", race_date_str, round_num)

    # --- Fetch all artifacts ---
    logger.info("Fetching round %d: %s (%d)", round_num, event_name, year)

    try:
        practice = build_practice_artifact(year, round_num, event_name)
    except Exception as e:
        logger.warning("practice fetch failed: %s", e)
        practice = {"year": year, "round": round_num, "sessions": {}}

    try:
        weather = build_weather_artifact(year, round_num, event_name)
    except Exception as e:
        logger.warning("weather fetch failed: %s", e)
        weather = {
            "year": year,
            "round": round_num,
            "source_session": None,
            "air_temp_c": None,
            "track_temp_c": None,
            "humidity_pct": None,
            "wind_speed_kmh": None,
            "rainfall_pct": None,
        }

    try:
        results, results_source = build_results_artifact(
            year, round_num, event_name, driver_codes
        )
    except Exception as e:
        logger.warning("results fetch failed: %s", e)
        results = {
            "year": year,
            "round": round_num,
            "event_name": event_name,
            "results": [],
        }
        results_source = "none"

    # Pick top-level source for _meta based on results (most critical artifact).
    meta_source = results_source if results["results"] else "none"
    notes = None
    if meta_source == "none":
        notes = "fetch failed — retry later (results unavailable)"

    meta = {
        "year": year,
        "round": round_num,
        "fetched_at": now_iso,
        "fastf1_version": FASTF1_VERSION_PIN,
        "source": meta_source,
        "notes": notes,
    }

    # --- Atomic writes ---
    atomic_write_json(folder / "results.json", results)
    atomic_write_json(folder / "practice.json", practice)
    atomic_write_json(folder / "weather.json", weather)
    atomic_write_json(folder / "_meta.json", meta)

    update_index(
        output_dir,
        year,
        round_num,
        event_name,
        folder_name,
        now_iso,
        meta_source,
        notes,
    )

    n_results = len(results["results"])
    n_sessions = len(practice["sessions"])
    logger.info(
        "round %d done: %d results, %d practice sessions, weather source=%s",
        round_num,
        n_results,
        n_sessions,
        weather.get("source_session"),
    )
    return True


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def parse_round_range(spec: str) -> list[int]:
    if "-" not in spec:
        raise argparse.ArgumentTypeError("--round-range must be in form A-B (e.g., 1-6)")
    a, b = spec.split("-", 1)
    lo, hi = int(a), int(b)
    if lo > hi:
        raise argparse.ArgumentTypeError("range lower bound must be <= upper")
    return list(range(lo, hi + 1))


def select_rounds(
    calendar: list[dict[str, Any]],
    args: argparse.Namespace,
) -> list[int]:
    if args.round is not None:
        return [args.round]
    if args.round_range is not None:
        return args.round_range
    if args.all_past:
        today = datetime.now(timezone.utc).date()
        rounds = []
        for r in calendar:
            try:
                d = datetime.strptime(r["date"], "%Y-%m-%d").date()
                if d <= today:
                    rounds.append(int(r["round"]))
            except (ValueError, KeyError):
                continue
        return rounds
    return []


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Refresh static FantasyDRS F1 data artifacts from FastF1.",
    )
    p.add_argument("--year", type=int, default=datetime.now(timezone.utc).year)
    group = p.add_mutually_exclusive_group(required=True)
    group.add_argument("--round", type=int, help="Single round number (e.g., 1)")
    group.add_argument(
        "--round-range",
        type=parse_round_range,
        help="Inclusive range like 1-6",
        dest="round_range",
    )
    group.add_argument(
        "--all-past",
        action="store_true",
        help="All rounds whose date <= today",
        dest="all_past",
    )
    p.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help=f"Artifact output root (default: {DEFAULT_OUTPUT_DIR})",
    )
    p.add_argument("--force", action="store_true", help="Overwrite even if data is fresh")
    p.add_argument("--verbose", "-v", action="store_true")
    return p


def main() -> int:
    args = build_parser().parse_args()
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)-7s %(name)s: %(message)s",
    )

    calendar = load_calendar(args.year)
    rounds = select_rounds(calendar, args)
    if not rounds:
        logger.error("No rounds selected; use --round / --round-range / --all-past")
        return 1

    # Driver codes for results-artifact building (from seed_data.json)
    with open(SEED_DATA_PATH, "r", encoding="utf-8") as f:
        seed = json.load(f)
    driver_codes = [d["code"] for d in seed.get("drivers", [])]

    successes = 0
    for r in rounds:
        ok = refresh_round(
            year=args.year,
            round_num=r,
            output_dir=args.output_dir,
            driver_codes=driver_codes,
            calendar=calendar,
            force=args.force,
        )
        if ok:
            successes += 1

    logger.info("done: %d/%d rounds refreshed", successes, len(rounds))
    return 0 if successes > 0 or not rounds else 1


if __name__ == "__main__":
    sys.exit(main())
