from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Driver, Constructor, FantasyPrice, SimulationResult, Race, RaceResult
from app.schemas import DriverResponse

router = APIRouter(prefix="/api/drivers", tags=["drivers"])


@router.get("", response_model=list[DriverResponse])
def get_drivers(race_id: int | None = None, db: Session = Depends(get_db)):
    drivers = db.query(Driver).all()
    result = []
    for d in drivers:
        constructor = db.get(Constructor, d.constructor_id)
        price_row = (
            db.query(FantasyPrice)
            .filter_by(asset_type="driver", asset_id=d.id)
            .order_by(FantasyPrice.id.desc())
            .first()
        )
        expected_pts = None
        if race_id:
            sim = (
                db.query(SimulationResult)
                .filter_by(asset_type="driver", asset_id=d.id, race_id=race_id)
                .order_by(SimulationResult.id.desc())
                .first()
            )
            if sim:
                expected_pts = sim.expected_pts_mean

        result.append(DriverResponse(
            id=d.id,
            code=d.code,
            first_name=d.first_name,
            last_name=d.last_name,
            number=d.number,
            constructor_id=d.constructor_id,
            constructor_name=constructor.name if constructor else "",
            constructor_color=constructor.color if constructor else "#888",
            country=d.country,
            price=price_row.price if price_row else 0,
            expected_pts=expected_pts,
        ))
    return result


def _form_trend(driver_id: int, db: Session) -> str:
    """Determine form trend from last 3 race results."""
    results = (
        db.query(RaceResult)
        .filter_by(driver_id=driver_id)
        .join(Race, Race.id == RaceResult.race_id)
        .order_by(Race.round.desc())
        .limit(3)
        .all()
    )
    if len(results) < 2:
        return "stable"
    positions = [r.race_position for r in results if not r.dnf and r.race_position]
    if len(positions) < 2:
        return "stable"
    recent_avg = sum(positions[:2]) / len(positions[:2])
    older_avg = positions[-1]
    diff = older_avg - recent_avg
    if diff > 1.5:
        return "improving"
    elif diff < -1.5:
        return "declining"
    return "stable"


@router.get("/trends")
def get_driver_trends(db: Session = Depends(get_db)):
    """Return form trend for all drivers."""
    drivers = db.query(Driver).all()
    return {d.id: _form_trend(d.id, db) for d in drivers}
