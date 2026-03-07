from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Driver, Constructor, SimulationResult, FantasyPrice
from app.schemas import TransferRequest, SwapSuggestion

router = APIRouter(prefix="/api/transfers", tags=["transfers"])


def _get_sim_pts(db: Session, asset_type: str, asset_id: int, race_id: int) -> float:
    sim = (
        db.query(SimulationResult)
        .filter_by(asset_type=asset_type, asset_id=asset_id, race_id=race_id)
        .order_by(SimulationResult.id.desc())
        .first()
    )
    return sim.expected_pts_mean if sim else 0


def _get_price(db: Session, asset_type: str, asset_id: int) -> float:
    price = (
        db.query(FantasyPrice)
        .filter_by(asset_type=asset_type, asset_id=asset_id)
        .order_by(FantasyPrice.id.desc())
        .first()
    )
    return price.price if price else 0


@router.post("/suggest", response_model=list[SwapSuggestion])
def suggest_transfers(request: TransferRequest, db: Session = Depends(get_db)):
    """Suggest best single swaps for the user's team."""
    suggestions: list[SwapSuggestion] = []

    all_drivers = db.query(Driver).all()
    all_constructors = db.query(Constructor).all()

    # Current team cost
    current_cost = sum(_get_price(db, "driver", did) for did in request.driver_ids) + \
                   sum(_get_price(db, "constructor", cid) for cid in request.constructor_ids)

    # Driver swaps: for each driver in team, try swapping with each driver not in team
    for out_id in request.driver_ids:
        out_pts = _get_sim_pts(db, "driver", out_id, request.race_id)
        out_price = _get_price(db, "driver", out_id)
        out_driver = db.get(Driver, out_id)
        out_constructor = db.get(Constructor, out_driver.constructor_id) if out_driver else None

        for candidate in all_drivers:
            if candidate.id in request.driver_ids:
                continue

            in_pts = _get_sim_pts(db, "driver", candidate.id, request.race_id)
            in_price = _get_price(db, "driver", candidate.id)
            in_constructor = db.get(Constructor, candidate.constructor_id)

            # Check budget: new cost = current_cost - out_price + in_price
            new_cost = current_cost - out_price + in_price
            if new_cost > request.budget:
                continue

            # Apply DRS multiplier if swapping in/out the DRS driver
            effective_out_pts = out_pts * 2 if out_id == request.drs_driver_id else out_pts
            effective_in_pts = in_pts  # New driver wouldn't be DRS by default

            points_gained = effective_in_pts - effective_out_pts

            suggestions.append(SwapSuggestion(
                swap_type="driver",
                out_id=out_id,
                out_name=out_driver.code if out_driver else "?",
                out_color=out_constructor.color if out_constructor else "#6b7280",
                out_points=round(effective_out_pts, 2),
                in_id=candidate.id,
                in_name=candidate.code,
                in_color=in_constructor.color if in_constructor else "#6b7280",
                in_points=round(effective_in_pts, 2),
                points_gained=round(points_gained, 2),
                cost_delta=round(in_price - out_price, 2),
            ))

    # Constructor swaps
    for out_id in request.constructor_ids:
        out_pts = _get_sim_pts(db, "constructor", out_id, request.race_id)
        out_price = _get_price(db, "constructor", out_id)
        out_constructor = db.get(Constructor, out_id)

        for candidate in all_constructors:
            if candidate.id in request.constructor_ids:
                continue

            in_pts = _get_sim_pts(db, "constructor", candidate.id, request.race_id)
            in_price = _get_price(db, "constructor", candidate.id)

            new_cost = current_cost - out_price + in_price
            if new_cost > request.budget:
                continue

            points_gained = in_pts - out_pts

            suggestions.append(SwapSuggestion(
                swap_type="constructor",
                out_id=out_id,
                out_name=out_constructor.name if out_constructor else "?",
                out_color=out_constructor.color if out_constructor else "#6b7280",
                out_points=round(out_pts, 2),
                in_id=candidate.id,
                in_name=candidate.name,
                in_color=candidate.color or "#6b7280",
                in_points=round(in_pts, 2),
                points_gained=round(points_gained, 2),
                cost_delta=round(in_price - out_price, 2),
            ))

    # Sort by points gained, return top 15
    suggestions.sort(key=lambda s: s.points_gained, reverse=True)
    return suggestions[:15]
