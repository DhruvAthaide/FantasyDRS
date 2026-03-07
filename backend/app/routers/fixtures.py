from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Driver, Constructor, Circuit, Race, FantasyPrice
from app.schemas import FixtureDifficultyRow, FixtureDifficultyEntry

router = APIRouter(prefix="/api/fixtures", tags=["fixtures"])


def _get_asset_price(db: Session, asset_type: str, asset_id: int) -> float:
    """Get most recent price for an asset."""
    price = db.query(FantasyPrice).filter(
        FantasyPrice.asset_type == asset_type,
        FantasyPrice.asset_id == asset_id,
    ).order_by(FantasyPrice.id.desc()).first()
    return price.price if price else 10.0


def _price_to_strength(price: float, min_price: float, max_price: float) -> float:
    """Convert price to 0-1 strength scale (higher price = stronger)."""
    if max_price == min_price:
        return 0.5
    return (price - min_price) / (max_price - min_price)


def _circuit_difficulty_for_driver(strength: float, circuit: Circuit) -> float:
    """
    Heuristic difficulty rating for a driver at a circuit.
    Higher = harder fixture (less likely to score well).

    Factors:
    - Overtake difficulty: high OT difficulty hurts weaker drivers more (can't recover),
      but helps strong drivers (they keep position)
    - Street circuits: higher variance, harder for midfield
    - Degradation: high deg circuits reward consistency (top teams)
    """
    ot = circuit.overtake_difficulty or 0.5
    hs = circuit.high_speed or 0.5
    street = 1.0 if circuit.street_circuit else 0.0
    deg = circuit.avg_degradation or 0.5

    # Strong drivers find low-overtake circuits easier (they qualify well, stay ahead)
    # Weak drivers find low-overtake circuits harder (can't overtake to recover)
    if strength > 0.6:
        ot_factor = 1 - ot * 0.5  # High OT diff = easier for strong drivers
    else:
        ot_factor = ot * 0.8  # High OT diff = harder for weak drivers

    # Street circuits add difficulty for everyone, more for weaker drivers
    street_factor = street * (0.3 if strength > 0.6 else 0.5)

    # High degradation benefits top teams with better strategy/tyre management
    deg_factor = deg * (0.2 if strength > 0.6 else 0.4)

    # Combine factors
    raw = ot_factor * 0.5 + street_factor * 0.25 + deg_factor * 0.25
    return max(0, min(1, raw))


def _circuit_difficulty_for_constructor(strength: float, circuit: Circuit) -> float:
    """
    Constructor difficulty based on car characteristics vs circuit demands.
    """
    ot = circuit.overtake_difficulty or 0.5
    hs = circuit.high_speed or 0.5
    deg = circuit.avg_degradation or 0.5

    # Strong constructors benefit from high-speed circuits (aero advantage)
    if strength > 0.6:
        hs_factor = 1 - hs * 0.4
    else:
        hs_factor = hs * 0.3

    ot_factor = ot * (0.3 if strength > 0.6 else 0.6)
    deg_factor = deg * (0.2 if strength > 0.6 else 0.4)

    raw = ot_factor * 0.4 + hs_factor * 0.3 + deg_factor * 0.3
    return max(0, min(1, raw))


@router.get("/difficulty", response_model=list[FixtureDifficultyRow])
def get_fixture_difficulty(
    asset_type: str = Query("driver", regex="^(driver|constructor)$"),
    db: Session = Depends(get_db),
):
    races = db.query(Race).order_by(Race.round).all()
    circuits = {r.circuit_id: db.get(Circuit, r.circuit_id) for r in races}

    rows = []

    if asset_type == "driver":
        drivers = db.query(Driver).all()
        prices = {d.id: _get_asset_price(db, "driver", d.id) for d in drivers}
        min_p, max_p = min(prices.values()), max(prices.values())

        for driver in drivers:
            strength = _price_to_strength(prices[driver.id], min_p, max_p)
            constructor = db.get(Constructor, driver.constructor_id)
            color = constructor.color if constructor else "#6b7280"

            fixtures = []
            for race in races:
                circuit = circuits[race.circuit_id]
                diff = _circuit_difficulty_for_driver(strength, circuit)
                fixtures.append(FixtureDifficultyEntry(
                    race_id=race.id,
                    race_name=race.name,
                    race_round=race.round,
                    difficulty=round(diff, 3),
                ))

            rows.append(FixtureDifficultyRow(
                asset_type="driver",
                asset_id=driver.id,
                asset_name=driver.code,
                color=color,
                fixtures=fixtures,
            ))
    else:
        constructors_list = db.query(Constructor).all()
        prices = {c.id: _get_asset_price(db, "constructor", c.id) for c in constructors_list}
        min_p, max_p = min(prices.values()), max(prices.values())

        for constructor in constructors_list:
            strength = _price_to_strength(prices[constructor.id], min_p, max_p)

            fixtures = []
            for race in races:
                circuit = circuits[race.circuit_id]
                diff = _circuit_difficulty_for_constructor(strength, circuit)
                fixtures.append(FixtureDifficultyEntry(
                    race_id=race.id,
                    race_name=race.name,
                    race_round=race.round,
                    difficulty=round(diff, 3),
                ))

            rows.append(FixtureDifficultyRow(
                asset_type="constructor",
                asset_id=constructor.id,
                asset_name=constructor.name,
                color=constructor.color,
                fixtures=fixtures,
            ))

    return rows
