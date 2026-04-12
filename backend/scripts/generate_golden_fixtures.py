"""Generate golden-test fixtures from the Python simulation modules.

Produces two JSON files that the TypeScript Vitest golden tests diff against
their own ported modules. Re-running this script is cheap; the tests call it
automatically unless GOLDEN_SKIP_PYTHON=1.

Usage:
    python backend/scripts/generate_golden_fixtures.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# Make the `app` package importable regardless of cwd
REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = REPO_ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.simulation import scoring, parameters  # noqa: E402

FIXTURES_DIR = (
    REPO_ROOT
    / "frontend"
    / "src"
    / "lib"
    / "simulation"
    / "__tests__"
    / "golden-fixtures"
)


def _round(f: float, ndigits: int = 3) -> float:
    """Deterministic rounding so float inputs are stable across runs."""
    return round(f, ndigits)


def build_scoring_fixtures() -> dict:
    # Every constant exported by scoring.py
    constants = {
        "QUALI_POINTS": {str(k): v for k, v in scoring.QUALI_POINTS.items()},
        "QUALI_NC_DSQ_PENALTY": scoring.QUALI_NC_DSQ_PENALTY,
        "SPRINT_QUALI_POINTS": {
            str(k): v for k, v in scoring.SPRINT_QUALI_POINTS.items()
        },
        "RACE_POINTS": {str(k): v for k, v in scoring.RACE_POINTS.items()},
        "SPRINT_POINTS": {str(k): v for k, v in scoring.SPRINT_POINTS.items()},
        "FASTEST_LAP_PTS": scoring.FASTEST_LAP_PTS,
        "DRIVER_OF_THE_DAY_PTS": scoring.DRIVER_OF_THE_DAY_PTS,
        "POSITIONS_CHANGE_MULTIPLIER": scoring.POSITIONS_CHANGE_MULTIPLIER,
        "OVERTAKE_PTS": scoring.OVERTAKE_PTS,
        "BEAT_TEAMMATE_PTS": scoring.BEAT_TEAMMATE_PTS,
        "RACE_DNF_PENALTY": scoring.RACE_DNF_PENALTY,
        "SPRINT_DNF_PENALTY": scoring.SPRINT_DNF_PENALTY,
        "Q2_CUTOFF": scoring.Q2_CUTOFF,
        "Q3_CUTOFF": scoring.Q3_CUTOFF,
        "FASTEST_PITSTOP_BONUS": scoring.FASTEST_PITSTOP_BONUS,
    }

    # Single-position lookups (positions 0..25 covers the full race grid +
    # out-of-range fallbacks that return 0)
    positions = list(range(0, 26))

    score_qualifying_driver = [
        {"input": p, "output": scoring.score_qualifying_driver(p)} for p in positions
    ]
    score_sprint_qualifying_driver = [
        {"input": p, "output": scoring.score_sprint_qualifying_driver(p)}
        for p in positions
    ]
    score_race_position = [
        {"input": p, "output": scoring.score_race_position(p)} for p in positions
    ]
    score_sprint_position = [
        {"input": p, "output": scoring.score_sprint_position(p)} for p in positions
    ]

    # Pairwise grid/finish (1..22 each — 484 cases; covers typical grid sizes)
    grid_range = list(range(1, 23))
    score_positions_changed = [
        {"input": [g, f], "output": scoring.score_positions_changed(g, f)}
        for g in grid_range
        for f in grid_range
    ]

    # Constructor progression — both drivers' positions (1..22 × 1..22)
    score_constructor_qualifying_progression = [
        {
            "input": [p1, p2],
            "output": scoring.score_constructor_qualifying_progression(p1, p2),
        }
        for p1 in grid_range
        for p2 in grid_range
    ]

    # Pitstop time — 0.0..6.0 at 0.05s resolution (121 cases; hits every
    # boundary: <2.0, <2.2, <2.5, <3.0, <5.0, >=5.0)
    pitstop_inputs = [_round(0.05 * i, 2) for i in range(0, 121)]
    score_pitstop_time = [
        {"input": t, "output": scoring.score_pitstop_time(t)} for t in pitstop_inputs
    ]

    return {
        "constants": constants,
        "scoreQualifyingDriver": score_qualifying_driver,
        "scoreSprintQualifyingDriver": score_sprint_qualifying_driver,
        "scoreRacePosition": score_race_position,
        "scoreSprintPosition": score_sprint_position,
        "scorePositionsChanged": score_positions_changed,
        "scoreConstructorQualifyingProgression": score_constructor_qualifying_progression,
        "scorePitstopTime": score_pitstop_time,
    }


def build_parameters_fixtures() -> dict:
    # DRIVER_DEFAULTS — full dict (22 drivers × 5 fields)
    driver_defaults = {
        code: dict(defaults) for code, defaults in parameters.DRIVER_DEFAULTS.items()
    }

    constructor_pitstop_defaults = dict(parameters.CONSTRUCTOR_PITSTOP_DEFAULTS)
    constructor_car_pace_std = dict(parameters.CONSTRUCTOR_CAR_PACE_STD)

    return {
        "DRIVER_DEFAULTS": driver_defaults,
        "CONSTRUCTOR_PITSTOP_DEFAULTS": constructor_pitstop_defaults,
        "CONSTRUCTOR_CAR_PACE_STD": constructor_car_pace_std,
    }


def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, sort_keys=True)
        f.write("\n")


def main() -> int:
    scoring_data = build_scoring_fixtures()
    params_data = build_parameters_fixtures()

    scoring_path = FIXTURES_DIR / "scoring.json"
    params_path = FIXTURES_DIR / "parameters.json"

    write_json(scoring_path, scoring_data)
    write_json(params_path, params_data)

    # Summary
    print("[golden-fixtures] wrote:")
    print(f"  {scoring_path}")
    for section, rows in scoring_data.items():
        if section == "constants":
            print(f"    constants: {len(rows)}")
        else:
            print(f"    {section}: {len(rows)} cases")
    print(f"  {params_path}")
    print(f"    DRIVER_DEFAULTS: {len(params_data['DRIVER_DEFAULTS'])} drivers")
    print(
        f"    CONSTRUCTOR_PITSTOP_DEFAULTS: {len(params_data['CONSTRUCTOR_PITSTOP_DEFAULTS'])}"
    )
    print(
        f"    CONSTRUCTOR_CAR_PACE_STD: {len(params_data['CONSTRUCTOR_CAR_PACE_STD'])}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
