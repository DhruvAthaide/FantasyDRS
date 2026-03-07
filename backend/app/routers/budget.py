from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Driver, Constructor, FantasyPrice, FantasyScore, SimulationResult
from app.schemas import PricePrediction

router = APIRouter(prefix="/api/price-predictions", tags=["budget"])


def _get_price_tier(price: float) -> dict:
    if price >= 25:
        return {"great": 1.0, "good": 0.3, "poor": -0.3, "terrible": -1.0}
    if price >= 15:
        return {"great": 0.6, "good": 0.2, "poor": -0.2, "terrible": -0.6}
    if price >= 8:
        return {"great": 0.4, "good": 0.1, "poor": -0.1, "terrible": -0.4}
    return {"great": 0.3, "good": 0.1, "poor": -0.1, "terrible": -0.3}


def _predict_change(avg_ppm: float, price: float) -> tuple[float, str]:
    tier = _get_price_tier(price)
    if avg_ppm >= 0.4:
        return tier["great"], "great"
    if avg_ppm >= 0.3:
        return tier["good"], "good"
    if avg_ppm >= 0.2:
        return tier["poor"], "poor"
    return tier["terrible"], "terrible"


@router.get("", response_model=list[PricePrediction])
def get_price_predictions(race_id: int | None = None, db: Session = Depends(get_db)):
    predictions = []

    # Process drivers
    drivers = db.query(Driver).all()
    for d in drivers:
        price_row = (
            db.query(FantasyPrice)
            .filter_by(asset_type="driver", asset_id=d.id)
            .order_by(FantasyPrice.id.desc())
            .first()
        )
        if not price_row:
            continue

        price = price_row.price

        # Get last 3 scores
        scores = (
            db.query(FantasyScore)
            .filter_by(asset_type="driver", asset_id=d.id)
            .order_by(FantasyScore.id.desc())
            .limit(3)
            .all()
        )

        # If no historical scores, use simulation expected pts
        if scores:
            avg_score = sum(s.total_pts for s in scores) / len(scores)
        elif race_id:
            sim = (
                db.query(SimulationResult)
                .filter_by(asset_type="driver", asset_id=d.id, race_id=race_id)
                .order_by(SimulationResult.id.desc())
                .first()
            )
            avg_score = sim.expected_pts_mean if sim else 0
        else:
            avg_score = 0

        avg_ppm = avg_score / price if price > 0 else 0
        predicted_change, category = _predict_change(avg_ppm, price)

        prob_increase = 0.0
        prob_decrease = 0.0
        if avg_ppm >= 0.3:
            prob_increase = min(0.95, 0.5 + (avg_ppm - 0.3) * 5)
            prob_decrease = 1 - prob_increase
        elif avg_ppm < 0.2:
            prob_decrease = min(0.95, 0.5 + (0.2 - avg_ppm) * 5)
            prob_increase = 1 - prob_decrease
        else:
            prob_increase = 0.3
            prob_decrease = 0.7

        predictions.append(PricePrediction(
            asset_type="driver",
            asset_id=d.id,
            asset_name=f"{d.first_name} {d.last_name}",
            current_price=price,
            avg_ppm=round(avg_ppm, 3),
            predicted_change=predicted_change,
            change_category=category,
            probability_increase=round(prob_increase, 2),
            probability_decrease=round(prob_decrease, 2),
        ))

    # Process constructors
    constructors = db.query(Constructor).all()
    for c in constructors:
        price_row = (
            db.query(FantasyPrice)
            .filter_by(asset_type="constructor", asset_id=c.id)
            .order_by(FantasyPrice.id.desc())
            .first()
        )
        if not price_row:
            continue

        price = price_row.price

        scores = (
            db.query(FantasyScore)
            .filter_by(asset_type="constructor", asset_id=c.id)
            .order_by(FantasyScore.id.desc())
            .limit(3)
            .all()
        )

        if scores:
            avg_score = sum(s.total_pts for s in scores) / len(scores)
        elif race_id:
            sim = (
                db.query(SimulationResult)
                .filter_by(asset_type="constructor", asset_id=c.id, race_id=race_id)
                .order_by(SimulationResult.id.desc())
                .first()
            )
            avg_score = sim.expected_pts_mean if sim else 0
        else:
            avg_score = 0

        avg_ppm = avg_score / price if price > 0 else 0
        predicted_change, category = _predict_change(avg_ppm, price)

        prob_increase = 0.0
        prob_decrease = 0.0
        if avg_ppm >= 0.3:
            prob_increase = min(0.95, 0.5 + (avg_ppm - 0.3) * 5)
            prob_decrease = 1 - prob_increase
        elif avg_ppm < 0.2:
            prob_decrease = min(0.95, 0.5 + (0.2 - avg_ppm) * 5)
            prob_increase = 1 - prob_decrease
        else:
            prob_increase = 0.3
            prob_decrease = 0.7

        predictions.append(PricePrediction(
            asset_type="constructor",
            asset_id=c.id,
            asset_name=c.name,
            current_price=price,
            avg_ppm=round(avg_ppm, 3),
            predicted_change=predicted_change,
            change_category=category,
            probability_increase=round(prob_increase, 2),
            probability_decrease=round(prob_decrease, 2),
        ))

    return predictions
