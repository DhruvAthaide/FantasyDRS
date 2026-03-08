from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Driver, Constructor, Race, Circuit, PowerUnitAllocation
from app.schemas import PowerUnitStatus, PenaltyCalendarEntry, PowerUnitUpdateRequest

router = APIRouter(prefix="/api/penalties", tags=["penalties"])

# 2026 regulations: 4 ICE, TC, MGU-K, MGU-H per season; 2 ES, CE; 4 gearboxes
COMPONENT_LIMITS = {
    "ICE": 4, "TC": 4, "MGU-K": 4, "MGU-H": 4,
    "ES": 2, "CE": 2, "Gearbox": 4,
}


def _ensure_pu_initialized(db: Session):
    """Auto-initialize PU allocations if none exist (season start: 1 of each component)."""
    existing = db.query(PowerUnitAllocation).first()
    if existing:
        return  # Already initialized

    drivers = db.query(Driver).all()
    for driver in drivers:
        for comp_type in COMPONENT_LIMITS:
            db.add(PowerUnitAllocation(
                driver_id=driver.id,
                component_type=comp_type,
                race_id=None,
                is_new=True,
                total_used=1,
            ))
    db.commit()


@router.get("/status", response_model=list[PowerUnitStatus])
def get_pu_status(db: Session = Depends(get_db)):
    """Get power unit allocation status for all drivers."""
    _ensure_pu_initialized(db)

    drivers = db.query(Driver).all()
    statuses = []

    for driver in drivers:
        allocations = db.query(PowerUnitAllocation).filter_by(driver_id=driver.id).all()
        components: dict[str, int] = {k: 0 for k in COMPONENT_LIMITS}
        for alloc in allocations:
            if alloc.component_type in components:
                components[alloc.component_type] = max(
                    components[alloc.component_type], alloc.total_used
                )

        at_risk = any(
            components.get(comp, 0) >= limit
            for comp, limit in COMPONENT_LIMITS.items()
        )

        constructor = db.get(Constructor, driver.constructor_id)

        statuses.append(PowerUnitStatus(
            driver_id=driver.id,
            driver_code=driver.code,
            driver_color=constructor.color if constructor else "#6b7280",
            components=components,
            at_risk=at_risk,
        ))

    return statuses


@router.get("/calendar", response_model=list[PenaltyCalendarEntry])
def get_penalty_calendar(db: Session = Depends(get_db)):
    """Get penalty-friendly race recommendations for at-risk drivers."""
    drivers = db.query(Driver).all()
    races = db.query(Race).order_by(Race.round).all()

    entries = []
    for driver in drivers:
        allocations = db.query(PowerUnitAllocation).filter_by(driver_id=driver.id).all()
        components = {k: 0 for k in COMPONENT_LIMITS}
        for alloc in allocations:
            if alloc.component_type in components:
                components[alloc.component_type] = max(
                    components[alloc.component_type], alloc.total_used
                )

        at_risk = any(components.get(c, 0) >= l for c, l in COMPONENT_LIMITS.items())
        if not at_risk:
            continue

        constructor = db.get(Constructor, driver.constructor_id)

        for race in races:
            circuit = db.get(Circuit, race.circuit_id) if race.circuit_id else None
            ot_diff = circuit.overtake_difficulty if circuit else 0.5

            # Low overtake difficulty = easy to recover from grid penalty = good penalty race
            penalty_cost = ot_diff  # Higher OT difficulty = costlier penalty
            recommended = penalty_cost < 0.35  # Easy overtaking circuits

            entries.append(PenaltyCalendarEntry(
                driver_id=driver.id,
                driver_code=driver.code,
                driver_color=constructor.color if constructor else "#6b7280",
                race_id=race.id,
                race_name=race.name,
                race_round=race.round,
                penalty_cost=round(penalty_cost, 3),
                recommended=recommended,
            ))

    return entries


@router.post("/update")
def update_pu_allocation(data: PowerUnitUpdateRequest, db: Session = Depends(get_db)):
    """Manually update power unit allocation after a race."""
    alloc = PowerUnitAllocation(
        driver_id=data.driver_id,
        component_type=data.component_type,
        race_id=data.race_id,
        is_new=True,
        total_used=data.total_used,
    )
    db.add(alloc)
    db.commit()
    return {"status": "ok"}


@router.post("/increment")
def increment_pu_component(
    driver_id: int,
    component_type: str,
    db: Session = Depends(get_db),
):
    """Increment a driver's component usage by 1 (e.g., new ICE used)."""
    if component_type not in COMPONENT_LIMITS:
        return {"error": f"Invalid component type: {component_type}"}

    _ensure_pu_initialized(db)

    # Find current max total_used for this driver + component
    latest = (
        db.query(PowerUnitAllocation)
        .filter_by(driver_id=driver_id, component_type=component_type)
        .order_by(PowerUnitAllocation.id.desc())
        .first()
    )
    current_total = latest.total_used if latest else 0

    db.add(PowerUnitAllocation(
        driver_id=driver_id,
        component_type=component_type,
        race_id=None,
        is_new=True,
        total_used=current_total + 1,
    ))
    db.commit()
    return {"status": "ok", "new_total": current_total + 1}


@router.post("/reset")
def reset_pu_allocations(db: Session = Depends(get_db)):
    """Reset all PU allocations to season start (1 of each component)."""
    db.query(PowerUnitAllocation).delete()
    db.commit()
    _ensure_pu_initialized(db)
    return {"status": "ok"}
