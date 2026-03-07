from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Driver, Constructor, FantasyPrice, SimulationResult
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
