"use client";

import type { Race } from "@/types";

interface RaceSelectorProps {
  races: Race[];
  selectedRaceId: number | null;
  onSelect: (raceId: number | null) => void;
}

export default function RaceSelector({
  races,
  selectedRaceId,
  onSelect,
}: RaceSelectorProps) {
  return (
    <div className="relative w-full sm:w-auto">
      <select
        value={selectedRaceId ?? ""}
        onChange={(e) => {
          const val = e.target.value;
          onSelect(val ? Number(val) : null);
        }}
        className="appearance-none w-full sm:w-auto text-sm font-medium pl-4 pr-8 py-3 sm:py-2.5 rounded-xl focus:outline-none focus:ring-1 transition-colors cursor-pointer"
        style={{
          background: "var(--card-bg)",
          border: "1px solid var(--card-border)",
          color: selectedRaceId ? "var(--foreground)" : "#6b7280",
        }}
      >
        <option value="">Select Race Weekend</option>
        {races.map((race) => (
          <option key={race.id} value={race.id}>
            R{race.round} {race.name} {race.has_sprint ? "// Sprint" : ""}
          </option>
        ))}
      </select>
      <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>
    </div>
  );
}
