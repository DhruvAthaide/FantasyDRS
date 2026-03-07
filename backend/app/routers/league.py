from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import SimulationResult
from app.schemas import LeagueSimRequest, LeagueSimResult

router = APIRouter(prefix="/api/league", tags=["league"])


def _team_points(db: Session, driver_ids: list[int], constructor_ids: list[int],
                 drs_driver_id: int, race_id: int, drs_multiplier: int = 2) -> float:
    """Calculate expected points for a team using stored simulation results."""
    total = 0.0
    for did in driver_ids:
        sim = (
            db.query(SimulationResult)
            .filter_by(asset_type="driver", asset_id=did, race_id=race_id)
            .order_by(SimulationResult.id.desc())
            .first()
        )
        pts = sim.expected_pts_mean if sim else 0
        if did == drs_driver_id:
            pts *= drs_multiplier
        total += pts

    for cid in constructor_ids:
        sim = (
            db.query(SimulationResult)
            .filter_by(asset_type="constructor", asset_id=cid, race_id=race_id)
            .order_by(SimulationResult.id.desc())
            .first()
        )
        total += sim.expected_pts_mean if sim else 0

    return total


@router.post("/simulate", response_model=list[LeagueSimResult])
def simulate_league(request: LeagueSimRequest, db: Session = Depends(get_db)):
    """Simulate head-to-head between my team and rivals."""
    all_teams = [request.my_team] + request.rivals

    # Calculate expected points for each team
    team_points = []
    for team in all_teams:
        pts = _team_points(
            db, team.driver_ids, team.constructor_ids,
            team.drs_driver_id, request.race_id,
        )
        team_points.append((team.name, pts))

    my_pts = team_points[0][1]
    total_pts = sum(p for _, p in team_points)

    results = []
    for name, pts in team_points:
        # Simple win probability: proportional to expected points
        win_prob = pts / total_pts if total_pts > 0 else 1 / len(all_teams)
        results.append(LeagueSimResult(
            team_name=name,
            expected_points=round(pts, 2),
            win_probability=round(win_prob, 4),
            differential=round(pts - my_pts, 2),
        ))

    # Sort by expected points descending
    results.sort(key=lambda r: r.expected_points, reverse=True)
    return results
