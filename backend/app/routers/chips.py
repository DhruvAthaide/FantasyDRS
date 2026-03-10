from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Driver, Constructor, Race, SimulationResult, FantasyPrice
from app.schemas import ChipStrategyResponse, ChipRaceValue
from app.simulation.optimizer import find_best_teams, Asset

router = APIRouter(prefix="/api/chips", tags=["chips"])

CHIP_TYPES = ["wildcard", "limitless", "extra_drs", "final_fix", "autopilot"]


def _get_assets(db: Session, race_id: int) -> tuple[list[Asset], list[Asset]]:
    """Build driver and constructor asset lists with sim results for a race."""
    driver_assets = []
    for d in db.query(Driver).all():
        price_row = db.query(FantasyPrice).filter_by(
            asset_type="driver", asset_id=d.id
        ).order_by(FantasyPrice.id.desc()).first()
        sim = db.query(SimulationResult).filter_by(
            asset_type="driver", asset_id=d.id, race_id=race_id
        ).order_by(SimulationResult.id.desc()).first()
        constructor = db.get(Constructor, d.constructor_id)
        driver_assets.append(Asset(
            id=d.id, code=d.code,
            price=price_row.price if price_row else 0,
            expected_pts=sim.expected_pts_mean if sim else 0,
            asset_type="driver",
            constructor_name=constructor.name if constructor else "",
            constructor_color=constructor.color if constructor else "#888",
        ))

    constructor_assets = []
    for c in db.query(Constructor).all():
        price_row = db.query(FantasyPrice).filter_by(
            asset_type="constructor", asset_id=c.id
        ).order_by(FantasyPrice.id.desc()).first()
        sim = db.query(SimulationResult).filter_by(
            asset_type="constructor", asset_id=c.id, race_id=race_id
        ).order_by(SimulationResult.id.desc()).first()
        constructor_assets.append(Asset(
            id=c.id, code=c.ref_id,
            price=price_row.price if price_row else 0,
            expected_pts=sim.expected_pts_mean if sim else 0,
            asset_type="constructor",
            constructor_name=c.name,
            constructor_color=c.color,
        ))

    return driver_assets, constructor_assets


def _normal_best(drivers: list[Asset], constructors: list[Asset]) -> float:
    """Best team points under normal budget constraints."""
    teams = find_best_teams(drivers, constructors, budget=100.0, top_n=1)
    return teams[0].total_points if teams else 0


def _chip_best(chip_type: str, drivers: list[Asset], constructors: list[Asset]) -> float:
    """Best team points when using a specific chip."""
    if chip_type == "wildcard":
        # Wildcard: free team change, no transfer cost. Same as normal optimal.
        # Value = how different optimal is from your current team (needs user team context)
        # For chip planner, we show "optimal points" as the chip value
        return _normal_best(drivers, constructors)

    elif chip_type == "limitless":
        # Limitless: no budget cap for one race
        teams = find_best_teams(drivers, constructors, budget=9999.0, top_n=1)
        return teams[0].total_points if teams else 0

    elif chip_type == "extra_drs":
        # Extra DRS: 3 DRS drivers instead of 1 (top 3 get 2x multiplier)
        # Approximate: find best team, then apply 2x to top 3 drivers
        teams = find_best_teams(drivers, constructors, budget=100.0, top_n=1, drs_multiplier=2)
        if not teams:
            return 0
        team = teams[0]
        # Re-score: top 3 driver points get 2x
        driver_pts = sorted([d.expected_pts for d in team.drivers], reverse=True)
        base_constructor_pts = sum(c.expected_pts for c in team.constructors)
        # Normal: best driver 2x. Extra DRS: top 3 drivers 2x
        extra_pts = sum(driver_pts[:3]) * 2 + sum(driver_pts[3:]) + base_constructor_pts
        return extra_pts

    elif chip_type == "final_fix":
        # Final Fix: change 1 driver after qualifying. Similar to wildcard for 1 slot.
        # Approximate as normal + small bonus
        return _normal_best(drivers, constructors) * 1.02

    elif chip_type == "autopilot":
        # Autopilot: auto-selects optimal team. Same as normal optimal.
        return _normal_best(drivers, constructors)

    return _normal_best(drivers, constructors)


@router.get("/evaluate", response_model=list[ChipStrategyResponse])
def evaluate_chips(
    chip_type: str = Query("all"),
    db: Session = Depends(get_db),
):
    """Evaluate chip value across all races that have simulation data."""
    races = db.query(Race).order_by(Race.round).all()
    chip_types = [chip_type] if chip_type != "all" and chip_type in CHIP_TYPES else CHIP_TYPES

    results = []
    for ct in chip_types:
        race_values = []
        for race in races:
            # Check if sim data exists
            has_sim = db.query(SimulationResult).filter_by(race_id=race.id).first()
            if not has_sim:
                race_values.append(ChipRaceValue(
                    race_id=race.id, race_name=race.name, race_round=race.round,
                    normal_points=0, chip_points=0, chip_gain=0,
                ))
                continue

            drivers, constructors = _get_assets(db, race.id)
            normal = _normal_best(drivers, constructors)
            chip = _chip_best(ct, drivers, constructors)
            gain = chip - normal

            race_values.append(ChipRaceValue(
                race_id=race.id, race_name=race.name, race_round=race.round,
                normal_points=round(normal, 2),
                chip_points=round(chip, 2),
                chip_gain=round(gain, 2),
            ))

        # Find best race
        best = max(race_values, key=lambda rv: rv.chip_gain) if race_values else None

        results.append(ChipStrategyResponse(
            chip_type=ct,
            race_values=race_values,
            best_race_id=best.race_id if best else 0,
            best_race_name=best.race_name if best else "",
            best_gain=best.chip_gain if best else 0,
        ))

    return results
