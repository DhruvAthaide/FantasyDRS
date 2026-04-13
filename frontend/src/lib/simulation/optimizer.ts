/**
 * Brute-force team optimizer — finds best 5-driver + 2-constructor teams
 * within budget.
 *
 * Ported from backend/app/simulation/optimizer.py — deterministic; golden
 * tests assert byte-level parity with the Python source. Any change to
 * ordering / tiebreaker / rounding MUST be made in both files and re-verified
 * via optimizer.golden.test.ts.
 */

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------
export interface Asset {
  id: number;
  code: string;
  price: number;
  expected_pts: number;
  asset_type: "driver" | "constructor";
  constructor_name?: string;
  constructor_color?: string;
}

export interface OptimalTeam {
  drivers: Asset[];
  constructors: Asset[];
  drs_driver: Asset;
  total_cost: number;
  total_points: number;
  budget_remaining: number;
}

export interface OptimizeInput {
  drivers: Asset[];
  constructors: Asset[];
  budget?: number;
  includeDriverIds?: number[];
  excludeDriverIds?: number[];
  includeConstructorIds?: number[];
  excludeConstructorIds?: number[];
  drsMultiplier?: number;
  topN?: number;
  drsDriverId?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
// Mirrors _COST_TIEBREAKER_WEIGHT in optimizer.py. Each $1M of spend adds
// 0.001 pts to the sort key — far too small to override a real 1-pt
// difference but enough to break ties deterministically toward pricier
// rosters.
const COST_TIEBREAKER_WEIGHT = 0.001;

// ---------------------------------------------------------------------------
// itertools.combinations(arr, k) — generator, classic index-array increment.
// Yields length-k arrays; no duplicates; matches Python ordering exactly.
// ---------------------------------------------------------------------------
function* combinations<T>(arr: T[], k: number): Generator<T[]> {
  const n = arr.length;
  if (k > n || k < 0) return;
  const indices = new Array<number>(k);
  for (let i = 0; i < k; i++) indices[i] = i;

  while (true) {
    // Yield current combination (fresh array; callers may retain it)
    const out = new Array<T>(k);
    for (let i = 0; i < k; i++) out[i] = arr[indices[i]];
    yield out;

    // Find rightmost index we can increment
    let i = k - 1;
    while (i >= 0 && indices[i] === i + n - k) i--;
    if (i < 0) return;

    indices[i]++;
    for (let j = i + 1; j < k; j++) indices[j] = indices[j - 1] + 1;
  }
}

// ---------------------------------------------------------------------------
// Rounding helper (Python round(x, 2) → banker's round on .5, but for
// non-halfway values JS Math.round matches). Our totals are sums of 2-decimal
// prices + synthetic points; exact halfway cases are vanishingly rare.
// ---------------------------------------------------------------------------
function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

// ---------------------------------------------------------------------------
// findBestTeams
// ---------------------------------------------------------------------------
export function findBestTeams(input: OptimizeInput): OptimalTeam[] {
  const drivers = input.drivers;
  const constructors = input.constructors;
  const budget = input.budget ?? 100.0;
  const drsMultiplier = input.drsMultiplier ?? 2;
  const topN = input.topN ?? 10;
  const drsDriverId = input.drsDriverId;

  const includeDriverIds = new Set<number>(input.includeDriverIds ?? []);
  const excludeDriverIds = new Set<number>(input.excludeDriverIds ?? []);
  const includeConstructorIds = new Set<number>(
    input.includeConstructorIds ?? []
  );
  const excludeConstructorIds = new Set<number>(
    input.excludeConstructorIds ?? []
  );

  const availDrivers = drivers.filter((d) => !excludeDriverIds.has(d.id));
  const availConstructors = constructors.filter(
    (c) => !excludeConstructorIds.has(c.id)
  );

  // Pre-compute constructor combos
  interface CCombo {
    combo: Asset[];
    cost: number;
    pts: number;
  }
  const validCCombos: CCombo[] = [];
  for (const cCombo of combinations(availConstructors, 2)) {
    const cIds = new Set(cCombo.map((c) => c.id));
    if (includeConstructorIds.size > 0) {
      let allIncluded = true;
      for (const id of includeConstructorIds) {
        if (!cIds.has(id)) {
          allIncluded = false;
          break;
        }
      }
      if (!allIncluded) continue;
    }
    let cost = 0;
    let pts = 0;
    for (const c of cCombo) {
      cost += c.price;
      pts += c.expected_pts;
    }
    validCCombos.push({ combo: cCombo, cost, pts });
  }

  // Sort constructor combos by cost ascending (matches Python)
  validCCombos.sort((a, b) => a.cost - b.cost);

  interface RankedTeam {
    sortKey: number;
    totalPts: number;
    team: OptimalTeam;
  }
  const bestTeams: RankedTeam[] = [];
  let minSortKey = Number.NEGATIVE_INFINITY;

  for (const dCombo of combinations(availDrivers, 5)) {
    const dIds = new Set(dCombo.map((d) => d.id));
    if (includeDriverIds.size > 0) {
      let allIncluded = true;
      for (const id of includeDriverIds) {
        if (!dIds.has(id)) {
          allIncluded = false;
          break;
        }
      }
      if (!allIncluded) continue;
    }

    let dCost = 0;
    let dPts = 0;
    for (const d of dCombo) {
      dCost += d.price;
      dPts += d.expected_pts;
    }

    // DRS driver: user-selected or auto-pick best expected_pts
    let drsDriver: Asset;
    if (drsDriverId !== undefined && dCombo.some((d) => d.id === drsDriverId)) {
      drsDriver = dCombo.find((d) => d.id === drsDriverId)!;
    } else {
      drsDriver = dCombo[0];
      for (let i = 1; i < dCombo.length; i++) {
        if (dCombo[i].expected_pts > drsDriver.expected_pts) {
          drsDriver = dCombo[i];
        }
      }
    }
    const drsBonus = drsDriver.expected_pts * (drsMultiplier - 1);

    for (const { combo: cCombo, cost: cCost, pts: cPts } of validCCombos) {
      const totalCost = dCost + cCost;
      if (totalCost > budget) continue;

      const totalPts = dPts + cPts + drsBonus;
      const sortKey = totalPts + totalCost * COST_TIEBREAKER_WEIGHT;

      if (bestTeams.length >= topN && sortKey <= minSortKey) continue;

      const team: OptimalTeam = {
        drivers: [...dCombo],
        constructors: [...cCombo],
        drs_driver: drsDriver,
        total_cost: totalCost,
        total_points: round2(totalPts),
        budget_remaining: round2(budget - totalCost),
      };

      bestTeams.push({ sortKey, totalPts, team });
      bestTeams.sort((a, b) => b.sortKey - a.sortKey);
      if (bestTeams.length > topN) {
        bestTeams.pop();
        minSortKey = bestTeams[bestTeams.length - 1].sortKey;
      }
    }
  }

  return bestTeams.map((r) => r.team);
}
