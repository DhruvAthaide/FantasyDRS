"""Default simulation parameters for each driver based on expected 2026 performance."""

# Default parameters: qpace_mean, qpace_std, dnf_pct, fl_pct, avg_positions_gained, pitstop_avg_time
# qpace_mean = expected qualifying position (1 = pole, 22 = last)
# These are initial estimates; will be refined with practice session data.

DRIVER_DEFAULTS = {
    "VER": {"qpace_mean": 2.0, "qpace_std": 1.5, "dnf_pct": 0.04, "fl_pct": 0.15, "avg_pos_gained": 0.5},
    "RUS": {"qpace_mean": 2.5, "qpace_std": 1.8, "dnf_pct": 0.05, "fl_pct": 0.12, "avg_pos_gained": 0.3},
    "NOR": {"qpace_mean": 3.0, "qpace_std": 1.5, "dnf_pct": 0.04, "fl_pct": 0.12, "avg_pos_gained": 0.5},
    "PIA": {"qpace_mean": 4.0, "qpace_std": 2.0, "dnf_pct": 0.05, "fl_pct": 0.08, "avg_pos_gained": 0.8},
    "ANT": {"qpace_mean": 4.5, "qpace_std": 2.5, "dnf_pct": 0.07, "fl_pct": 0.06, "avg_pos_gained": 0.3},
    "LEC": {"qpace_mean": 3.5, "qpace_std": 2.0, "dnf_pct": 0.06, "fl_pct": 0.10, "avg_pos_gained": 0.2},
    "HAM": {"qpace_mean": 5.0, "qpace_std": 2.5, "dnf_pct": 0.04, "fl_pct": 0.08, "avg_pos_gained": 0.5},
    "HAD": {"qpace_mean": 7.0, "qpace_std": 3.0, "dnf_pct": 0.08, "fl_pct": 0.03, "avg_pos_gained": 0.5},
    "GAS": {"qpace_mean": 9.0, "qpace_std": 3.0, "dnf_pct": 0.06, "fl_pct": 0.02, "avg_pos_gained": 0.8},
    "SAI": {"qpace_mean": 9.5, "qpace_std": 3.0, "dnf_pct": 0.05, "fl_pct": 0.03, "avg_pos_gained": 0.5},
    "ALB": {"qpace_mean": 10.0, "qpace_std": 3.0, "dnf_pct": 0.05, "fl_pct": 0.02, "avg_pos_gained": 0.3},
    "ALO": {"qpace_mean": 11.0, "qpace_std": 3.5, "dnf_pct": 0.05, "fl_pct": 0.02, "avg_pos_gained": 0.5},
    "STR": {"qpace_mean": 13.0, "qpace_std": 3.5, "dnf_pct": 0.06, "fl_pct": 0.01, "avg_pos_gained": 0.0},
    "BEA": {"qpace_mean": 13.0, "qpace_std": 3.5, "dnf_pct": 0.07, "fl_pct": 0.01, "avg_pos_gained": 0.3},
    "OCO": {"qpace_mean": 13.5, "qpace_std": 3.5, "dnf_pct": 0.06, "fl_pct": 0.01, "avg_pos_gained": 0.2},
    "LAW": {"qpace_mean": 12.0, "qpace_std": 3.5, "dnf_pct": 0.07, "fl_pct": 0.01, "avg_pos_gained": 0.5},
    "HUL": {"qpace_mean": 14.0, "qpace_std": 3.5, "dnf_pct": 0.06, "fl_pct": 0.01, "avg_pos_gained": 0.2},
    "BOR": {"qpace_mean": 15.0, "qpace_std": 4.0, "dnf_pct": 0.08, "fl_pct": 0.01, "avg_pos_gained": 0.3},
    "COL": {"qpace_mean": 14.0, "qpace_std": 4.0, "dnf_pct": 0.08, "fl_pct": 0.01, "avg_pos_gained": 0.3},
    "LIN": {"qpace_mean": 14.5, "qpace_std": 4.0, "dnf_pct": 0.09, "fl_pct": 0.01, "avg_pos_gained": 0.5},
    "PER": {"qpace_mean": 16.0, "qpace_std": 4.0, "dnf_pct": 0.07, "fl_pct": 0.01, "avg_pos_gained": 0.3},
    "BOT": {"qpace_mean": 17.0, "qpace_std": 4.0, "dnf_pct": 0.06, "fl_pct": 0.01, "avg_pos_gained": 0.0},
}

# Constructor expected pitstop points per race (based on team quality)
CONSTRUCTOR_PITSTOP_DEFAULTS = {
    "red_bull": 8.0,
    "mclaren": 7.0,
    "mercedes": 7.0,
    "ferrari": 6.0,
    "williams": 4.0,
    "alpine": 3.5,
    "aston_martin": 4.0,
    "haas": 3.0,
    "audi": 2.5,
    "rb": 4.0,
    "cadillac": 2.0,
}
