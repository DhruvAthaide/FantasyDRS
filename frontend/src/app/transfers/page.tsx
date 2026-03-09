"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { api } from "@/lib/api";
import { getMyTeam } from "@/lib/storage";
import type { Race, SwapSuggestion } from "@/types";
import RaceSelector from "@/components/RaceSelector";

export default function TransfersPage() {
  const [races, setRaces] = useState<Race[]>([]);
  const [selectedRaceId, setSelectedRaceId] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<SwapSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasTeam, setHasTeam] = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    api.getRaces().then(setRaces);
    setHasTeam(!!getMyTeam());
  }, []);

  const handleAnalyze = async () => {
    const team = getMyTeam();
    if (!team || !selectedRaceId) return;
    setLoading(true);
    try {
      const data = await api.suggestTransfers({
        driver_ids: team.driver_ids,
        constructor_ids: team.constructor_ids,
        drs_driver_id: team.drs_driver_id,
        race_id: selectedRaceId,
      });
      setSuggestions(data);
      setSearched(true);
    } catch { setSearched(true); }
    setLoading(false);
  };

  return (
    <div className="space-y-8">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight">Transfers</h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-1">Find the best swaps for your team this race week</p>
        </div>
        <RaceSelector races={races} selectedRaceId={selectedRaceId} onSelect={setSelectedRaceId} />
      </motion.div>

      {!hasTeam && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-16">
          <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ background: "var(--card-border)" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#4b5563" strokeWidth="2">
              <polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" />
              <polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
            </svg>
          </div>
          <p className="text-sm text-gray-500 font-medium">No Team Saved</p>
          <p className="text-xs text-gray-600 mt-1">Save your team in the My Team page first, then come back for transfer suggestions</p>
        </motion.div>
      )}

      {hasTeam && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.05 }}>
          <button
            onClick={handleAnalyze}
            disabled={!selectedRaceId || loading}
            className="px-5 py-2.5 rounded-xl text-xs font-bold text-white transition-all disabled:opacity-30"
            style={{ background: selectedRaceId ? "var(--f1-red)" : "var(--card-border)" }}
          >
            {loading ? "Analyzing swaps..." : "Find Best Swaps"}
          </button>
        </motion.div>
      )}

      {searched && suggestions.length === 0 && !loading && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-16">
          <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ background: "var(--card-border)" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#4b5563" strokeWidth="2">
              <path d="M18 20V10M12 20V4M6 20v-6" />
            </svg>
          </div>
          <p className="text-sm text-gray-500 font-medium">No Swap Suggestions</p>
          <p className="text-xs text-gray-600 mt-1">Run a simulation for this race first, then swap suggestions will appear based on expected points</p>
        </motion.div>
      )}

      {suggestions.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          {suggestions.map((s, i) => (
            <div
              key={`${s.out_id}-${s.in_id}`}
              className="rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3"
              style={{
                background: i === 0 ? "rgba(34,197,94,0.06)" : "var(--card-bg)",
                border: i === 0 ? "1px solid rgba(34,197,94,0.25)" : "1px solid var(--card-border)",
              }}
            >
              {/* Rank */}
              <div className="text-lg font-black text-gray-600 w-8 shrink-0">#{i + 1}</div>

              {/* OUT */}
              <div className="flex items-center gap-2 min-w-[120px]">
                <div className="px-2 py-1 rounded-lg text-xs font-bold" style={{ background: "rgba(239,68,68,0.15)", color: "#ef4444" }}>OUT</div>
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-4 rounded-full" style={{ backgroundColor: s.out_color }} />
                  <span className="font-semibold text-sm">{s.out_name}</span>
                </div>
                <span className="text-xs font-mono text-gray-500">{s.out_points.toFixed(1)}pts</span>
              </div>

              {/* Arrow */}
              <div className="hidden sm:block text-gray-600">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
              </div>

              {/* IN */}
              <div className="flex items-center gap-2 min-w-[120px]">
                <div className="px-2 py-1 rounded-lg text-xs font-bold" style={{ background: "rgba(34,197,94,0.15)", color: "#22c55e" }}>IN</div>
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-4 rounded-full" style={{ backgroundColor: s.in_color }} />
                  <span className="font-semibold text-sm">{s.in_name}</span>
                </div>
                <span className="text-xs font-mono text-gray-500">{s.in_points.toFixed(1)}pts</span>
              </div>

              {/* Stats */}
              <div className="flex items-center gap-4 sm:ml-auto">
                <div className="text-right">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wider">Gain</div>
                  <div className={`text-sm font-bold font-mono ${s.points_gained > 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {s.points_gained > 0 ? "+" : ""}{s.points_gained.toFixed(1)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wider">Cost</div>
                  <div className={`text-sm font-mono ${s.cost_delta > 0 ? "text-red-400" : s.cost_delta < 0 ? "text-emerald-400" : "text-gray-500"}`}>
                    {s.cost_delta > 0 ? "+" : ""}{s.cost_delta.toFixed(1)}M
                  </div>
                </div>
              </div>
            </div>
          ))}
        </motion.div>
      )}
    </div>
  );
}
