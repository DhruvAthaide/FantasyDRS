from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Driver, Constructor, SimulationResult

router = APIRouter(prefix="/api/what-if", tags=["what-if"])


class WhatIfRequest(BaseModel):
    race_id: int
    original_driver_ids: list[int]
    original_constructor_ids: list[int]
    original_drs_driver_id: int
    modified_driver_ids: list[int]
    modified_constructor_ids: list[int]
    modified_drs_driver_id: int


def _score_team(db: Session, race_id: int, driver_ids: list[int], constructor_ids: list[int], drs_driver_id: int) -> tuple[float, list[dict]]:
    """Score a team based on stored sim results. Returns (total, breakdown)."""
    breakdown = []
    total = 0.0

    for did in driver_ids:
        sim = (
            db.query(SimulationResult)
            .filter_by(asset_type="driver", asset_id=did, race_id=race_id)
            .order_by(SimulationResult.id.desc())
            .first()
        )
        pts = sim.expected_pts_mean if sim else 0
        multiplier = 2 if did == drs_driver_id else 1
        scored = pts * multiplier
        total += scored
        driver = db.get(Driver, did)
        breakdown.append({
            "asset_type": "driver",
            "asset_id": did,
            "name": driver.code if driver else "?",
            "color": "",
            "base_pts": round(pts, 2),
            "multiplier": multiplier,
            "scored_pts": round(scored, 2),
        })
        if driver:
            c = db.get(Constructor, driver.constructor_id)
            breakdown[-1]["color"] = c.color if c else "#888"

    for cid in constructor_ids:
        sim = (
            db.query(SimulationResult)
            .filter_by(asset_type="constructor", asset_id=cid, race_id=race_id)
            .order_by(SimulationResult.id.desc())
            .first()
        )
        pts = sim.expected_pts_mean if sim else 0
        total += pts
        constructor = db.get(Constructor, cid)
        breakdown.append({
            "asset_type": "constructor",
            "asset_id": cid,
            "name": constructor.name if constructor else "?",
            "color": constructor.color if constructor else "#888",
            "base_pts": round(pts, 2),
            "multiplier": 1,
            "scored_pts": round(pts, 2),
        })

    return round(total, 2), breakdown


@router.post("")
def what_if(request: WhatIfRequest, db: Session = Depends(get_db)):
    """Compare two team compositions using stored simulation data."""
    orig_total, orig_breakdown = _score_team(
        db, request.race_id,
        request.original_driver_ids, request.original_constructor_ids,
        request.original_drs_driver_id,
    )
    mod_total, mod_breakdown = _score_team(
        db, request.race_id,
        request.modified_driver_ids, request.modified_constructor_ids,
        request.modified_drs_driver_id,
    )

    # Find which assets changed
    orig_driver_set = set(request.original_driver_ids)
    mod_driver_set = set(request.modified_driver_ids)
    orig_constructor_set = set(request.original_constructor_ids)
    mod_constructor_set = set(request.modified_constructor_ids)

    swaps = []
    driver_outs = list(orig_driver_set - mod_driver_set)
    driver_ins = list(mod_driver_set - orig_driver_set)
    for i, out_id in enumerate(driver_outs):
        out_entry = next((b for b in orig_breakdown if b["asset_id"] == out_id and b["asset_type"] == "driver"), None)
        if i < len(driver_ins):
            in_id = driver_ins[i]
            in_entry = next((b for b in mod_breakdown if b["asset_id"] == in_id and b["asset_type"] == "driver"), None)
            if out_entry and in_entry:
                swaps.append({
                    "type": "driver",
                    "out": out_entry,
                    "in": in_entry,
                    "diff": round(in_entry["scored_pts"] - out_entry["scored_pts"], 2),
                })

    constructor_outs = list(orig_constructor_set - mod_constructor_set)
    constructor_ins = list(mod_constructor_set - orig_constructor_set)
    for i, out_id in enumerate(constructor_outs):
        out_entry = next((b for b in orig_breakdown if b["asset_id"] == out_id and b["asset_type"] == "constructor"), None)
        if i < len(constructor_ins):
            in_id = constructor_ins[i]
            in_entry = next((b for b in mod_breakdown if b["asset_id"] == in_id and b["asset_type"] == "constructor"), None)
            if out_entry and in_entry:
                swaps.append({
                    "type": "constructor",
                    "out": out_entry,
                    "in": in_entry,
                    "diff": round(in_entry["scored_pts"] - out_entry["scored_pts"], 2),
                })

    # Check DRS change
    drs_changed = request.original_drs_driver_id != request.modified_drs_driver_id
    drs_diff = 0.0
    if drs_changed:
        # The old DRS driver loses 1x, new DRS driver gains 1x
        old_sim = db.query(SimulationResult).filter_by(
            asset_type="driver", asset_id=request.original_drs_driver_id, race_id=request.race_id
        ).order_by(SimulationResult.id.desc()).first()
        new_sim = db.query(SimulationResult).filter_by(
            asset_type="driver", asset_id=request.modified_drs_driver_id, race_id=request.race_id
        ).order_by(SimulationResult.id.desc()).first()
        old_pts = old_sim.expected_pts_mean if old_sim else 0
        new_pts = new_sim.expected_pts_mean if new_sim else 0
        drs_diff = round(new_pts - old_pts, 2)

    return {
        "original_total": orig_total,
        "modified_total": mod_total,
        "differential": round(mod_total - orig_total, 2),
        "original_breakdown": orig_breakdown,
        "modified_breakdown": mod_breakdown,
        "swaps": swaps,
        "drs_changed": drs_changed,
        "drs_diff": drs_diff,
    }
