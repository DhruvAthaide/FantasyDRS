from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Driver, Constructor, SimulationResult, FantasyPrice

router = APIRouter(prefix="/api/drs", tags=["drs"])


@router.get("/analyze")
def analyze_drs(race_id: int, driver_ids: str | None = None, db: Session = Depends(get_db)):
    """Analyze DRS (2x captain) value for each driver at a given race."""
    filter_ids = [int(x) for x in driver_ids.split(",")] if driver_ids else None

    drivers = db.query(Driver).all()
    results = []

    for d in drivers:
        if filter_ids and d.id not in filter_ids:
            continue

        sim = (
            db.query(SimulationResult)
            .filter_by(asset_type="driver", asset_id=d.id, race_id=race_id)
            .order_by(SimulationResult.id.desc())
            .first()
        )
        if not sim:
            continue

        constructor = db.get(Constructor, d.constructor_id)
        price_row = (
            db.query(FantasyPrice)
            .filter_by(asset_type="driver", asset_id=d.id)
            .order_by(FantasyPrice.id.desc())
            .first()
        )

        mean = sim.expected_pts_mean or 0
        p10 = sim.expected_pts_p10 or 0
        p90 = sim.expected_pts_p90 or 0
        std = sim.expected_pts_std or 0

        # At 2x: the extra points gained by picking this driver as DRS
        expected_2x = mean * 2
        p10_2x = p10 * 2
        p90_2x = p90 * 2
        extra_from_drs = mean  # DRS gives you mean extra points vs picking them without DRS

        # Risk score: coefficient of variation (lower = safer pick)
        risk_score = round(std / mean, 3) if mean > 0 else 99.0

        # Tier assignment
        if risk_score < 0.3 and mean > 0:
            tier = "safe"
        elif p90 * 2 > mean * 3:
            tier = "upside"
        elif mean <= 0 or risk_score > 1.0:
            tier = "avoid"
        else:
            tier = "neutral"

        results.append({
            "driver_id": d.id,
            "code": d.code,
            "name": f"{d.first_name} {d.last_name}",
            "constructor_color": constructor.color if constructor else "#888",
            "price": price_row.price if price_row else 0,
            "expected_1x": round(mean, 2),
            "expected_2x": round(expected_2x, 2),
            "extra_from_drs": round(extra_from_drs, 2),
            "p10_2x": round(p10_2x, 2),
            "p90_2x": round(p90_2x, 2),
            "std": round(std, 2),
            "risk_score": risk_score,
            "tier": tier,
        })

    results.sort(key=lambda x: x["expected_2x"], reverse=True)
    return results
