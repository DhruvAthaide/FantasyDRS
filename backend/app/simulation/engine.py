"""Monte Carlo simulation engine for F1 Fantasy point predictions (2026 rules)."""

import numpy as np
from dataclasses import dataclass, field
from .scoring import (
    score_qualifying_driver,
    score_race_position,
    score_sprint_position,
    score_constructor_qualifying_progression,
    FASTEST_LAP_PTS,
    SPRINT_FASTEST_LAP_PTS,
    DRIVER_OF_THE_DAY_PTS,
    RACE_DNF_PENALTY,
    SPRINT_DNF_PENALTY,
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
    expected_pitstop_pts: float = 4.0
    car_pace_std: float = 1.5


@dataclass
class CircuitTraits:
    overtake_difficulty: float = 0.5
    high_speed: float = 0.5
    street_circuit: bool = False
    altitude: int = 0
    avg_degradation: float = 0.5


@dataclass
class WeatherConfig:
    is_wet: bool = False
    quali_std_multiplier: float = 1.5
    race_noise_multiplier: float = 1.4
    dnf_multiplier: float = 1.3


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
    circuit: CircuitTraits | None = None,
    is_sprint: bool = False,
    n_simulations: int = 10000,
    weather: WeatherConfig | None = None,
) -> list[SimResult]:
    n_drivers = len(drivers)
    rng = np.random.default_rng()

    if circuit is None:
        circuit = CircuitTraits()
    if weather is None:
        weather = WeatherConfig()

    driver_points = {d.id: np.zeros(n_simulations) for d in drivers}
    constructor_points = {c.id: np.zeros(n_simulations) for c in constructors}

    # Build lookup maps
    constructor_driver_map = {}
    for c in constructors:
        for did in c.driver_ids:
            constructor_driver_map[did] = c.id

    # [A2] Constructor correlation: map constructor_ref -> driver indices
    constructor_ref_to_indices: dict[str, list[int]] = {}
    for i, d in enumerate(drivers):
        constructor_ref_to_indices.setdefault(d.constructor_ref, []).append(i)

    # [A2] Pre-generate car pace offsets per constructor per simulation
    car_std_map = {c.ref_id: c.car_pace_std for c in constructors}
    car_offsets: dict[str, np.ndarray] = {}
    for ref_id in constructor_ref_to_indices:
        std = car_std_map.get(ref_id, 1.5)
        car_offsets[ref_id] = rng.normal(0, std, size=n_simulations)

    # [A5] Wet weather multipliers
    q_std_mult = weather.quali_std_multiplier if weather.is_wet else 1.0
    r_noise_mult = weather.race_noise_multiplier if weather.is_wet else 1.0
    dnf_mult = weather.dnf_multiplier if weather.is_wet else 1.0

    # Pre-generate random numbers (with weather multipliers applied)
    quali_samples = rng.normal(
        loc=[d.qpace_mean for d in drivers],
        scale=[d.qpace_std * q_std_mult for d in drivers],
        size=(n_simulations, n_drivers),
    )
    race_noise = rng.normal(
        loc=0, scale=[d.qpace_std * 1.2 * r_noise_mult for d in drivers],
        size=(n_simulations, n_drivers),
    )
    dnf_rolls = rng.random(size=(n_simulations, n_drivers))
    fl_rolls = rng.random(size=n_simulations)
    dotd_rolls = rng.random(size=n_simulations)

    # [A3] Safety car rolls
    sc_probability = 0.55 if not circuit.street_circuit else 0.45
    sc_rolls = rng.random(size=n_simulations)

    overtake_ease = 1.0 - circuit.overtake_difficulty

    for sim in range(n_simulations):
        # === QUALIFYING ===
        # [A2] Apply constructor car offset to qualifying samples
        raw_quali = quali_samples[sim].copy()
        for ref_id, indices in constructor_ref_to_indices.items():
            offset = car_offsets[ref_id][sim]
            for idx in indices:
                raw_quali[idx] += offset

        quali_order = np.argsort(raw_quali)
        quali_positions = np.empty(n_drivers, dtype=int)
        for rank, idx in enumerate(quali_order):
            quali_positions[idx] = rank + 1

        # === GRID POSITIONS ===
        grid_positions = np.empty(n_drivers, dtype=int)
        for i, d in enumerate(drivers):
            grid_pos = quali_positions[i] + d.grid_penalty
            grid_pos = max(1, min(n_drivers, grid_pos))
            grid_positions[i] = grid_pos

        # === RACE ===
        race_raw = np.zeros(n_drivers, dtype=float)
        race_positions = np.empty(n_drivers, dtype=int)
        is_dnf = np.zeros(n_drivers, dtype=bool)

        for i, d in enumerate(drivers):
            # [A5] Wet weather increases DNF probability
            effective_dnf = d.dnf_probability * dnf_mult
            if dnf_rolls[sim, i] < effective_dnf:
                is_dnf[i] = True
                continue

            # [A1] Grid-based race positions: start from grid, apply delta
            delta_mean = -d.avg_positions_gained * overtake_ease
            race_raw[i] = grid_positions[i] + delta_mean + race_noise[sim, i]

        # [A3] Safety car: compress field by adding mild noise and re-shuffling
        active_indices = np.where(~is_dnf)[0]
        if len(active_indices) > 0:
            if not is_sprint and sc_rolls[sim] < sc_probability:
                sc_noise = rng.normal(0, 1.5, size=len(active_indices))
                race_raw[active_indices] += sc_noise

            # Resolve final race positions among active drivers
            active_raw = race_raw[active_indices]
            active_order = np.argsort(active_raw)
            for rank, order_idx in enumerate(active_order):
                race_positions[active_indices[order_idx]] = rank + 1

        # === FASTEST LAP ===
        fl_weights = np.array([d.fl_probability if not is_dnf[i] else 0 for i, d in enumerate(drivers)])
        total_w = fl_weights.sum()
        if total_w > 0:
            fl_weights /= total_w
            cumsum = np.cumsum(fl_weights)
            fl_idx = np.searchsorted(cumsum, fl_rolls[sim])
            fl_idx = min(fl_idx, n_drivers - 1)
        else:
            fl_idx = 0

        # === DRIVER OF THE DAY (race only, not sprint) ===
        dotd_idx = -1
        if not is_sprint:
            dotd_weights = np.zeros(n_drivers)
            for i in range(n_drivers):
                if is_dnf[i]:
                    continue
                pos_gain = int(quali_positions[i]) - int(race_positions[i])
                weight = max(0.1, pos_gain + 2.0)
                if race_positions[i] <= 3:
                    weight += 3.0
                dotd_weights[i] = weight
            total_dw = dotd_weights.sum()
            if total_dw > 0:
                dotd_weights /= total_dw
                dotd_cumsum = np.cumsum(dotd_weights)
                dotd_idx = np.searchsorted(dotd_cumsum, dotd_rolls[sim])
                dotd_idx = min(dotd_idx, n_drivers - 1)

        # === SCORE DRIVERS ===
        for i, d in enumerate(drivers):
            pts = 0.0
            q_pos = int(quali_positions[i])

            pts += score_qualifying_driver(q_pos)

            if is_dnf[i]:
                pts += SPRINT_DNF_PENALTY if is_sprint else RACE_DNF_PENALTY
            else:
                r_pos = int(race_positions[i])

                if is_sprint:
                    pts += score_sprint_position(r_pos)
                else:
                    pts += score_race_position(r_pos)

                # Positions gained/lost (quali position vs finish, per official rules)
                pos_change = q_pos - r_pos
                pts += pos_change

                # Overtakes: fraction of positions gained through on-track passes
                if pos_change > 0:
                    overtake_ratio = 0.5 + overtake_ease * 0.3
                    estimated_overtakes = max(0, int(round(pos_change * overtake_ratio)))
                    pts += estimated_overtakes

                if i == fl_idx:
                    pts += SPRINT_FASTEST_LAP_PTS if is_sprint else FASTEST_LAP_PTS

                if not is_sprint and i == dotd_idx:
                    pts += DRIVER_OF_THE_DAY_PTS

            driver_points[d.id][sim] = pts

        # === SCORE CONSTRUCTORS ===
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
                    c_pts += SPRINT_DNF_PENALTY if is_sprint else RACE_DNF_PENALTY
                else:
                    r_pos = int(race_positions[di])

                    if is_sprint:
                        c_pts += score_sprint_position(r_pos)
                    else:
                        c_pts += score_race_position(r_pos)

                    pos_change = int(quali_positions[di]) - r_pos
                    c_pts += pos_change

                    if pos_change > 0:
                        overtake_ratio = 0.5 + overtake_ease * 0.3
                        estimated_overtakes = max(0, int(round(pos_change * overtake_ratio)))
                        c_pts += estimated_overtakes

            if not is_sprint:
                c_pts += c.expected_pitstop_pts

            constructor_points[c.id][sim] = c_pts

    # === COMPUTE RESULTS ===
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
