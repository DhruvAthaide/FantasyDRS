from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Constructor, Driver, FantasyPrice, SimulationResult
from app.schemas import ConstructorResponse

router = APIRouter(prefix="/api/constructors", tags=["constructors"])


@router.get("", response_model=list[ConstructorResponse])
def get_constructors(race_id: int | None = None, db: Session = Depends(get_db)):
    constructors = db.query(Constructor).all()
    result = []
    for c in constructors:
        driver_codes = [d.code for d in db.query(Driver).filter_by(constructor_id=c.id).all()]
        price_row = (
            db.query(FantasyPrice)
            .filter_by(asset_type="constructor", asset_id=c.id)
            .order_by(FantasyPrice.id.desc())
            .first()
        )
        expected_pts = None
        if race_id:
            sim = (
                db.query(SimulationResult)
                .filter_by(asset_type="constructor", asset_id=c.id, race_id=race_id)
                .order_by(SimulationResult.id.desc())
                .first()
            )
            if sim:
                expected_pts = sim.expected_pts_mean

        result.append(ConstructorResponse(
            id=c.id,
            ref_id=c.ref_id,
            name=c.name,
            color=c.color,
            price=price_row.price if price_row else 0,
            driver_codes=driver_codes,
            expected_pts=expected_pts,
        ))
    return result
