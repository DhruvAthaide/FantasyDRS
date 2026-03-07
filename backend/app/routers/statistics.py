from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Driver, Constructor, Race, FantasyScore, PitstopResult
from app.schemas import ScoreBreakdown, PitstopResultCreate, PitstopResultResponse, PitstopSummary

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


@router.post("/pitstops", response_model=PitstopResultResponse)
def add_pitstop(data: PitstopResultCreate, db: Session = Depends(get_db)):
    # Calculate points: fastest pit = 10pts, 2nd = 5pts, 3rd = 3pts in F1 Fantasy
    pitstop = PitstopResult(
        constructor_id=data.constructor_id,
        race_id=data.race_id,
        stop_number=data.stop_number,
        time_seconds=data.time_seconds,
        is_fastest=data.is_fastest,
        points_scored=10.0 if data.is_fastest else 0.0,
    )
    db.add(pitstop)
    db.commit()
    db.refresh(pitstop)

    constructor = db.get(Constructor, pitstop.constructor_id)
    race = db.get(Race, pitstop.race_id)

    return PitstopResultResponse(
        id=pitstop.id,
        constructor_id=pitstop.constructor_id,
        constructor_name=constructor.name if constructor else "Unknown",
        constructor_color=constructor.color if constructor else "#6b7280",
        race_id=pitstop.race_id,
        race_name=race.name if race else "Unknown",
        stop_number=pitstop.stop_number,
        time_seconds=pitstop.time_seconds,
        points_scored=pitstop.points_scored,
        is_fastest=pitstop.is_fastest,
    )


@router.get("/pitstops", response_model=list[PitstopSummary])
def get_pitstop_summary(db: Session = Depends(get_db)):
    constructors_list = db.query(Constructor).all()
    summaries = []

    for c in constructors_list:
        stops = db.query(PitstopResult).filter_by(constructor_id=c.id).all()
        if not stops:
            summaries.append(PitstopSummary(
                constructor_id=c.id,
                constructor_name=c.name,
                constructor_color=c.color or "#6b7280",
                avg_time=4.0,  # Default estimate
                best_time=4.0,
                total_points=0,
                num_stops=0,
                fastest_count=0,
            ))
            continue

        times = [s.time_seconds for s in stops]
        summaries.append(PitstopSummary(
            constructor_id=c.id,
            constructor_name=c.name,
            constructor_color=c.color or "#6b7280",
            avg_time=round(sum(times) / len(times), 3),
            best_time=round(min(times), 3),
            total_points=sum(s.points_scored for s in stops),
            num_stops=len(stops),
            fastest_count=sum(1 for s in stops if s.is_fastest),
        ))

    return sorted(summaries, key=lambda s: s.avg_time)
