"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { api } from "@/lib/api";
import type { ChipStrategyResponse } from "@/types";

const CHIP_INFO: Record<string, { label: string; color: string; description: string }> = {
  wildcard: { label: "Wildcard", color: "#a855f7", description: "Unlimited free transfers for one race" },
  limitless: { label: "Limitless", color: "#22c55e", description: "No budget cap for one race" },
  extra_drs: { label: "Extra DRS", color: "#3b82f6", description: "3 DRS boost drivers instead of 1" },
  final_fix: { label: "Final Fix", color: "#f59e0b", description: "Change 1 driver after qualifying" },
  autopilot: { label: "Autopilot", color: "#06b6d4", description: "Auto-selects the optimal team" },
};

export default function ChipPlannerPage() {
  const [chipData, setChipData] = useState<ChipStrategyResponse[]>([]);
  const [selectedChip, setSelectedChip] = useState<string>("limitless");
  const [loading, setLoading] = useState(false);
  const [batchSimulating, setBatchSimulating] = useState(false);
  const [batchResult, setBatchResult] = useState<{ simulated_count: number } | null>(null);

  const loadChipData = () => {
    setLoading(true);
    api.evaluateChips("all").then((data) => {
      setChipData(data);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  useEffect(() => {
    loadChipData();
  }, []);

  const handleBatchSimulate = async () => {
    setBatchSimulating(true);
    setBatchResult(null);
    try {
      const result = await api.batchSimulate();
      setBatchResult(result);
      // Reload chip data after batch simulation
      loadChipData();
    } catch {
      // silently fail
    } finally {
      setBatchSimulating(false);
    }
  };

  const currentChip = chipData.find((c) => c.chip_type === selectedChip);
  const chipInfo = CHIP_INFO[selectedChip];
  const hasSimData = currentChip?.race_values.some((rv) => rv.normal_points > 0);

  return (
    <div className="space-y-8">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl sm:text-3xl font-black tracking-tight">Chip Planner</h1>
        <p className="text-xs sm:text-sm text-gray-500 mt-1">Find the optimal race to use each chip for maximum value</p>
      </motion.div>

      {/* Chip Selector */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.05 }}>
        <div className="flex flex-wrap gap-2">
          {Object.entries(CHIP_INFO).map(([key, info]) => (
            <button
              key={key}
              onClick={() => setSelectedChip(key)}
              className="px-4 py-2.5 rounded-xl text-xs font-bold transition-all"
              style={selectedChip === key
                ? { background: info.color, color: "white", boxShadow: `0 0 20px ${info.color}30` }
                : { background: "var(--card-bg)", border: "1px solid var(--card-border)", color: "#6b7280" }
              }
            >
              {info.label}
            </button>
          ))}
        </div>
      </motion.div>

      {/* Chip Description */}
      {chipInfo && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}
          className="rounded-2xl p-5" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}
        >
          <div className="flex items-center gap-3 mb-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: chipInfo.color }} />
            <h2 className="text-sm font-bold">{chipInfo.label}</h2>
          </div>
          <p className="text-xs text-gray-500">{chipInfo.description}</p>
          {currentChip && currentChip.best_gain > 0 && (
            <div className="mt-3 flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold">Best Race:</span>
              <span className="text-sm font-bold" style={{ color: chipInfo.color }}>{currentChip.best_race_name}</span>
              <span className="text-xs font-mono text-emerald-400">+{currentChip.best_gain.toFixed(1)} pts</span>
            </div>
          )}
        </motion.div>
      )}

      {/* Race Calendar Grid */}
      {loading && (
        <div className="text-center py-16">
          <p className="text-sm text-gray-500">Loading chip analysis...</p>
        </div>
      )}

      {!loading && !hasSimData && (
        <div className="text-center py-16">
          <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ background: "var(--card-border)" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#4b5563" strokeWidth="2">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <p className="text-sm text-gray-500 font-medium">No Simulation Data</p>
          <p className="text-xs text-gray-600 mt-1 mb-4">Simulations need to be run for all races to evaluate chip strategy</p>
          <button
            onClick={handleBatchSimulate}
            disabled={batchSimulating}
            className="px-5 py-2.5 rounded-xl text-xs font-bold transition-all disabled:opacity-50"
            style={{ background: "var(--f1-red)", color: "white" }}
          >
            {batchSimulating ? "Simulating All Races..." : "Simulate All Races"}
          </button>
          {batchResult && (
            <p className="text-xs text-emerald-400 mt-3">
              Simulated {batchResult.simulated_count} races successfully
            </p>
          )}
        </div>
      )}

      {!loading && hasSimData && currentChip && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
          {/* Race Cards Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
            {currentChip.race_values.map((rv) => {
              const isBest = rv.race_id === currentChip.best_race_id && rv.chip_gain > 0;
              const hasData = rv.normal_points > 0;
              return (
                <div
                  key={rv.race_id}
                  className="rounded-xl p-3 transition-all"
                  style={{
                    background: isBest ? `${chipInfo.color}15` : "var(--card-bg)",
                    border: isBest ? `2px solid ${chipInfo.color}` : "1px solid var(--card-border)",
                  }}
                >
                  <div className="text-[10px] text-gray-500 font-semibold mb-1">R{rv.race_round}</div>
                  <div className="text-xs font-bold truncate mb-2" title={rv.race_name}>
                    {rv.race_name.replace(" Grand Prix", "")}
                  </div>
                  {hasData ? (
                    <>
                      <div className="text-lg font-black" style={{ color: rv.chip_gain > 0 ? chipInfo.color : "#6b7280" }}>
                        {rv.chip_gain > 0 ? "+" : ""}{rv.chip_gain.toFixed(1)}
                      </div>
                      <div className="text-[10px] text-gray-500 font-mono">
                        {rv.chip_points.toFixed(1)} vs {rv.normal_points.toFixed(1)}
                      </div>
                      {isBest && (
                        <div className="mt-1.5 text-[9px] font-bold uppercase tracking-wider" style={{ color: chipInfo.color }}>
                          Best Race
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-xs text-gray-600">No sim</div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Summary Table */}
          <div className="rounded-2xl overflow-hidden" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" style={{ minWidth: 500 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--card-border)" }}>
                    {["Race", "Normal Pts", "Chip Pts", "Gain"].map((h, i) => (
                      <th key={h} className={`px-5 py-3.5 text-[10px] uppercase tracking-widest text-gray-600 font-semibold ${i === 0 ? "text-left" : "text-right"}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {currentChip.race_values.filter((rv) => rv.normal_points > 0).sort((a, b) => b.chip_gain - a.chip_gain).map((rv) => (
                    <tr key={rv.race_id} className="transition-colors hover:bg-white/[0.02]" style={{ borderBottom: "1px solid var(--card-border)" }}>
                      <td className="px-5 py-3">
                        <span className="font-semibold">{rv.race_name}</span>
                        {rv.race_id === currentChip.best_race_id && rv.chip_gain > 0 && (
                          <span className="ml-2 px-1.5 py-0.5 rounded text-[9px] font-bold" style={{ background: chipInfo.color, color: "white" }}>BEST</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right font-mono text-gray-400">{rv.normal_points.toFixed(1)}</td>
                      <td className="px-5 py-3 text-right font-mono" style={{ color: chipInfo.color }}>{rv.chip_points.toFixed(1)}</td>
                      <td className={`px-5 py-3 text-right font-mono font-bold ${rv.chip_gain > 0 ? "text-emerald-400" : "text-gray-500"}`}>
                        {rv.chip_gain > 0 ? "+" : ""}{rv.chip_gain.toFixed(1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
