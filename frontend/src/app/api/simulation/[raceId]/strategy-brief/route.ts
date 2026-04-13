/**
 * POST /api/simulation/{race_id}/strategy-brief
 * Ported from backend/app/routers/simulation.py::get_strategy_brief.
 */
import { withRouteErrorHandler } from "@/lib/api-helpers";
import { generateStrategyBrief } from "@/lib/simulation/auto-sim-helpers";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ raceId: string }> }
) {
  const { raceId: raceIdStr } = await params;
  const raceId = parseInt(raceIdStr, 10);

  return withRouteErrorHandler(async () => {
    if (Number.isNaN(raceId)) {
      return {
        status: "no_data",
        message: "No simulation data available for this race.",
      };
    }

    const brief = await generateStrategyBrief(raceId);
    if (!brief) {
      return {
        status: "no_data",
        message: "No simulation data available for this race.",
      };
    }
    return brief;
  });
}
