from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Race, Circuit
from app.schemas import RaceResponse

router = APIRouter(prefix="/api/races", tags=["races"])


def _race_to_response(r: Race, circuit: Circuit | None) -> RaceResponse:
    return RaceResponse(
        id=r.id,
        round=r.round,
        name=r.name,
        circuit_name=circuit.name if circuit else "",
        country=circuit.country if circuit else "",
        date=r.date or "",
        has_sprint=r.has_sprint,
        overtake_difficulty=circuit.overtake_difficulty if circuit else 0.5,
        laps=r.laps or 57,
        drs_zones=r.drs_zones or 3,
    )


@router.get("", response_model=list[RaceResponse])
def get_races(db: Session = Depends(get_db)):
    races = db.query(Race).order_by(Race.round).all()
    return [_race_to_response(r, db.get(Circuit, r.circuit_id)) for r in races]


@router.get("/next", response_model=RaceResponse | None)
def get_next_race(db: Session = Depends(get_db)):
    today_str = date.today().isoformat()
    now_utc = datetime.now(timezone.utc)

    # First try: find races on or after today
    candidates = (
        db.query(Race)
        .filter(Race.date >= today_str)
        .order_by(Race.date)
        .all()
    )

    for race in candidates:
        if race.date == today_str:
            # Race is today — consider it "done" if past 18:00 UTC
            # (typical race starts ~14:00 UTC, finishes by ~16:00 UTC)
            if now_utc.hour >= 18:
                continue  # Skip to next race
        # This race is either in the future or today but not yet finished
        return _race_to_response(race, db.get(Circuit, race.circuit_id))

    # Fallback: last race of the season (only if it hasn't passed)
    race = db.query(Race).order_by(Race.round.desc()).first()
    if not race:
        return None
    if race.date and race.date < today_str:
        return None
    return _race_to_response(race, db.get(Circuit, race.circuit_id))
