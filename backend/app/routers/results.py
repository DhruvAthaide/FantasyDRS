from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import RaceResult, Race, Driver, Constructor, SimulationResult, FantasyPrice
from app.simulation.scoring import (
    score_qualifying_driver, score_race_position, FASTEST_LAP_PTS,
    DRIVER_OF_THE_DAY_PTS, RACE_DNF_PENALTY,
)

router = APIRouter(prefix="/api/results", tags=["results"])


class DriverResultInput(BaseModel):
    driver_id: int
    qualifying_position: int
    race_position: int
    dnf: bool = False
    fastest_lap: bool = False
    dotd: bool = False
    overtakes: int = 0


class BulkResultsRequest(BaseModel):
    results: list[DriverResultInput]


class DriverScorecard(BaseModel):
    driver_id: int
    code: str
    name: str
    constructor_color: str
    qualifying_position: int
    race_position: int
    dnf: bool
    fastest_lap: bool
    dotd: bool
    overtakes: int
    qualifying_pts: float
    race_pts: float
    positions_gained_pts: float
    overtake_pts: float
    fastest_lap_pts: float
    dotd_pts: float
    dnf_penalty: float
    total_pts: float
    predicted_pts: float | None
    prediction_diff: float | None


@router.post("/{race_id}")
def submit_results(race_id: int, request: BulkResultsRequest, db: Session = Depends(get_db)):
    """Submit or overwrite actual race results for a race."""
    race = db.get(Race, race_id)
    if not race:
        raise HTTPException(status_code=404, detail="Race not found")

    # Delete existing results for this race
    db.query(RaceResult).filter_by(race_id=race_id).delete()

    for r in request.results:
        db.add(RaceResult(
            race_id=race_id,
            driver_id=r.driver_id,
            qualifying_position=r.qualifying_position,
            race_position=r.race_position,
            dnf=r.dnf,
            fastest_lap=r.fastest_lap,
            dotd=r.dotd,
            overtakes=r.overtakes,
        ))

    db.commit()
    return {"status": "ok", "count": len(request.results)}


@router.get("/{race_id}")
def get_results(race_id: int, db: Session = Depends(get_db)):
    """Get stored results for a race."""
    results = db.query(RaceResult).filter_by(race_id=race_id).order_by(RaceResult.race_position).all()
    out = []
    for r in results:
        driver = db.get(Driver, r.driver_id)
        constructor = db.get(Constructor, driver.constructor_id) if driver else None
        out.append({
            "driver_id": r.driver_id,
            "code": driver.code if driver else "?",
            "name": f"{driver.first_name} {driver.last_name}" if driver else "?",
            "constructor_color": constructor.color if constructor else "#888",
            "qualifying_position": r.qualifying_position,
            "race_position": r.race_position,
            "dnf": r.dnf,
            "fastest_lap": r.fastest_lap,
            "dotd": r.dotd,
            "overtakes": r.overtakes,
        })
    return out


@router.get("/{race_id}/scorecard")
def get_scorecard(race_id: int, db: Session = Depends(get_db)):
    """Compute actual fantasy scores from stored results and compare vs predictions."""
    results = db.query(RaceResult).filter_by(race_id=race_id).all()
    if not results:
        return []

    scorecards: list[dict] = []
    for r in results:
        driver = db.get(Driver, r.driver_id)
        constructor = db.get(Constructor, driver.constructor_id) if driver else None

        # Compute actual fantasy points
        q_pts = score_qualifying_driver(r.qualifying_position)
        r_pts = 0 if r.dnf else score_race_position(r.race_position)
        positions_gained = r.qualifying_position - r.race_position if not r.dnf else 0
        pos_pts = positions_gained  # +1 per position gained, -1 per lost
        ot_pts = r.overtakes
        fl_pts = FASTEST_LAP_PTS if r.fastest_lap else 0
        dotd_pts = DRIVER_OF_THE_DAY_PTS if r.dotd else 0
        dnf_pen = RACE_DNF_PENALTY if r.dnf else 0

        total = q_pts + r_pts + pos_pts + ot_pts + fl_pts + dotd_pts + dnf_pen

        # Get prediction
        sim = (
            db.query(SimulationResult)
            .filter_by(asset_type="driver", asset_id=r.driver_id, race_id=race_id)
            .order_by(SimulationResult.id.desc())
            .first()
        )
        predicted = sim.expected_pts_mean if sim else None
        diff = round(total - predicted, 2) if predicted is not None else None

        scorecards.append(DriverScorecard(
            driver_id=r.driver_id,
            code=driver.code if driver else "?",
            name=f"{driver.first_name} {driver.last_name}" if driver else "?",
            constructor_color=constructor.color if constructor else "#888",
            qualifying_position=r.qualifying_position,
            race_position=r.race_position,
            dnf=r.dnf,
            fastest_lap=r.fastest_lap,
            dotd=r.dotd,
            overtakes=r.overtakes,
            qualifying_pts=q_pts,
            race_pts=r_pts,
            positions_gained_pts=pos_pts,
            overtake_pts=ot_pts,
            fastest_lap_pts=fl_pts,
            dotd_pts=dotd_pts,
            dnf_penalty=dnf_pen,
            total_pts=total,
            predicted_pts=round(predicted, 2) if predicted is not None else None,
            prediction_diff=diff,
        ).model_dump())

    scorecards.sort(key=lambda x: x["total_pts"], reverse=True)
    return scorecards


@router.get("")
def get_all_results(db: Session = Depends(get_db)):
    """Get list of race_ids that have results."""
    race_ids = db.query(RaceResult.race_id).distinct().all()
    out = []
    for (rid,) in race_ids:
        race = db.get(Race, rid)
        if race:
            out.append({"race_id": rid, "race_name": race.name, "race_round": race.round})
    out.sort(key=lambda x: x["race_round"])
    return out
