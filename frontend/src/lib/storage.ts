export interface SavedTeam {
  driver_ids: number[];
  constructor_ids: number[];
  drs_driver_id: number;
  saved_at: string;
}

const TEAM_KEY = "pitwall_my_team";

export function getMyTeam(): SavedTeam | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(TEAM_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SavedTeam;
  } catch {
    return null;
  }
}

export function saveMyTeam(team: Omit<SavedTeam, "saved_at">): void {
  const data: SavedTeam = { ...team, saved_at: new Date().toISOString() };
  localStorage.setItem(TEAM_KEY, JSON.stringify(data));
}

export interface SavedRival {
  name: string;
  driver_ids: number[];
  constructor_ids: number[];
  drs_driver_id: number;
}

const RIVALS_KEY = "pitwall_rivals";

export function getRivals(): SavedRival[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(RIVALS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as SavedRival[];
  } catch {
    return [];
  }
}

export function saveRivals(rivals: SavedRival[]): void {
  localStorage.setItem(RIVALS_KEY, JSON.stringify(rivals));
}
