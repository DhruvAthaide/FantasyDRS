"""Default simulation parameters for each driver.

2026 new regulations: all defaults are flattened to equal/unknown since the
pecking order is unknown. These only serve as fallbacks when no practice
session data is available. Once FP1/FP2/FP3 data is fetched from OpenF1,
the simulation will use real lap-time-derived parameters instead.
"""

# Flat defaults: mid-grid qpace for everyone (11.5 for 22 drivers)
# Slight variation only for DNF% (rookies slightly higher)
_MIDGRID = 11.5
_STD = 4.0
_DNF = 0.06
_FL = 1 / 22  # Equal probability for everyone

DRIVER_DEFAULTS = {
    "VER": {"qpace_mean": _MIDGRID, "qpace_std": _STD, "dnf_pct": 0.05, "fl_pct": _FL, "avg_pos_gained": 0.3},
    "RUS": {"qpace_mean": _MIDGRID, "qpace_std": _STD, "dnf_pct": 0.05, "fl_pct": _FL, "avg_pos_gained": 0.3},
    "NOR": {"qpace_mean": _MIDGRID, "qpace_std": _STD, "dnf_pct": 0.05, "fl_pct": _FL, "avg_pos_gained": 0.3},
    "PIA": {"qpace_mean": _MIDGRID, "qpace_std": _STD, "dnf_pct": 0.05, "fl_pct": _FL, "avg_pos_gained": 0.3},
    "ANT": {"qpace_mean": _MIDGRID, "qpace_std": _STD, "dnf_pct": 0.08, "fl_pct": _FL, "avg_pos_gained": 0.3},
    "LEC": {"qpace_mean": _MIDGRID, "qpace_std": _STD, "dnf_pct": 0.05, "fl_pct": _FL, "avg_pos_gained": 0.3},
    "HAM": {"qpace_mean": _MIDGRID, "qpace_std": _STD, "dnf_pct": 0.05, "fl_pct": _FL, "avg_pos_gained": 0.3},
    "HAD": {"qpace_mean": _MIDGRID, "qpace_std": _STD, "dnf_pct": 0.08, "fl_pct": _FL, "avg_pos_gained": 0.3},
    "GAS": {"qpace_mean": _MIDGRID, "qpace_std": _STD, "dnf_pct": _DNF, "fl_pct": _FL, "avg_pos_gained": 0.3},
    "SAI": {"qpace_mean": _MIDGRID, "qpace_std": _STD, "dnf_pct": 0.05, "fl_pct": _FL, "avg_pos_gained": 0.3},
    "ALB": {"qpace_mean": _MIDGRID, "qpace_std": _STD, "dnf_pct": 0.05, "fl_pct": _FL, "avg_pos_gained": 0.3},
    "ALO": {"qpace_mean": _MIDGRID, "qpace_std": _STD, "dnf_pct": 0.05, "fl_pct": _FL, "avg_pos_gained": 0.3},
    "STR": {"qpace_mean": _MIDGRID, "qpace_std": _STD, "dnf_pct": _DNF, "fl_pct": _FL, "avg_pos_gained": 0.3},
    "BEA": {"qpace_mean": _MIDGRID, "qpace_std": _STD, "dnf_pct": 0.08, "fl_pct": _FL, "avg_pos_gained": 0.3},
    "OCO": {"qpace_mean": _MIDGRID, "qpace_std": _STD, "dnf_pct": _DNF, "fl_pct": _FL, "avg_pos_gained": 0.3},
    "LAW": {"qpace_mean": _MIDGRID, "qpace_std": _STD, "dnf_pct": 0.07, "fl_pct": _FL, "avg_pos_gained": 0.3},
    "HUL": {"qpace_mean": _MIDGRID, "qpace_std": _STD, "dnf_pct": _DNF, "fl_pct": _FL, "avg_pos_gained": 0.3},
    "BOR": {"qpace_mean": _MIDGRID, "qpace_std": _STD, "dnf_pct": 0.08, "fl_pct": _FL, "avg_pos_gained": 0.3},
    "COL": {"qpace_mean": _MIDGRID, "qpace_std": _STD, "dnf_pct": 0.08, "fl_pct": _FL, "avg_pos_gained": 0.3},
    "LIN": {"qpace_mean": _MIDGRID, "qpace_std": _STD, "dnf_pct": 0.08, "fl_pct": _FL, "avg_pos_gained": 0.3},
    "PER": {"qpace_mean": _MIDGRID, "qpace_std": _STD, "dnf_pct": _DNF, "fl_pct": _FL, "avg_pos_gained": 0.3},
    "BOT": {"qpace_mean": _MIDGRID, "qpace_std": _STD, "dnf_pct": _DNF, "fl_pct": _FL, "avg_pos_gained": 0.3},
}

# Pitstop points flattened too — no basis for 2026 rankings
CONSTRUCTOR_PITSTOP_DEFAULTS = {
    "red_bull": 4.0,
    "mclaren": 4.0,
    "mercedes": 4.0,
    "ferrari": 4.0,
    "williams": 4.0,
    "alpine": 4.0,
    "aston_martin": 4.0,
    "haas": 4.0,
    "audi": 4.0,
    "rb": 4.0,
    "cadillac": 4.0,
}


def get_dynamic_pitstop_defaults(db) -> dict[str, float]:
    """Query actual pitstop data and return updated estimates per constructor ref_id.
    Falls back to 4.0s when no data exists."""
    from app.models import Constructor, PitstopResult

    result = dict(CONSTRUCTOR_PITSTOP_DEFAULTS)

    constructors = db.query(Constructor).all()
    for c in constructors:
        stops = db.query(PitstopResult).filter_by(constructor_id=c.id).all()
        if stops:
            avg_time = sum(s.time_seconds for s in stops) / len(stops)
            result[c.ref_id] = round(avg_time, 3)

    return result
