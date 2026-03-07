from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Driver, Constructor, Race, FantasyScore
from app.schemas import ScoreBreakdown

router = APIRouter(prefix="/api/statistics", tags=["statistics"])


@router.get("/driver/{driver_id}", response_model=list[ScoreBreakdown])
def get_driver_stats(driver_id: int, db: Session = Depends(get_db)):
    driver = db.get(Driver, driver_id)
    if not driver:
        return []

    scores = (
        db.query(FantasyScore)
        .filter_by(asset_type="driver", asset_id=driver_id)
        .order_by(FantasyScore.race_id)
        .all()
    )

    result = []
    for s in scores:
        race = db.get(Race, s.race_id) if s.race_id else None
        result.append(ScoreBreakdown(
            asset_type="driver",
            asset_id=driver_id,
            asset_name=f"{driver.first_name} {driver.last_name}",
            race_id=s.race_id or 0,
            race_name=race.name if race else "Unknown",
            qualifying_pts=s.qualifying_pts,
            race_position_pts=s.race_position_pts,
            positions_gained_pts=s.positions_gained_pts,
            overtake_pts=s.overtake_pts,
            fastest_lap_pts=s.fastest_lap_pts,
            dotd_pts=s.dotd_pts,
            dnf_penalty=s.dnf_penalty,
            pitstop_pts=s.pitstop_pts,
            total_pts=s.total_pts,
        ))
    return result


@router.get("/constructor/{constructor_id}", response_model=list[ScoreBreakdown])
def get_constructor_stats(constructor_id: int, db: Session = Depends(get_db)):
    constructor = db.get(Constructor, constructor_id)
    if not constructor:
        return []

    scores = (
        db.query(FantasyScore)
        .filter_by(asset_type="constructor", asset_id=constructor_id)
        .order_by(FantasyScore.race_id)
        .all()
    )

    result = []
    for s in scores:
        race = db.get(Race, s.race_id) if s.race_id else None
        result.append(ScoreBreakdown(
            asset_type="constructor",
            asset_id=constructor_id,
            asset_name=constructor.name,
            race_id=s.race_id or 0,
            race_name=race.name if race else "Unknown",
            qualifying_pts=s.qualifying_pts,
            race_position_pts=s.race_position_pts,
            positions_gained_pts=s.positions_gained_pts,
            overtake_pts=s.overtake_pts,
            fastest_lap_pts=s.fastest_lap_pts,
            dotd_pts=s.dotd_pts,
            dnf_penalty=s.dnf_penalty,
            pitstop_pts=s.pitstop_pts,
            total_pts=s.total_pts,
        ))
    return result


@router.get("/all", response_model=list[ScoreBreakdown])
def get_all_stats(race_id: int | None = None, db: Session = Depends(get_db)):
    query = db.query(FantasyScore)
    if race_id:
        query = query.filter_by(race_id=race_id)
    scores = query.order_by(FantasyScore.race_id).all()

    result = []
    for s in scores:
        if s.asset_type == "driver":
            asset = db.get(Driver, s.asset_id)
            name = f"{asset.first_name} {asset.last_name}" if asset else "Unknown"
        else:
            asset = db.get(Constructor, s.asset_id)
            name = asset.name if asset else "Unknown"

        race = db.get(Race, s.race_id) if s.race_id else None
        result.append(ScoreBreakdown(
            asset_type=s.asset_type,
            asset_id=s.asset_id,
            asset_name=name,
            race_id=s.race_id or 0,
            race_name=race.name if race else "Unknown",
            qualifying_pts=s.qualifying_pts,
            race_position_pts=s.race_position_pts,
            positions_gained_pts=s.positions_gained_pts,
            overtake_pts=s.overtake_pts,
            fastest_lap_pts=s.fastest_lap_pts,
            dotd_pts=s.dotd_pts,
            dnf_penalty=s.dnf_penalty,
            pitstop_pts=s.pitstop_pts,
            total_pts=s.total_pts,
        ))
    return result
