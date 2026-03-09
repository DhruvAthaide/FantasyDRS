"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { api } from "@/lib/api";
import type { SeasonSummary } from "@/types";

export default function SeasonPage() {
  const [data, setData] = useState<SeasonSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getSeasonSummary()
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="w-6 h-6 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const noData = !data || data.drivers.length === 0;

  return (
    <div className="space-y-8">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl sm:text-3xl font-black tracking-tight">Season Tracker</h1>
        <p className="text-xs sm:text-sm text-gray-500 mt-1">
          Cumulative fantasy points and trends across the season
          {data && data.races_completed > 0 && (
            <span className="ml-2 text-gray-400">({data.races_completed} race{data.races_completed > 1 ? "s" : ""} recorded)</span>
          )}
        </p>
      </motion.div>

      {noData && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-16">
          <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ background: "var(--card-border)" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#4b5563" strokeWidth="2">
              <path d="M18 20V10M12 20V4M6 20v-6" />
            </svg>
          </div>
          <p className="text-sm text-gray-500 font-medium">No Season Data</p>
          <p className="text-xs text-gray-600 mt-1">Record race results first, then season stats will appear here</p>
        </motion.div>
      )}

      {data && data.drivers.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
          {/* Top 3 Podium */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {data.drivers.slice(0, 3).map((d, i) => (
              <div key={d.driver_id} className="rounded-xl p-4 relative overflow-hidden"
                style={{
                  background: i === 0 ? "rgba(225,6,0,0.06)" : "var(--card-bg)",
                  border: i === 0 ? "1px solid rgba(225,6,0,0.2)" : "1px solid var(--card-border)",
                }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-2xl font-black text-gray-600">#{i + 1}</span>
                  <div className="w-1.5 h-5 rounded-full" style={{ backgroundColor: d.constructor_color }} />
                  <span className="font-bold">{d.name}</span>
                </div>
                <div className="text-2xl font-black" style={{ color: i === 0 ? "var(--f1-red)" : "white" }}>
                  {d.total_pts.toFixed(1)} <span className="text-sm font-semibold text-gray-500">pts</span>
                </div>
                <div className="flex gap-3 mt-2 text-[10px] text-gray-500">
                  <span>Avg: <span className="font-mono text-gray-400">{d.avg_pts.toFixed(1)}</span></span>
                  <span>Best: <span className="font-mono text-emerald-400">{d.best_pts.toFixed(1)}</span></span>
                  <span>Worst: <span className="font-mono text-red-400">{d.worst_pts.toFixed(1)}</span></span>
                </div>
              </div>
            ))}
          </div>

          {/* Cumulative Points Chart (simple bar chart) */}
          <div className="rounded-2xl p-5" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
            <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-4">Season Standings</h3>
            <div className="space-y-2">
              {data.drivers.map((d, i) => {
                const maxPts = data.drivers[0]?.total_pts || 1;
                const barWidth = Math.max(5, (d.total_pts / maxPts) * 100);
                return (
                  <div key={d.driver_id} className="flex items-center gap-3">
                    <span className="text-xs font-bold text-gray-600 w-5 text-right">{i + 1}</span>
                    <div className="w-10 text-xs font-bold text-right" style={{ color: d.constructor_color }}>{d.code}</div>
                    <div className="flex-1 h-7 rounded-lg overflow-hidden relative" style={{ background: "var(--surface)" }}>
                      <div className="h-full rounded-lg transition-all duration-500 flex items-center px-2"
                        style={{ width: `${barWidth}%`, background: `${d.constructor_color}30` }}
                      >
                        <span className="text-[11px] font-mono font-bold whitespace-nowrap">{d.total_pts.toFixed(1)}</span>
                      </div>
                    </div>
                    <span className="text-[10px] font-mono text-gray-500 w-14 text-right">
                      avg {d.avg_pts.toFixed(1)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Full Table */}
          <div className="rounded-2xl overflow-hidden" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" style={{ minWidth: 700 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--card-border)" }}>
                    {["#", "Driver", "Races", "Total", "Avg", "Best", "Best Race", "Worst", "Worst Race"].map((h, i) => (
                      <th key={h} className={`px-3 py-3 text-[10px] uppercase tracking-widest text-gray-600 font-semibold ${i <= 1 ? "text-left" : "text-right"}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.drivers.map((d, i) => (
                    <tr key={d.driver_id} className="hover:bg-white/[0.02]"
                      style={{ borderBottom: "1px solid var(--card-border)", background: i < 3 ? "rgba(225,6,0,0.03)" : "transparent" }}
                    >
                      <td className="px-3 py-2 font-bold text-gray-600">{i + 1}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="w-1.5 h-4 rounded-full" style={{ backgroundColor: d.constructor_color }} />
                          <span className="font-semibold">{d.name}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-gray-400">{d.races_completed}</td>
                      <td className="px-3 py-2 text-right font-mono font-bold text-white">{d.total_pts.toFixed(1)}</td>
                      <td className="px-3 py-2 text-right font-mono text-gray-400">{d.avg_pts.toFixed(1)}</td>
                      <td className="px-3 py-2 text-right font-mono text-emerald-400">{d.best_pts.toFixed(1)}</td>
                      <td className="px-3 py-2 text-right text-xs text-gray-500">{d.best_race}</td>
                      <td className="px-3 py-2 text-right font-mono text-red-400">{d.worst_pts.toFixed(1)}</td>
                      <td className="px-3 py-2 text-right text-xs text-gray-500">{d.worst_race}</td>
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
