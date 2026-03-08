from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import RaceResult, Race, Driver, Constructor, SimulationResult
from app.simulation.scoring import (
    score_qualifying_driver, score_race_position, FASTEST_LAP_PTS,
    DRIVER_OF_THE_DAY_PTS, RACE_DNF_PENALTY,
)

router = APIRouter(prefix="/api/season", tags=["season"])


def _compute_driver_race_pts(r: RaceResult) -> float:
    """Compute total fantasy points for a single driver-race result."""
    q_pts = score_qualifying_driver(r.qualifying_position)
    r_pts = 0 if r.dnf else score_race_position(r.race_position)
    pos_pts = (r.qualifying_position - r.race_position) if not r.dnf else 0
    ot_pts = r.overtakes or 0
    fl_pts = FASTEST_LAP_PTS if r.fastest_lap else 0
    dotd_pts = DRIVER_OF_THE_DAY_PTS if r.dotd else 0
    dnf_pen = RACE_DNF_PENALTY if r.dnf else 0
    return q_pts + r_pts + pos_pts + ot_pts + fl_pts + dotd_pts + dnf_pen


@router.get("/summary")
def season_summary(db: Session = Depends(get_db)):
    """Aggregate season performance across all races with results."""
    # Get all race IDs that have results
    race_ids = [rid for (rid,) in db.query(RaceResult.race_id).distinct().all()]
    if not race_ids:
        return {"drivers": [], "races_completed": 0}

    races = {r.id: r for r in db.query(Race).filter(Race.id.in_(race_ids)).all()}
    drivers = {d.id: d for d in db.query(Driver).all()}
    constructors = {c.id: c for c in db.query(Constructor).all()}

    # Build per-driver season data
    driver_seasons: dict[int, dict] = {}
    for rid in sorted(race_ids, key=lambda x: races[x].round if x in races else 0):
        results = db.query(RaceResult).filter_by(race_id=rid).all()
        race = races.get(rid)
        if not race:
            continue

        for r in results:
            pts = _compute_driver_race_pts(r)
            d = drivers.get(r.driver_id)
            c = constructors.get(d.constructor_id) if d else None

            if r.driver_id not in driver_seasons:
                driver_seasons[r.driver_id] = {
                    "driver_id": r.driver_id,
                    "code": d.code if d else "?",
                    "name": f"{d.first_name} {d.last_name}" if d else "?",
                    "constructor_color": c.color if c else "#888",
                    "race_points": [],
                    "total_pts": 0,
                    "best_pts": -999,
                    "best_race": "",
                    "worst_pts": 999,
                    "worst_race": "",
                }

            entry = driver_seasons[r.driver_id]
            entry["race_points"].append({
                "race_id": rid,
                "race_round": race.round,
                "race_name": race.name.replace(" Grand Prix", " GP"),
                "points": round(pts, 1),
            })
            entry["total_pts"] = round(entry["total_pts"] + pts, 1)
            if pts > entry["best_pts"]:
                entry["best_pts"] = round(pts, 1)
                entry["best_race"] = race.name.replace(" Grand Prix", " GP")
            if pts < entry["worst_pts"]:
                entry["worst_pts"] = round(pts, 1)
                entry["worst_race"] = race.name.replace(" Grand Prix", " GP")

    # Compute averages and sort
    result = []
    for ds in driver_seasons.values():
        n = len(ds["race_points"])
        ds["avg_pts"] = round(ds["total_pts"] / n, 1) if n > 0 else 0
        ds["races_completed"] = n
        result.append(ds)

    result.sort(key=lambda x: x["total_pts"], reverse=True)

    return {
        "drivers": result,
        "races_completed": len(race_ids),
    }
