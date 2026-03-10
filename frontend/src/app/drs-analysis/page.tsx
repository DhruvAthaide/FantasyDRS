"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { api } from "@/lib/api";
import { getMyTeam } from "@/lib/storage";
import type { SavedTeam } from "@/lib/storage";
import type { Race, DrsAnalysis } from "@/types";
import RaceSelector from "@/components/RaceSelector";
import InfoTooltip from "@/components/InfoTooltip";

const TIER_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  safe: { bg: "rgba(34,197,94,0.15)", color: "#22c55e", label: "Safe Pick" },
  upside: { bg: "rgba(168,85,247,0.15)", color: "#a855f7", label: "Upside" },
  neutral: { bg: "rgba(107,114,128,0.15)", color: "#9ca3af", label: "Neutral" },
  avoid: { bg: "rgba(239,68,68,0.15)", color: "#ef4444", label: "Avoid" },
};

const TIER_TOOLTIP = "Safe: low variance, reliable. Upside: high ceiling, moderate risk. Neutral: average expected return. Avoid: poor risk-reward ratio.";

export default function DrsAnalysisPage() {
  const [races, setRaces] = useState<Race[]>([]);
  const [selectedRaceId, setSelectedRaceId] = useState<number | null>(null);
  const [results, setResults] = useState<DrsAnalysis[]>([]);
  const [loading, setLoading] = useState(false);
  const [myTeamOnly, setMyTeamOnly] = useState(false);
  const [searched, setSearched] = useState(false);
  const [myTeam, setMyTeam] = useState<SavedTeam | null>(null);

  useEffect(() => {
    setMyTeam(getMyTeam());
    api.getRaces().then(setRaces).catch(() => {});
    api.getNextRace().then((next) => {
      if (next) setSelectedRaceId(next.id);
    }).catch(() => {});
  }, []);

  const handleAnalyze = async () => {
    if (!selectedRaceId) return;
    setLoading(true);
    try {
      const driverIds = myTeamOnly && myTeam ? myTeam.driver_ids : undefined;
      const data = await api.analyzeDrs(selectedRaceId, driverIds);
      setResults(data);
      setSearched(true);
    } catch {
      setResults([]);
      setSearched(true);
    }
    setLoading(false);
  };

  const maxExtra = Math.max(...results.map((r) => Math.abs(r.extra_from_drs)), 1);

  return (
    <div className="space-y-8">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight">DRS Analysis</h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-1">Find the optimal DRS captain pick for maximum 2x value</p>
        </div>
        <RaceSelector races={races} selectedRaceId={selectedRaceId} onSelect={setSelectedRaceId} />
      </motion.div>

      {/* Controls */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.05 }} className="flex items-center gap-3">
        <button
          onClick={handleAnalyze}
          disabled={!selectedRaceId || loading}
          className="px-5 py-2.5 rounded-xl text-xs font-bold text-white transition-all disabled:opacity-30"
          style={{ background: selectedRaceId ? "var(--f1-red)" : "var(--card-border)" }}
        >
          {loading ? "Analyzing..." : "Analyze DRS Picks"}
        </button>
        {myTeam && (
          <button
            onClick={() => setMyTeamOnly(!myTeamOnly)}
            className="px-4 py-2.5 rounded-xl text-xs font-bold transition-all"
            style={{
              background: myTeamOnly ? "rgba(34,197,94,0.15)" : "var(--card-bg)",
              border: myTeamOnly ? "1px solid rgba(34,197,94,0.3)" : "1px solid var(--card-border)",
              color: myTeamOnly ? "#22c55e" : "#6b7280",
            }}
          >
            My Team Only
          </button>
        )}
      </motion.div>

      {/* No sim data message */}
      {searched && results.length === 0 && !loading && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-16">
          <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ background: "var(--card-border)" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#4b5563" strokeWidth="2">
              <path d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <p className="text-sm text-gray-500 font-medium">No Simulation Data</p>
          <p className="text-xs text-gray-600 mt-1">Run a simulation for this race first to see DRS analysis</p>
        </motion.div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
          {/* Top Pick Highlight */}
          {results[0] && (
            <div className="rounded-2xl p-5 relative overflow-hidden"
              style={{ background: "rgba(225,6,0,0.06)", border: "1px solid rgba(225,6,0,0.2)" }}
            >
              <div className="absolute top-0 right-0 w-24 h-24 opacity-10" style={{ background: "radial-gradient(circle, var(--f1-red) 0%, transparent 70%)" }} />
              <div className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-1">Recommended DRS Pick</div>
              <div className="flex items-center gap-3">
                <div className="w-1.5 h-6 rounded-full" style={{ backgroundColor: results[0].constructor_color }} />
                <span className="text-xl font-black">{results[0].name}</span>
                <span className="text-sm font-mono font-bold" style={{ color: "var(--f1-red)" }}>+{results[0].extra_from_drs.toFixed(1)} pts</span>
              </div>
              <div className="flex gap-4 mt-2">
                <div className="text-xs text-gray-400">
                  <span className="text-gray-500">2x Expected:</span> <span className="font-mono font-bold text-white">{results[0].expected_2x.toFixed(1)}</span>
                </div>
                <div className="text-xs text-gray-400">
                  <span className="text-gray-500">P90 Upside:</span> <span className="font-mono font-bold" style={{ color: "var(--neon-green)" }}>{results[0].p90_2x.toFixed(1)}</span>
                </div>
                <div className="text-xs text-gray-400">
                  <span className="text-gray-500">Risk:</span> <span className="font-mono font-bold">{(results[0].risk_score * 100).toFixed(0)}%</span>
                </div>
              </div>
            </div>
          )}

          {/* Bar Chart */}
          <div className="glass-card rounded-2xl p-5" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
            <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-4">Extra Points from DRS (2x)</h3>
            <div className="space-y-2">
              {results.map((r) => {
                const tier = TIER_STYLES[r.tier] || TIER_STYLES.neutral;
                const barWidth = Math.max(5, (Math.max(0, r.extra_from_drs) / maxExtra) * 100);
                return (
                  <div key={r.driver_id} className="flex items-center gap-3">
                    <div className="w-10 text-xs font-bold text-right" style={{ color: r.constructor_color }}>{r.code}</div>
                    <div className="flex-1 h-7 rounded-lg overflow-hidden relative" style={{ background: "var(--surface)" }}>
                      <div className="h-full rounded-lg transition-all duration-500 flex items-center px-2"
                        style={{ width: `${barWidth}%`, background: `${r.constructor_color}30` }}
                      >
                        <span className="text-[11px] font-mono font-bold whitespace-nowrap">{r.extra_from_drs >= 0 ? "+" : ""}{r.extra_from_drs.toFixed(1)}</span>
                      </div>
                    </div>
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0 inline-flex items-center gap-0.5"
                      style={{ background: tier.bg, color: tier.color }}
                    >
                      {tier.label}<InfoTooltip text={TIER_TOOLTIP} />
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Detailed Table */}
          <div className="glass-card rounded-2xl overflow-hidden" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" style={{ minWidth: 650 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--card-border)" }}>
                    <th className="px-4 py-3 text-[10px] uppercase tracking-widest text-gray-600 font-semibold text-left">Driver</th>
                    <th className="px-4 py-3 text-[10px] uppercase tracking-widest text-gray-600 font-semibold text-right">1x Pts</th>
                    <th className="px-4 py-3 text-[10px] uppercase tracking-widest text-gray-600 font-semibold text-right">2x Pts</th>
                    <th className="px-4 py-3 text-[10px] uppercase tracking-widest text-gray-600 font-semibold text-right">DRS Extra</th>
                    <th className="px-4 py-3 text-[10px] uppercase tracking-widest text-gray-600 font-semibold text-right">
                      <span className="inline-flex items-center">P10 (2x)<InfoTooltip text="10th percentile — worst-case scenario. 90% of simulations scored above this." /></span>
                    </th>
                    <th className="px-4 py-3 text-[10px] uppercase tracking-widest text-gray-600 font-semibold text-right">
                      <span className="inline-flex items-center">P90 (2x)<InfoTooltip text="90th percentile — best-case scenario. Only 10% of simulations scored above this." /></span>
                    </th>
                    <th className="px-4 py-3 text-[10px] uppercase tracking-widest text-gray-600 font-semibold text-right">
                      <span className="inline-flex items-center">Risk<InfoTooltip text="Volatility metric (0-100%). Higher means more unpredictable outcomes. Low risk = consistent scorer, high risk = boom-or-bust." /></span>
                    </th>
                    <th className="px-4 py-3 text-[10px] uppercase tracking-widest text-gray-600 font-semibold text-right">
                      <span className="inline-flex items-center">Tier<InfoTooltip text={TIER_TOOLTIP} /></span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r, i) => {
                    const tier = TIER_STYLES[r.tier] || TIER_STYLES.neutral;
                    return (
                      <tr key={r.driver_id} className="transition-colors hover:bg-white/[0.02]"
                        style={{ borderBottom: "1px solid var(--card-border)", background: i === 0 ? "rgba(225,6,0,0.04)" : "transparent" }}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-1.5 h-4 rounded-full" style={{ backgroundColor: r.constructor_color }} />
                            <span className="font-semibold">{r.name}</span>
                            {i === 0 && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold" style={{ background: "var(--f1-red)", color: "white" }}>BEST</span>}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-gray-400">{r.expected_1x.toFixed(1)}</td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-white">{r.expected_2x.toFixed(1)}</td>
                        <td className="px-4 py-3 text-right font-mono font-bold" style={{ color: "var(--neon-green)" }}>+{r.extra_from_drs.toFixed(1)}</td>
                        <td className="px-4 py-3 text-right font-mono text-red-400">{r.p10_2x.toFixed(1)}</td>
                        <td className="px-4 py-3 text-right font-mono" style={{ color: "var(--neon-green)" }}>{r.p90_2x.toFixed(1)}</td>
                        <td className="px-4 py-3 text-right font-mono text-gray-400">{(r.risk_score * 100).toFixed(0)}%</td>
                        <td className="px-4 py-3 text-right">
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold" style={{ background: tier.bg, color: tier.color }}>{tier.label}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
