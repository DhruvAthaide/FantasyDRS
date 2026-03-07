"""Brute-force team optimizer — finds best 5-driver + 2-constructor teams within budget."""

from itertools import combinations
from dataclasses import dataclass


@dataclass
class Asset:
    id: int
    code: str
    price: float
    expected_pts: float
    asset_type: str
    constructor_name: str = ""
    constructor_color: str = ""


@dataclass
class OptimalTeam:
    drivers: list[Asset]
    constructors: list[Asset]
    drs_driver: Asset
    total_cost: float
    total_points: float
    budget_remaining: float


def find_best_teams(
    drivers: list[Asset],
    constructors: list[Asset],
    budget: float = 100.0,
    include_driver_ids: list[int] | None = None,
    exclude_driver_ids: list[int] | None = None,
    include_constructor_ids: list[int] | None = None,
    exclude_constructor_ids: list[int] | None = None,
    drs_multiplier: int = 2,
    top_n: int = 10,
) -> list[OptimalTeam]:
    include_driver_ids = set(include_driver_ids or [])
    exclude_driver_ids = set(exclude_driver_ids or [])
    include_constructor_ids = set(include_constructor_ids or [])
    exclude_constructor_ids = set(exclude_constructor_ids or [])

    avail_drivers = [d for d in drivers if d.id not in exclude_driver_ids]
    avail_constructors = [c for c in constructors if c.id not in exclude_constructor_ids]

    # Pre-compute constructor combos
    valid_c_combos = []
    for c_combo in combinations(avail_constructors, 2):
        c_ids = {c.id for c in c_combo}
        if include_constructor_ids and not include_constructor_ids.issubset(c_ids):
            continue
        c_cost = sum(c.price for c in c_combo)
        c_pts = sum(c.expected_pts for c in c_combo)
        valid_c_combos.append((c_combo, c_cost, c_pts))

    # Sort constructor combos by cost ascending for early pruning
    valid_c_combos.sort(key=lambda x: x[1])

    best_teams: list[tuple[float, OptimalTeam]] = []
    min_score = float("-inf")

    for d_combo in combinations(avail_drivers, 5):
        d_ids = {d.id for d in d_combo}
        if include_driver_ids and not include_driver_ids.issubset(d_ids):
            continue

        d_cost = sum(d.price for d in d_combo)
        d_pts = sum(d.expected_pts for d in d_combo)

        # Best DRS boost driver
        drs_driver = max(d_combo, key=lambda d: d.expected_pts)
        drs_bonus = drs_driver.expected_pts * (drs_multiplier - 1)

        for c_combo, c_cost, c_pts in valid_c_combos:
            total_cost = d_cost + c_cost
            if total_cost > budget:
                continue

            total_pts = d_pts + c_pts + drs_bonus

            if len(best_teams) >= top_n and total_pts <= min_score:
                continue

            team = OptimalTeam(
                drivers=list(d_combo),
                constructors=list(c_combo),
                drs_driver=drs_driver,
                total_cost=total_cost,
                total_points=round(total_pts, 2),
                budget_remaining=round(budget - total_cost, 2),
            )

            best_teams.append((total_pts, team))
            best_teams.sort(key=lambda x: x[0], reverse=True)
            if len(best_teams) > top_n:
                best_teams.pop()
                min_score = best_teams[-1][0]

    return [t for _, t in best_teams]
