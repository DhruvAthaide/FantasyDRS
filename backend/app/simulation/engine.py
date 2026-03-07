"""Monte Carlo simulation engine for F1 Fantasy point predictions."""

import numpy as np
from dataclasses import dataclass, field
from .scoring import (
    score_qualifying_driver,
    score_race_position,
    score_sprint_position,
    score_constructor_qualifying_progression,
)


@dataclass
class DriverParams:
    id: int
    code: str
    constructor_ref: str
    qpace_mean: float
    qpace_std: float
    dnf_probability: float
    fl_probability: float
    avg_positions_gained: float
    grid_penalty: int = 0


@dataclass
class ConstructorParams:
    id: int
    ref_id: str
    driver_ids: list[int] = field(default_factory=list)
    expected_pitstop_pts: float = 3.0


@dataclass
class SimResult:
    asset_type: str
    asset_id: int
    mean: float
    median: float
    std: float
    p10: float
    p90: float


def simulate_race_weekend(
    drivers: list[DriverParams],
    constructors: list[ConstructorParams],
    overtake_difficulty: float = 0.5,
    is_sprint: bool = False,
    n_simulations: int = 10000,
) -> list[SimResult]:
    n_drivers = len(drivers)
    rng = np.random.default_rng()

    driver_points = {d.id: np.zeros(n_simulations) for d in drivers}
    constructor_points = {c.id: np.zeros(n_simulations) for c in constructors}

    # Build lookup maps
    driver_map = {d.id: d for d in drivers}
    constructor_driver_map = {}
    for c in constructors:
        for did in c.driver_ids:
            constructor_driver_map[did] = c.id

    # Pre-generate all random numbers
    quali_samples = rng.normal(
        loc=[d.qpace_mean for d in drivers],
        scale=[d.qpace_std for d in drivers],
        size=(n_simulations, n_drivers),
    )
    race_noise = rng.normal(
        loc=0, scale=[d.qpace_std * 1.2 for d in drivers],
        size=(n_simulations, n_drivers),
    )
    dnf_rolls = rng.random(size=(n_simulations, n_drivers))
    fl_rolls = rng.random(size=n_simulations)

    overtake_ease = 1.0 - overtake_difficulty

    for sim in range(n_simulations):
        # --- QUALIFYING ---
        raw_quali = quali_samples[sim]
        quali_order = np.argsort(raw_quali)
        quali_positions = np.empty(n_drivers, dtype=int)
        for rank, idx in enumerate(quali_order):
            quali_positions[idx] = rank + 1

        # --- RACE ---
        race_positions = np.empty(n_drivers, dtype=int)
        is_dnf = np.zeros(n_drivers, dtype=bool)
        start_positions = np.empty(n_drivers, dtype=int)

        for i, d in enumerate(drivers):
            start_pos = quali_positions[i] + d.grid_penalty
            start_pos = max(1, min(n_drivers, start_pos))
            start_positions[i] = start_pos

            if dnf_rolls[sim, i] < d.dnf_probability:
                is_dnf[i] = True
                continue

            # Race position = base Rpace + noise + overtake adjustment
            rpace = d.qpace_mean - d.avg_positions_gained * overtake_ease
            sampled = rpace + race_noise[sim, i]
            sampled = max(1, min(n_drivers, sampled))
            race_positions[i] = int(round(sampled))

        # Resolve race ties for non-DNF drivers
        active_indices = np.where(~is_dnf)[0]
        if len(active_indices) > 0:
            active_raw = race_positions[active_indices]
            active_order = np.argsort(active_raw)
            for rank, order_idx in enumerate(active_order):
                race_positions[active_indices[order_idx]] = rank + 1

        # --- FASTEST LAP ---
        fl_weights = np.array([d.fl_probability if not is_dnf[i] else 0 for i, d in enumerate(drivers)])
        total_w = fl_weights.sum()
        if total_w > 0:
            fl_weights /= total_w
            cumsum = np.cumsum(fl_weights)
            fl_idx = np.searchsorted(cumsum, fl_rolls[sim])
            fl_idx = min(fl_idx, n_drivers - 1)
        else:
            fl_idx = 0

        # --- SCORE DRIVERS ---
        for i, d in enumerate(drivers):
            pts = 0.0
            q_pos = int(quali_positions[i])
            pts += score_qualifying_driver(q_pos)

            if is_dnf[i]:
                pts -= 10 if is_sprint else 20
            else:
                r_pos = int(race_positions[i])
                if is_sprint:
                    pts += score_sprint_position(r_pos)
                else:
                    pts += score_race_position(r_pos)

                pos_change = int(start_positions[i]) - r_pos
                pts += pos_change

                if pos_change > 0:
                    pts += int(pos_change * 0.7)

                if i == fl_idx:
                    pts += 10

            driver_points[d.id][sim] = pts

        # --- SCORE CONSTRUCTORS ---
        for c in constructors:
            c_pts = 0.0
            d_indices = [idx for idx, d in enumerate(drivers) if d.id in c.driver_ids]

            if len(d_indices) < 2:
                continue

            d0, d1 = d_indices[0], d_indices[1]
            q0 = int(quali_positions[d0])
            q1 = int(quali_positions[d1])
            c_pts += score_qualifying_driver(q0) + score_qualifying_driver(q1)
            c_pts += score_constructor_qualifying_progression(q0, q1)

            for di in [d0, d1]:
                if is_dnf[di]:
                    c_pts -= 10 if is_sprint else 20
                else:
                    r_pos = int(race_positions[di])
                    if is_sprint:
                        c_pts += score_sprint_position(r_pos)
                    else:
                        c_pts += score_race_position(r_pos)
                    pos_change = int(start_positions[di]) - r_pos
                    c_pts += pos_change
                    if pos_change > 0:
                        c_pts += int(pos_change * 0.7)

            if not is_sprint:
                c_pts += c.expected_pitstop_pts

            constructor_points[c.id][sim] = c_pts

    # --- COMPUTE RESULTS ---
    results = []
    for d in drivers:
        pts = driver_points[d.id]
        results.append(SimResult(
            asset_type="driver",
            asset_id=d.id,
            mean=float(np.mean(pts)),
            median=float(np.median(pts)),
            std=float(np.std(pts)),
            p10=float(np.percentile(pts, 10)),
            p90=float(np.percentile(pts, 90)),
        ))
    for c in constructors:
        pts = constructor_points[c.id]
        results.append(SimResult(
            asset_type="constructor",
            asset_id=c.id,
            mean=float(np.mean(pts)),
            median=float(np.median(pts)),
            std=float(np.std(pts)),
            p10=float(np.percentile(pts, 10)),
            p90=float(np.percentile(pts, 90)),
        ))

    return results
