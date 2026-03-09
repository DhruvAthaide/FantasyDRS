"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { api } from "@/lib/api";
import type { PowerUnitStatus, Race } from "@/types";

const COMPONENT_LIMITS: Record<string, number> = {
  ICE: 4, TC: 4, "MGU-K": 4, "MGU-H": 4, ES: 2, CE: 2, Gearbox: 4,
};

const COMPONENTS = Object.keys(COMPONENT_LIMITS);

export default function PenaltiesPage() {
  const [puStatus, setPuStatus] = useState<PowerUnitStatus[]>([]);
  const [races, setRaces] = useState<Race[]>([]);

  const loadData = () => {
    Promise.all([api.getPenaltyStatus(), api.getRaces()]).then(([pu, r]) => {
      setPuStatus(pu);
      setRaces(r);
    });
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleIncrement = async (driverId: number, componentType: string) => {
    await api.incrementPuComponent(driverId, componentType);
    loadData();
  };

  const handleReset = async () => {
    await api.resetPuAllocations();
    loadData();
  };

  const atRiskDrivers = puStatus.filter((d) => d.at_risk);

  // Penalty-friendly circuits (low overtake difficulty)
  const penaltyFriendly = races
    .map((r) => ({ ...r, cost: r.overtake_difficulty }))
    .sort((a, b) => a.cost - b.cost)
    .slice(0, 8);

  return (
    <div className="space-y-8">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl sm:text-3xl font-black tracking-tight">Penalties</h1>
        <p className="text-xs sm:text-sm text-gray-500 mt-1">Grid penalty calendar and power unit allocation tracker</p>
      </motion.div>

      {/* PU Allocation Table */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.05 }} className="space-y-4">
        <h2 className="text-xs font-bold uppercase tracking-widest text-gray-500">Power Unit Allocations</h2>
        <div className="rounded-2xl overflow-hidden" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: 650 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--card-border)" }}>
                  <th className="px-4 py-3.5 text-[10px] uppercase tracking-widest text-gray-600 font-semibold text-left">Driver</th>
                  {COMPONENTS.map((c) => (
                    <th key={c} className="px-2 py-3.5 text-[10px] uppercase tracking-widest text-gray-600 font-semibold text-center">{c}</th>
                  ))}
                  <th className="px-4 py-3.5 text-[10px] uppercase tracking-widest text-gray-600 font-semibold text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {puStatus.map((driver) => (
                  <tr key={driver.driver_id} className="transition-colors hover:bg-white/[0.02]" style={{ borderBottom: "1px solid var(--card-border)" }}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-1.5 h-5 rounded-full" style={{ backgroundColor: driver.driver_color }} />
                        <span className="font-semibold">{driver.driver_code}</span>
                      </div>
                    </td>
                    {COMPONENTS.map((comp) => {
                      const used = driver.components[comp] || 0;
                      const limit = COMPONENT_LIMITS[comp];
                      const pct = used / limit;
                      return (
                        <td key={comp} className="px-2 py-3 text-center">
                          <button
                            onClick={() => handleIncrement(driver.driver_id, comp)}
                            className="inline-flex items-center justify-center w-8 h-7 rounded-md text-[10px] font-bold cursor-pointer transition-transform hover:scale-110"
                            style={{
                              background: pct >= 1 ? "rgba(239,68,68,0.2)" : pct >= 0.75 ? "rgba(245,158,11,0.2)" : "rgba(34,197,94,0.1)",
                              color: pct >= 1 ? "#ef4444" : pct >= 0.75 ? "#f59e0b" : "#22c55e",
                              border: "none",
                            }}
                            title={`Click to add new ${comp} for ${driver.driver_code}`}
                          >
                            {used}/{limit}
                          </button>
                        </td>
                      );
                    })}
                    <td className="px-4 py-3 text-center">
                      {driver.at_risk ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-500/20 text-red-400">AT RISK</span>
                      ) : (
                        <span className="text-[10px] text-gray-500">OK</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <p className="text-[10px] text-gray-600">
            Click any cell to increment usage. All drivers start with 1 of each component. Exceeding limits triggers a grid penalty.
          </p>
          <button
            onClick={handleReset}
            className="text-[10px] text-gray-500 hover:text-red-400 transition-colors px-2 py-1 rounded"
          >
            Reset Season
          </button>
        </div>
      </motion.div>

      {/* Penalty-Friendly Circuits */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }} className="space-y-4">
        <h2 className="text-xs font-bold uppercase tracking-widest text-gray-500">Best Penalty Races (Easiest Recovery)</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {penaltyFriendly.map((race, i) => (
            <div
              key={race.id}
              className="rounded-xl p-4 transition-all"
              style={{
                background: i < 3 ? "rgba(34,197,94,0.08)" : "var(--card-bg)",
                border: i < 3 ? "1px solid rgba(34,197,94,0.3)" : "1px solid var(--card-border)",
              }}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] text-gray-500 font-semibold">R{race.round}</span>
                {i < 3 && <span className="text-[9px] font-bold text-emerald-400 uppercase">Recommended</span>}
              </div>
              <p className="text-sm font-bold truncate">{race.name.replace(" Grand Prix", "")}</p>
              <div className="mt-2 flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--card-border)" }}>
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${race.cost * 100}%`,
                      background: race.cost < 0.35 ? "#22c55e" : race.cost < 0.6 ? "#f59e0b" : "#ef4444",
                    }}
                  />
                </div>
                <span className="text-[10px] font-mono text-gray-500">{(race.cost * 10).toFixed(1)}</span>
              </div>
              <p className="text-[10px] text-gray-500 mt-1">
                Overtake difficulty: {race.cost < 0.35 ? "Easy" : race.cost < 0.6 ? "Medium" : "Hard"}
              </p>
            </div>
          ))}
        </div>
      </motion.div>

      {/* At-Risk Drivers Summary */}
      {atRiskDrivers.length > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }}
          className="rounded-2xl p-5" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}
        >
          <h3 className="text-xs font-bold uppercase tracking-widest text-red-400 mb-3">Drivers at Penalty Risk</h3>
          <div className="flex flex-wrap gap-2">
            {atRiskDrivers.map((d) => {
              const overLimit = COMPONENTS.filter((c) => (d.components[c] || 0) >= COMPONENT_LIMITS[c]);
              return (
                <div key={d.driver_id} className="rounded-lg px-3 py-2" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
                  <span className="font-bold text-sm" style={{ color: d.driver_color }}>{d.driver_code}</span>
                  <span className="text-[10px] text-gray-500 ml-2">{overLimit.join(", ")}</span>
                </div>
              );
            })}
          </div>
        </motion.div>
      )}
    </div>
  );
}
