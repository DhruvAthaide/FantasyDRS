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

from unittest.mock import patch  # noqa: E402

import numpy as np  # noqa: E402

from app.simulation import scoring, parameters  # noqa: E402
from app.simulation.engine import (  # noqa: E402
    ConstructorParams,
    DriverParams,
    CircuitTraits,
    WeatherConfig,
    simulate_race_weekend,
)
from app.simulation.optimizer import (  # noqa: E402
    Asset as OptAsset,
    find_best_teams,
)

from dataclasses import asdict  # noqa: E402

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


# ---------------------------------------------------------------------------
# Engine fixtures — seeded Monte Carlo outputs for 4 canonical scenarios
# ---------------------------------------------------------------------------
# Driver code → constructor ref_id (mirrors backend/data/seed_data.json)
DRIVER_TO_CONSTRUCTOR = {
    "RUS": "mercedes",    "ANT": "mercedes",
    "NOR": "mclaren",     "PIA": "mclaren",
    "VER": "red_bull",    "HAD": "red_bull",
    "LEC": "ferrari",     "HAM": "ferrari",
    "GAS": "alpine",      "COL": "alpine",
    "SAI": "williams",    "ALB": "williams",
    "ALO": "aston_martin","STR": "aston_martin",
    "BEA": "haas",        "OCO": "haas",
    "HUL": "audi",        "BOR": "audi",
    "LAW": "rb",          "LIN": "rb",
    "PER": "cadillac",    "BOT": "cadillac",
}

# Deterministic driver id assignment — insertion order matches seed_data.json driver list
_DRIVER_ORDER = [
    "VER", "RUS", "NOR", "PIA", "ANT", "LEC", "HAM", "HAD", "GAS", "SAI",
    "ALB", "ALO", "STR", "BEA", "OCO", "LAW", "HUL", "BOR", "COL", "LIN",
    "PER", "BOT",
]
# Constructor ref_id → id assignment (order matches seed_data.json constructor list)
_CONSTRUCTOR_ORDER = [
    "mercedes", "mclaren", "red_bull", "ferrari", "alpine", "williams",
    "aston_martin", "haas", "audi", "rb", "cadillac",
]


def _build_canonical_grid() -> tuple[list[DriverParams], list[ConstructorParams]]:
    """Build 22-driver, 11-constructor grid using DRIVER_DEFAULTS."""
    driver_objs: list[DriverParams] = []
    for i, code in enumerate(_DRIVER_ORDER, start=1):
        defaults = parameters.DRIVER_DEFAULTS[code]
        driver_objs.append(
            DriverParams(
                id=i,
                code=code,
                constructor_ref=DRIVER_TO_CONSTRUCTOR[code],
                qpace_mean=defaults["qpace_mean"],
                qpace_std=defaults["qpace_std"],
                dnf_probability=defaults["dnf_pct"],
                fl_probability=defaults["fl_pct"],
                avg_positions_gained=defaults["avg_pos_gained"],
                grid_penalty=0,
            )
        )

    code_to_id = {d.code: d.id for d in driver_objs}
    constructor_objs: list[ConstructorParams] = []
    for i, ref in enumerate(_CONSTRUCTOR_ORDER, start=1):
        driver_ids = [
            code_to_id[code]
            for code in _DRIVER_ORDER
            if DRIVER_TO_CONSTRUCTOR[code] == ref
        ]
        constructor_objs.append(
            ConstructorParams(
                id=i,
                ref_id=ref,
                driver_ids=driver_ids,
                expected_pitstop_pts=parameters.CONSTRUCTOR_PITSTOP_DEFAULTS.get(ref, 4.0),
                car_pace_std=parameters.CONSTRUCTOR_CAR_PACE_STD.get(ref, 1.5),
            )
        )
    return driver_objs, constructor_objs


def _serialize_drivers(drivers: list[DriverParams]) -> list[dict]:
    return [
        {
            "id": d.id,
            "code": d.code,
            "constructor_ref": d.constructor_ref,
            "qpace_mean": d.qpace_mean,
            "qpace_std": d.qpace_std,
            "dnf_probability": d.dnf_probability,
            "fl_probability": d.fl_probability,
            "avg_positions_gained": d.avg_positions_gained,
            "grid_penalty": d.grid_penalty,
        }
        for d in drivers
    ]


def _serialize_constructors(constructors: list[ConstructorParams]) -> list[dict]:
    return [
        {
            "id": c.id,
            "ref_id": c.ref_id,
            "driver_ids": list(c.driver_ids),
            "expected_pitstop_pts": c.expected_pitstop_pts,
            "car_pace_std": c.car_pace_std,
        }
        for c in constructors
    ]


def _run_seeded(
    drivers: list[DriverParams],
    constructors: list[ConstructorParams],
    circuit: CircuitTraits | None,
    weather: WeatherConfig | None,
    is_sprint: bool,
    n_simulations: int,
    seed: int,
) -> list[dict]:
    """Monkey-patch numpy.random.default_rng so engine.py gets a seeded stream."""
    # Capture the real factory BEFORE patching to avoid self-recursion
    real_default_rng = np.random.default_rng
    seeded_factory = lambda *a, **kw: real_default_rng(seed)
    with patch(
        "app.simulation.engine.np.random.default_rng", seeded_factory
    ):
        results = simulate_race_weekend(
            drivers=drivers,
            constructors=constructors,
            circuit=circuit,
            is_sprint=is_sprint,
            n_simulations=n_simulations,
            weather=weather,
        )
    return [
        {
            "asset_type": r.asset_type,
            "asset_id": r.asset_id,
            "mean": round(r.mean, 6),
            "median": round(r.median, 6),
            "std": round(r.std, 6),
            "p10": round(r.p10, 6),
            "p90": round(r.p90, 6),
        }
        for r in results
    ]


def build_engine_fixtures() -> dict:
    drivers, constructors = _build_canonical_grid()
    seed = 42
    n_sim = 10000

    scenarios: dict[str, dict] = {}

    # 1. baseline_dry_race
    scenarios["baseline_dry_race"] = {
        "inputs": {
            "drivers": _serialize_drivers(drivers),
            "constructors": _serialize_constructors(constructors),
            "circuit": None,
            "weather": None,
            "is_sprint": False,
            "n_simulations": n_sim,
            "seed": seed,
        },
        "outputs": _run_seeded(drivers, constructors, None, None, False, n_sim, seed),
    }

    # 2. sprint_dry
    scenarios["sprint_dry"] = {
        "inputs": {
            "drivers": _serialize_drivers(drivers),
            "constructors": _serialize_constructors(constructors),
            "circuit": None,
            "weather": None,
            "is_sprint": True,
            "n_simulations": n_sim,
            "seed": seed,
        },
        "outputs": _run_seeded(drivers, constructors, None, None, True, n_sim, seed),
    }

    # 3. wet_race
    wet = WeatherConfig(is_wet=True)
    scenarios["wet_race"] = {
        "inputs": {
            "drivers": _serialize_drivers(drivers),
            "constructors": _serialize_constructors(constructors),
            "circuit": None,
            "weather": {
                "is_wet": True,
                "quali_std_multiplier": wet.quali_std_multiplier,
                "race_noise_multiplier": wet.race_noise_multiplier,
                "dnf_multiplier": wet.dnf_multiplier,
            },
            "is_sprint": False,
            "n_simulations": n_sim,
            "seed": seed,
        },
        "outputs": _run_seeded(drivers, constructors, None, wet, False, n_sim, seed),
    }

    # 4. street_circuit (Monaco-like: very hard overtaking)
    street = CircuitTraits(
        overtake_difficulty=0.95,
        high_speed=0.15,
        street_circuit=True,
        altitude=30,
        avg_degradation=0.2,
    )
    scenarios["street_circuit"] = {
        "inputs": {
            "drivers": _serialize_drivers(drivers),
            "constructors": _serialize_constructors(constructors),
            "circuit": {
                "overtake_difficulty": street.overtake_difficulty,
                "high_speed": street.high_speed,
                "street_circuit": street.street_circuit,
                "altitude": street.altitude,
                "avg_degradation": street.avg_degradation,
            },
            "weather": None,
            "is_sprint": False,
            "n_simulations": n_sim,
            "seed": seed,
        },
        "outputs": _run_seeded(drivers, constructors, street, None, False, n_sim, seed),
    }

    return {"scenarios": scenarios}


# ---------------------------------------------------------------------------
# Optimizer fixtures — deterministic; exhaustive exact-match golden tests
# ---------------------------------------------------------------------------
_CONSTRUCTOR_DISPLAY_NAMES = {
    "mercedes": "Mercedes",
    "mclaren": "McLaren",
    "red_bull": "Red Bull",
    "ferrari": "Ferrari",
    "alpine": "Alpine",
    "williams": "Williams",
    "aston_martin": "Aston Martin",
    "haas": "Haas",
    "audi": "Audi",
    "rb": "Racing Bulls",
    "cadillac": "Cadillac",
}


def _load_seed_prices() -> tuple[dict[str, float], dict[str, float], dict[str, str]]:
    """Return (driver_code -> price, constructor_ref -> price, constructor_ref -> color)."""
    seed_path = REPO_ROOT / "backend" / "data" / "seed_data.json"
    with open(seed_path, "r", encoding="utf-8") as f:
        seed = json.load(f)
    driver_prices = {d["code"]: float(d["price"]) for d in seed["drivers"]}
    ctor_prices = {c["id"]: float(c["price"]) for c in seed["constructors"]}
    ctor_colors = {c["id"]: str(c["color"]) for c in seed["constructors"]}
    return driver_prices, ctor_prices, ctor_colors


def _build_canonical_assets() -> tuple[list[OptAsset], list[OptAsset]]:
    """Canonical 22-driver + 11-constructor Asset lists with synthetic expected_pts."""
    driver_prices, ctor_prices, ctor_colors = _load_seed_prices()

    driver_assets: list[OptAsset] = []
    for i, code in enumerate(_DRIVER_ORDER, start=1):
        defaults = parameters.DRIVER_DEFAULTS[code]
        # expected_pts: pole favorite (qpace_mean≈1) ≈ 28.8; backmarker (≈14.5) ≈ 13.8
        expected = round(30.0 - (defaults["qpace_mean"] - 1.0) * 1.2, 2)
        ctor_ref = DRIVER_TO_CONSTRUCTOR[code]
        driver_assets.append(
            OptAsset(
                id=i,
                code=code,
                price=driver_prices[code],
                expected_pts=expected,
                asset_type="driver",
                constructor_name=_CONSTRUCTOR_DISPLAY_NAMES.get(ctor_ref, ctor_ref),
                constructor_color=ctor_colors.get(ctor_ref, ""),
            )
        )

    ctor_assets: list[OptAsset] = []
    for i, ref in enumerate(_CONSTRUCTOR_ORDER, start=1):
        team_codes = [c for c in _DRIVER_ORDER if DRIVER_TO_CONSTRUCTOR[c] == ref]
        avg_qpace = sum(
            parameters.DRIVER_DEFAULTS[c]["qpace_mean"] for c in team_codes
        ) / max(1, len(team_codes))
        expected = round(50.0 - (avg_qpace - 1.0) * 1.5, 2)
        ctor_assets.append(
            OptAsset(
                id=i,
                code=ref,
                price=ctor_prices.get(ref, 0.0),
                expected_pts=expected,
                asset_type="constructor",
                constructor_name=_CONSTRUCTOR_DISPLAY_NAMES.get(ref, ref),
                constructor_color=ctor_colors.get(ref, ""),
            )
        )
    return driver_assets, ctor_assets


def _serialize_optimizer_asset(a: OptAsset) -> dict:
    return asdict(a)


def _serialize_optimal_team(team) -> dict:
    return {
        "drivers": [_serialize_optimizer_asset(d) for d in team.drivers],
        "constructors": [_serialize_optimizer_asset(c) for c in team.constructors],
        "drs_driver": _serialize_optimizer_asset(team.drs_driver),
        "total_cost": round(team.total_cost, 6),
        "total_points": team.total_points,
        "budget_remaining": team.budget_remaining,
    }


def _run_optimizer(
    drivers: list[OptAsset],
    constructors: list[OptAsset],
    **params,
) -> list[dict]:
    teams = find_best_teams(drivers, constructors, **params)
    return [_serialize_optimal_team(t) for t in teams]


def build_optimizer_fixtures() -> dict:
    drivers, constructors = _build_canonical_assets()
    ver_id = _DRIVER_ORDER.index("VER") + 1  # Verstappen's deterministic id

    def inputs_bundle(extra: dict) -> dict:
        return {
            "drivers": [_serialize_optimizer_asset(d) for d in drivers],
            "constructors": [_serialize_optimizer_asset(c) for c in constructors],
            **extra,
        }

    scenarios: dict[str, dict] = {}

    # 1. default
    scenarios["default"] = {
        "inputs": inputs_bundle({"budget": 100.0, "top_n": 10}),
        "outputs": _run_optimizer(drivers, constructors, budget=100.0, top_n=10),
    }

    # 2. tight_budget
    scenarios["tight_budget"] = {
        "inputs": inputs_bundle({"budget": 75.0, "top_n": 5}),
        "outputs": _run_optimizer(drivers, constructors, budget=75.0, top_n=5),
    }

    # 3. include_driver_ver
    scenarios["include_driver_ver"] = {
        "inputs": inputs_bundle(
            {"budget": 100.0, "top_n": 10, "include_driver_ids": [ver_id]}
        ),
        "outputs": _run_optimizer(
            drivers, constructors, budget=100.0, top_n=10, include_driver_ids=[ver_id]
        ),
    }

    # 4. exclude_driver_ver
    scenarios["exclude_driver_ver"] = {
        "inputs": inputs_bundle(
            {"budget": 100.0, "top_n": 10, "exclude_driver_ids": [ver_id]}
        ),
        "outputs": _run_optimizer(
            drivers, constructors, budget=100.0, top_n=10, exclude_driver_ids=[ver_id]
        ),
    }

    # 5. custom_drs_3x
    scenarios["custom_drs_3x"] = {
        "inputs": inputs_bundle(
            {"budget": 100.0, "top_n": 10, "drs_multiplier": 3}
        ),
        "outputs": _run_optimizer(
            drivers, constructors, budget=100.0, top_n=10, drs_multiplier=3
        ),
    }

    return {"scenarios": scenarios}


def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, sort_keys=True)
        f.write("\n")


def main() -> int:
    scoring_data = build_scoring_fixtures()
    params_data = build_parameters_fixtures()
    engine_data = build_engine_fixtures()
    optimizer_data = build_optimizer_fixtures()

    scoring_path = FIXTURES_DIR / "scoring.json"
    params_path = FIXTURES_DIR / "parameters.json"
    engine_path = FIXTURES_DIR / "engine.json"
    optimizer_path = FIXTURES_DIR / "optimizer.json"

    write_json(scoring_path, scoring_data)
    write_json(params_path, params_data)
    write_json(engine_path, engine_data)
    write_json(optimizer_path, optimizer_data)

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
    print(f"  {engine_path}")
    for name, sc in engine_data["scenarios"].items():
        n_drivers = sum(1 for o in sc["outputs"] if o["asset_type"] == "driver")
        n_ctors = sum(1 for o in sc["outputs"] if o["asset_type"] == "constructor")
        print(f"    {name}: {n_drivers} drivers + {n_ctors} constructors")
    print(f"  {optimizer_path}")
    for name, sc in optimizer_data["scenarios"].items():
        print(f"    {name}: {len(sc['outputs'])} teams")
    return 0


if __name__ == "__main__":
    sys.exit(main())
