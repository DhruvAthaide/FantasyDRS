from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Race, Circuit
from app.schemas import RaceResponse

router = APIRouter(prefix="/api/races", tags=["races"])


@router.get("", response_model=list[RaceResponse])
def get_races(db: Session = Depends(get_db)):
    races = db.query(Race).order_by(Race.round).all()
    result = []
    for r in races:
        circuit = db.get(Circuit, r.circuit_id)
        result.append(RaceResponse(
            id=r.id,
            round=r.round,
            name=r.name,
            circuit_name=circuit.name if circuit else "",
            country=circuit.country if circuit else "",
            date=r.date or "",
            has_sprint=r.has_sprint,
            overtake_difficulty=circuit.overtake_difficulty if circuit else 0.5,
        ))
    return result
