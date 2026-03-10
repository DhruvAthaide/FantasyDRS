"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/lib/api";
import type { Race, PricePrediction } from "@/types";
import RaceSelector from "@/components/RaceSelector";
import InfoTooltip from "@/components/InfoTooltip";

export default function BudgetBuilder() {
  const [races, setRaces] = useState<Race[]>([]);
  const [selectedRaceId, setSelectedRaceId] = useState<number | null>(null);
  const [predictions, setPredictions] = useState<PricePrediction[]>([]);
  const [loading, setLoading] = useState(false);
  const [sortKey, setSortKey] = useState<"price" | "ppm" | "change">("ppm");
  const [filterType, setFilterType] = useState<"all" | "driver" | "constructor">("all");

  useEffect(() => {
    api.getRaces().then(setRaces).catch(() => {});
    api.getNextRace().then((next) => {
      if (next) setSelectedRaceId(next.id);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedRaceId) return;
    setLoading(true);
    api.getPricePredictions(selectedRaceId).then((p) => { setPredictions(p); }).catch(() => {}).finally(() => setLoading(false));
  }, [selectedRaceId]);

  const filtered = predictions
    .filter((p) => filterType === "all" || p.asset_type === filterType)
    .sort((a, b) => {
      if (sortKey === "price") return b.current_price - a.current_price;
      if (sortKey === "ppm") return b.avg_ppm - a.avg_ppm;
      return b.predicted_change - a.predicted_change;
    });

  const categoryBadge = (cat: string) => {
    const styles: Record<string, { bg: string; text: string; border: string }> = {
      great: { bg: "rgba(0,255,135,0.1)", text: "var(--neon-green)", border: "rgba(0,255,135,0.2)" },
      good: { bg: "rgba(0,255,135,0.06)", text: "var(--neon-green)", border: "rgba(0,255,135,0.1)" },
      poor: { bg: "rgba(255,208,0,0.08)", text: "var(--timing-yellow)", border: "rgba(255,208,0,0.15)" },
      terrible: { bg: "rgba(225,6,0,0.08)", text: "var(--f1-red)", border: "rgba(225,6,0,0.15)" },
    };
    const s = styles[cat] || styles.poor;
    return (
      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-lg" style={{ background: s.bg, color: s.text, border: `1px solid ${s.border}` }}>
        {cat}
      </span>
    );
  };

  return (
    <div className="space-y-8">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight">Budget Builder</h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-1">Predict price changes based on performance vs thresholds</p>
        </div>
        <RaceSelector races={races} selectedRaceId={selectedRaceId} onSelect={setSelectedRaceId} />
      </motion.div>

      {/* Filters */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
        <div className="flex rounded-xl overflow-hidden glass-card">
          {(["all", "driver", "constructor"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setFilterType(t)}
              className={`px-4 py-2 text-xs font-semibold transition-all ${
                filterType === t ? "text-white" : "text-gray-500 hover:text-gray-300"
              }`}
              style={filterType === t ? { background: "var(--f1-red)" } : {}}
            >
              {t === "all" ? "All" : t === "driver" ? "Drivers" : "Constructors"}
            </button>
          ))}
        </div>
        <div className="hidden sm:block flex-1" />
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as typeof sortKey)}
          className="text-xs font-medium px-3 py-2 rounded-xl appearance-none cursor-pointer glass-card"
          style={{ color: "#9ca3af" }}
        >
          <option value="ppm">Sort by PPM</option>
          <option value="price">Sort by Price</option>
          <option value="change">Sort by Change</option>
        </select>
      </motion.div>

      {/* Value / Sell cards */}
      <AnimatePresence>
        {filtered.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="glass-card rounded-2xl p-5 glow-green" style={{ borderColor: "rgba(0,255,135,0.15)" }}>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-2 h-2 rounded-full" style={{ background: "var(--neon-green)" }} />
                <h3 className="text-xs font-bold uppercase tracking-widest" style={{ color: "var(--neon-green)" }}>Value Picks</h3>
              </div>
              <div className="space-y-2.5">
                {filtered.filter((p) => p.predicted_change > 0).slice(0, 5).map((p) => (
                  <div key={`buy-${p.asset_id}`} className="flex justify-between items-center">
                    <span className="text-sm font-medium">{p.asset_name}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-semibold" style={{ color: "var(--neon-green)" }}>+${p.predicted_change.toFixed(1)}M</span>
                      <span className="text-[10px] font-mono text-gray-600">{(p.probability_increase * 100).toFixed(0)}%</span>
                    </div>
                  </div>
                ))}
                {filtered.filter((p) => p.predicted_change > 0).length === 0 && (
                  <p className="text-xs text-gray-600">No value picks identified</p>
                )}
              </div>
            </div>
            <div className="glass-card rounded-2xl p-5 glow-red" style={{ borderColor: "rgba(225,6,0,0.15)" }}>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-2 h-2 rounded-full" style={{ background: "var(--f1-red)" }} />
                <h3 className="text-xs font-bold uppercase tracking-widest" style={{ color: "var(--f1-red)" }}>Sell Candidates</h3>
              </div>
              <div className="space-y-2.5">
                {filtered.filter((p) => p.predicted_change < 0).sort((a, b) => a.predicted_change - b.predicted_change).slice(0, 5).map((p) => (
                  <div key={`sell-${p.asset_id}`} className="flex justify-between items-center">
                    <span className="text-sm font-medium">{p.asset_name}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-semibold" style={{ color: "var(--f1-red)" }}>${p.predicted_change.toFixed(1)}M</span>
                      <span className="text-[10px] font-mono text-gray-600">{(p.probability_decrease * 100).toFixed(0)}%</span>
                    </div>
                  </div>
                ))}
                {filtered.filter((p) => p.predicted_change < 0).length === 0 && (
                  <p className="text-xs text-gray-600">No sell candidates identified</p>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Table */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="h-12 rounded-xl shimmer" />
          ))}
        </div>
      ) : filtered.length > 0 ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }}
          className="glass-card rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--card-border)" }}>
                <th className="px-5 py-3.5 text-[10px] uppercase tracking-widest text-gray-600 font-semibold text-left">Asset</th>
                <th className="px-5 py-3.5 text-[10px] uppercase tracking-widest text-gray-600 font-semibold text-left">Type</th>
                <th className="px-5 py-3.5 text-[10px] uppercase tracking-widest text-gray-600 font-semibold text-right">Price</th>
                <th className="px-5 py-3.5 text-[10px] uppercase tracking-widest text-gray-600 font-semibold text-right">
                  <span className="inline-flex items-center">Avg PPM<InfoTooltip text="Average Points Per Million across simulated races" /></span>
                </th>
                <th className="px-5 py-3.5 text-[10px] uppercase tracking-widest text-gray-600 font-semibold text-right">
                  <span className="inline-flex items-center">Predicted<InfoTooltip text="Expected price movement based on predicted performance vs current price" /></span>
                </th>
                <th className="px-5 py-3.5 text-[10px] uppercase tracking-widest text-gray-600 font-semibold !text-center">Category</th>
                <th className="px-5 py-3.5 text-[10px] uppercase tracking-widest text-gray-600 font-semibold text-right">
                  <span className="inline-flex items-center">P(Up)<InfoTooltip text="Probability of price increasing based on simulation" /></span>
                </th>
                <th className="px-5 py-3.5 text-[10px] uppercase tracking-widest text-gray-600 font-semibold text-right">
                  <span className="inline-flex items-center">P(Down)<InfoTooltip text="Probability of price decreasing based on simulation" /></span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p, i) => (
                <motion.tr
                  key={`${p.asset_type}-${p.asset_id}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.02 }}
                  className="transition-colors hover:bg-white/[0.02]"
                  style={{ borderBottom: "1px solid var(--card-border)" }}
                >
                  <td className="px-5 py-3 font-semibold text-sm">{p.asset_name}</td>
                  <td className="px-5 py-3 text-xs text-gray-600 capitalize">{p.asset_type}</td>
                  <td className="px-5 py-3 text-right font-mono text-sm">${p.current_price}M</td>
                  <td className="px-5 py-3 text-right font-mono text-xs" style={{ color: "var(--neon-cyan)" }}>{p.avg_ppm.toFixed(3)}</td>
                  <td className="px-5 py-3 text-right font-mono font-semibold text-sm"
                    style={{ color: p.predicted_change > 0 ? "var(--neon-green)" : p.predicted_change < 0 ? "var(--f1-red)" : "#6b7280" }}
                  >
                    {p.predicted_change > 0 ? "+" : ""}{p.predicted_change.toFixed(1)}M
                  </td>
                  <td className="px-5 py-3 text-center">{categoryBadge(p.change_category)}</td>
                  <td className="px-5 py-3 text-right">
                    <span className="font-mono text-xs font-semibold" style={{ color: "var(--neon-green)" }}>
                      {(p.probability_increase * 100).toFixed(0)}%
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <span className="font-mono text-xs font-semibold" style={{ color: "var(--f1-red)" }}>
                      {(p.probability_decrease * 100).toFixed(0)}%
                    </span>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
          </div>
        </motion.div>
      ) : (
        <div className="text-center py-16">
          <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ background: "var(--card-border)" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#4b5563" strokeWidth="2">
              <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
          </div>
          <p className="text-sm text-gray-600">
            {selectedRaceId ? "Run a simulation first to generate predictions" : "Select a race to view price predictions"}
          </p>
        </div>
      )}
    </div>
  );
}
