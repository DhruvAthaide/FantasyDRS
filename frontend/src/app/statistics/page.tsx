"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { api } from "@/lib/api";
import type { Driver, Constructor, Race, ScoreBreakdown, FixtureDifficultyRow } from "@/types";
import RaceSelector from "@/components/RaceSelector";
import InfoTooltip from "@/components/InfoTooltip";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend,
} from "recharts";

type Tab = "drivers" | "constructors" | "comparison" | "breakdown" | "fixtures";

const XPTS_TOOLTIP = "Expected Points — average predicted score from 50,000 Monte Carlo simulations";
const PPM_TOOLTIP = "Points Per Million — expected points divided by price. Higher = better value";

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl px-4 py-3 text-xs shadow-xl" style={{ background: "var(--surface)", border: "1px solid var(--card-border)" }}>
      <p className="font-bold text-sm mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} className="font-mono" style={{ color: p.color || "#22c55e" }}>
          {p.name}: {p.value.toFixed(2)}
        </p>
      ))}
    </div>
  );
};

export default function Statistics() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [constructors, setConstructors] = useState<Constructor[]>([]);
  const [races, setRaces] = useState<Race[]>([]);
  const [selectedRaceId, setSelectedRaceId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("drivers");
  const [compareIds, setCompareIds] = useState<number[]>([]);
  const [breakdowns, setBreakdowns] = useState<ScoreBreakdown[]>([]);
  const [breakdownView, setBreakdownView] = useState<"drivers" | "constructors">("drivers");
  const [fixtureData, setFixtureData] = useState<FixtureDifficultyRow[]>([]);
  const [fixtureView, setFixtureView] = useState<"driver" | "constructor">("driver");

  useEffect(() => {
    Promise.all([api.getDrivers(), api.getConstructors(), api.getRaces()]).then(
      ([d, c, r]) => { setDrivers(d); setConstructors(c); setRaces(r); }
    ).catch(() => {});
    api.getNextRace().then((next) => {
      if (next) setSelectedRaceId(next.id);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedRaceId) return;
    Promise.all([api.getDrivers(selectedRaceId), api.getConstructors(selectedRaceId), api.getAllStats(selectedRaceId)])
      .then(([d, c, b]) => { setDrivers(d); setConstructors(c); setBreakdowns(b); }).catch(() => {});
  }, [selectedRaceId]);

  useEffect(() => {
    if (activeTab === "fixtures") {
      api.getFixtureDifficulty(fixtureView).then(setFixtureData).catch(() => {});
    }
  }, [activeTab, fixtureView]);

  const hasDriverSim = drivers.some((d) => d.expected_pts !== null);
  const driverChartData = [...drivers]
    .sort((a, b) => (b.expected_pts ?? 0) - (a.expected_pts ?? 0))
    .map((d) => ({
      name: d.code, xPts: d.expected_pts ?? 0, price: d.price,
      ppm: d.expected_pts ? d.expected_pts / d.price : 0, color: d.constructor_color,
    }));

  const hasConstructorSim = constructors.some((c) => c.expected_pts !== null);
  const constructorChartData = [...constructors]
    .sort((a, b) => (b.expected_pts ?? 0) - (a.expected_pts ?? 0))
    .map((c) => ({
      name: c.name, xPts: c.expected_pts ?? 0, price: c.price,
      ppm: c.expected_pts ? c.expected_pts / c.price : 0, color: c.color,
    }));

  const toggleCompare = (id: number) => {
    setCompareIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < 4 ? [...prev, id] : prev);
  };

  return (
    <div className="space-y-8">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight">Statistics</h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-1">Deep analysis of expected performance and value</p>
        </div>
        <RaceSelector races={races} selectedRaceId={selectedRaceId} onSelect={setSelectedRaceId} />
      </motion.div>

      {/* Tabs */}
      <div className="flex rounded-xl overflow-x-auto w-full sm:w-fit" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
        {(["drivers", "constructors", "comparison", "breakdown", "fixtures"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 sm:flex-none px-5 py-3 sm:py-2.5 text-xs font-semibold capitalize transition-all relative whitespace-nowrap ${
              activeTab === tab ? "text-white" : "text-gray-500 hover:text-gray-300"
            }`}
            style={activeTab === tab ? { background: "var(--f1-red)" } : {}}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Drivers */}
      {activeTab === "drivers" && driverChartData.length > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
          {!hasDriverSim && (
            <div className="rounded-xl px-4 py-3 text-xs text-gray-500" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
              Select a race and run a simulation to see expected points and charts
            </div>
          )}

          {hasDriverSim && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <div className="glass-card rounded-2xl p-5" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
                <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-5">Expected Points</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={driverChartData} margin={{ top: 0, right: 0, bottom: 0, left: -15 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" vertical={false} />
                    <XAxis dataKey="name" tick={{ fill: "#6b7280", fontSize: 10, fontWeight: 600 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: "#4b5563", fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,0.02)" }} />
                    <Bar dataKey="xPts" name="Expected Pts" radius={[6, 6, 0, 0]} maxBarSize={32}>
                      {driverChartData.map((entry, idx) => (<Cell key={idx} fill={entry.color} />))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="glass-card rounded-2xl p-5" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
                <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-5">Points Per Million (Value)</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={[...driverChartData].sort((a, b) => b.ppm - a.ppm)} margin={{ top: 0, right: 0, bottom: 0, left: -15 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" vertical={false} />
                    <XAxis dataKey="name" tick={{ fill: "#6b7280", fontSize: 10, fontWeight: 600 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: "#4b5563", fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,0.02)" }} />
                    <Bar dataKey="ppm" name="Pts/Million" radius={[6, 6, 0, 0]} maxBarSize={32}>
                      {[...driverChartData].sort((a, b) => b.ppm - a.ppm).map((entry, idx) => (<Cell key={idx} fill={entry.color} />))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          <div className="glass-card rounded-2xl overflow-hidden" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--card-border)" }}>
                  <th className="px-5 py-3.5 text-[10px] uppercase tracking-widest text-gray-600 font-semibold text-left">#</th>
                  <th className="px-5 py-3.5 text-[10px] uppercase tracking-widest text-gray-600 font-semibold text-left">Driver</th>
                  <th className="px-5 py-3.5 text-[10px] uppercase tracking-widest text-gray-600 font-semibold text-right">Price</th>
                  <th className="px-5 py-3.5 text-[10px] uppercase tracking-widest text-gray-600 font-semibold text-right">
                    <span className="inline-flex items-center">xPts<InfoTooltip text={XPTS_TOOLTIP} /></span>
                  </th>
                  <th className="px-5 py-3.5 text-[10px] uppercase tracking-widest text-gray-600 font-semibold text-right">
                    <span className="inline-flex items-center">Pts/M<InfoTooltip text={PPM_TOOLTIP} /></span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {driverChartData.map((d, i) => (
                  <tr key={d.name} className="transition-colors hover:bg-white/[0.02]" style={{ borderBottom: "1px solid var(--card-border)" }}>
                    <td className="px-5 py-3 text-xs text-gray-600 font-mono">{i + 1}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-1.5 h-5 rounded-full" style={{ backgroundColor: d.color }} />
                        <span className="font-semibold">{d.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right font-mono text-gray-400">${d.price}M</td>
                    <td className="px-5 py-3 text-right font-mono font-semibold" style={{ color: "var(--neon-green)" }}>{hasDriverSim ? d.xPts.toFixed(1) : "\u2014"}</td>
                    <td className="px-5 py-3 text-right font-mono text-blue-400">{hasDriverSim ? d.ppm.toFixed(2) : "\u2014"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}

      {/* Constructors */}
      {activeTab === "constructors" && constructorChartData.length > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
          {!hasConstructorSim && (
            <div className="rounded-xl px-4 py-3 text-xs text-gray-500" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
              Select a race and run a simulation to see expected points and charts
            </div>
          )}

          {hasConstructorSim && (
            <div className="glass-card rounded-2xl p-5" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
              <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-5">Expected Points by Constructor</h3>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={constructorChartData} margin={{ top: 0, right: 0, bottom: 20, left: -15 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: "#6b7280", fontSize: 10, fontWeight: 600 }} angle={-15} textAnchor="end" axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#4b5563", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,0.02)" }} />
                  <Bar dataKey="xPts" name="Expected Pts" radius={[6, 6, 0, 0]} maxBarSize={48}>
                    {constructorChartData.map((entry, idx) => (<Cell key={idx} fill={entry.color} />))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="glass-card rounded-2xl overflow-hidden" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--card-border)" }}>
                  <th className="px-5 py-3.5 text-[10px] uppercase tracking-widest text-gray-600 font-semibold text-left">Constructor</th>
                  <th className="px-5 py-3.5 text-[10px] uppercase tracking-widest text-gray-600 font-semibold text-right">Price</th>
                  <th className="px-5 py-3.5 text-[10px] uppercase tracking-widest text-gray-600 font-semibold text-right">
                    <span className="inline-flex items-center">xPts<InfoTooltip text={XPTS_TOOLTIP} /></span>
                  </th>
                  <th className="px-5 py-3.5 text-[10px] uppercase tracking-widest text-gray-600 font-semibold text-right">
                    <span className="inline-flex items-center">Pts/M<InfoTooltip text={PPM_TOOLTIP} /></span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {constructorChartData.map((c) => (
                  <tr key={c.name} className="transition-colors hover:bg-white/[0.02]" style={{ borderBottom: "1px solid var(--card-border)" }}>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: c.color }} />
                        <span className="font-semibold">{c.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right font-mono text-gray-400">${c.price}M</td>
                    <td className="px-5 py-3 text-right font-mono font-semibold" style={{ color: "var(--neon-green)" }}>{hasConstructorSim ? c.xPts.toFixed(1) : "\u2014"}</td>
                    <td className="px-5 py-3 text-right font-mono text-blue-400">{hasConstructorSim ? c.ppm.toFixed(2) : "\u2014"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}

      {/* Comparison */}
      {activeTab === "comparison" && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-5">
          <p className="text-xs text-gray-500 uppercase tracking-widest font-semibold">Select up to 4 drivers to compare</p>
          <div className="flex flex-wrap gap-2">
            {drivers.map((d) => (
              <motion.button
                key={d.id}
                onClick={() => toggleCompare(d.id)}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all"
                style={compareIds.includes(d.id) ? {
                  backgroundColor: d.constructor_color,
                  color: "white",
                  boxShadow: `0 0 15px ${d.constructor_color}40`,
                } : {
                  background: "var(--card-bg)",
                  border: "1px solid var(--card-border)",
                  color: "#6b7280",
                }}
              >
                {d.code}
              </motion.button>
            ))}
          </div>

          {compareIds.length >= 2 && (
            <div className="glass-card rounded-2xl overflow-hidden" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--card-border)" }}>
                    <th className="px-5 py-3.5 text-[10px] uppercase tracking-widest text-gray-600 font-semibold text-left">Metric</th>
                    {compareIds.map((id) => {
                      const d = drivers.find((dr) => dr.id === id);
                      return (
                        <th key={id} className="px-5 py-3.5 text-center">
                          <span className="text-sm font-bold" style={{ color: d?.constructor_color }}>{d?.code}</span>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: "Price", fn: (d: Driver) => `$${d.price}M` },
                    { label: "Expected Pts", fn: (d: Driver) => d.expected_pts?.toFixed(1) ?? "N/A" },
                    { label: "Pts/Million", fn: (d: Driver) => d.expected_pts ? (d.expected_pts / d.price).toFixed(2) : "N/A" },
                    { label: "Team", fn: (d: Driver) => d.constructor_name },
                    { label: "Number", fn: (d: Driver) => `#${d.number}` },
                  ].map((row) => (
                    <tr key={row.label} style={{ borderBottom: "1px solid var(--card-border)" }}>
                      <td className="px-5 py-3 text-xs text-gray-500 font-semibold uppercase tracking-wider">{row.label}</td>
                      {compareIds.map((id) => {
                        const d = drivers.find((dr) => dr.id === id);
                        return (
                          <td key={id} className="px-5 py-3 text-center font-mono text-sm">
                            {d ? row.fn(d) : "\u2014"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </motion.div>
      )}

      {/* Score Breakdown */}
      {activeTab === "breakdown" && selectedRaceId && breakdowns.length > 0 && (() => {
        const filtered = breakdowns.filter((b) => b.asset_type === (breakdownView === "drivers" ? "driver" : "constructor"));
        const chartData = [...filtered]
          .sort((a, b) => b.total_pts - a.total_pts)
          .map((b) => ({
            name: b.asset_name,
            Qualifying: b.qualifying_pts,
            "Race Position": b.race_position_pts,
            "Positions Gained": b.positions_gained_pts,
            Overtakes: b.overtake_pts,
            "Fastest Lap": b.fastest_lap_pts,
            DotD: b.dotd_pts,
            Pitstop: b.pitstop_pts,
            "DNF Penalty": b.dnf_penalty,
            total: b.total_pts,
          }));

        const segments = [
          { key: "Qualifying", color: "#3b82f6" },
          { key: "Race Position", color: "#22c55e" },
          { key: "Positions Gained", color: "#a855f7" },
          { key: "Overtakes", color: "#f59e0b" },
          { key: "Fastest Lap", color: "#ec4899" },
          { key: "DotD", color: "#06b6d4" },
          { key: "Pitstop", color: "#84cc16" },
          { key: "DNF Penalty", color: "#ef4444" },
        ];

        return (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
            <div className="flex gap-2">
              {(["drivers", "constructors"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setBreakdownView(v)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold capitalize transition-all"
                  style={breakdownView === v
                    ? { background: "var(--f1-red)", color: "white" }
                    : { background: "var(--card-bg)", border: "1px solid var(--card-border)", color: "#6b7280" }
                  }
                >
                  {v}
                </button>
              ))}
            </div>

            <div className="glass-card rounded-2xl p-5" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
              <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-5">Points Breakdown by Category</h3>
              <div className="overflow-x-auto">
                <div style={{ minWidth: breakdownView === "constructors" ? 500 : 700 }}>
                  <ResponsiveContainer width="100%" height={320}>
                    <BarChart data={chartData} margin={{ top: 0, right: 0, bottom: 20, left: -15 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" vertical={false} />
                      <XAxis dataKey="name" tick={{ fill: "#6b7280", fontSize: 10, fontWeight: 600 }} angle={-25} textAnchor="end" axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: "#4b5563", fontSize: 10 }} axisLine={false} tickLine={false} />
                      <Tooltip
                        content={({ active, payload, label }) => {
                          if (!active || !payload?.length) return null;
                          return (
                            <div className="rounded-xl px-4 py-3 text-xs shadow-xl" style={{ background: "var(--surface)", border: "1px solid var(--card-border)" }}>
                              <p className="font-bold text-sm mb-2">{label}</p>
                              {payload.filter((p: any) => p.value !== 0).map((p: any) => (
                                <p key={p.name} className="font-mono flex justify-between gap-4" style={{ color: p.color }}>
                                  <span>{p.name}</span>
                                  <span>{p.value.toFixed(1)}</span>
                                </p>
                              ))}
                              <div className="border-t mt-2 pt-2 font-bold text-white flex justify-between gap-4" style={{ borderColor: "var(--card-border)" }}>
                                <span>Total</span>
                                <span>{payload.reduce((sum: number, p: any) => sum + (p.value || 0), 0).toFixed(1)}</span>
                              </div>
                            </div>
                          );
                        }}
                        cursor={{ fill: "rgba(255,255,255,0.02)" }}
                      />
                      <Legend
                        wrapperStyle={{ fontSize: 10, paddingTop: 8 }}
                        iconType="circle"
                        iconSize={8}
                      />
                      {segments.map((s) => (
                        <Bar key={s.key} dataKey={s.key} stackId="score" fill={s.color} maxBarSize={40} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            <div className="glass-card rounded-2xl overflow-hidden" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm" style={{ minWidth: 700 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--card-border)" }}>
                      {["Name", "Qual", "Race", "+/- Pos", "OT", "FL", "DotD", "Pit", "DNF", "Total"].map((h, i) => (
                        <th key={h} className={`px-4 py-3.5 text-[10px] uppercase tracking-widest text-gray-600 font-semibold ${i === 0 ? "text-left" : "text-right"}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {chartData.map((d) => (
                      <tr key={d.name} className="transition-colors hover:bg-white/[0.02]" style={{ borderBottom: "1px solid var(--card-border)" }}>
                        <td className="px-4 py-3 font-semibold">{d.name}</td>
                        <td className="px-4 py-3 text-right font-mono" style={{ color: "#3b82f6" }}>{d.Qualifying.toFixed(1)}</td>
                        <td className="px-4 py-3 text-right font-mono" style={{ color: "#22c55e" }}>{d["Race Position"].toFixed(1)}</td>
                        <td className="px-4 py-3 text-right font-mono" style={{ color: "#a855f7" }}>{d["Positions Gained"].toFixed(1)}</td>
                        <td className="px-4 py-3 text-right font-mono" style={{ color: "#f59e0b" }}>{d.Overtakes.toFixed(1)}</td>
                        <td className="px-4 py-3 text-right font-mono" style={{ color: "#ec4899" }}>{d["Fastest Lap"].toFixed(1)}</td>
                        <td className="px-4 py-3 text-right font-mono" style={{ color: "#06b6d4" }}>{d.DotD.toFixed(1)}</td>
                        <td className="px-4 py-3 text-right font-mono" style={{ color: "#84cc16" }}>{d.Pitstop.toFixed(1)}</td>
                        <td className="px-4 py-3 text-right font-mono" style={{ color: d["DNF Penalty"] < 0 ? "#ef4444" : "#6b7280" }}>{d["DNF Penalty"].toFixed(1)}</td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-white">{d.total.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.div>
        );
      })()}

      {activeTab === "breakdown" && selectedRaceId && breakdowns.length === 0 && (
        <div className="text-center py-16">
          <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ background: "var(--card-border)" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#4b5563" strokeWidth="2"><path d="M18 20V10M12 20V4M6 20v-6" /></svg>
          </div>
          <p className="text-sm text-gray-600">Run a simulation for this race to view score breakdowns</p>
        </div>
      )}

      {activeTab === "breakdown" && !selectedRaceId && (
        <div className="text-center py-16">
          <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ background: "var(--card-border)" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#4b5563" strokeWidth="2"><path d="M18 20V10M12 20V4M6 20v-6" /></svg>
          </div>
          <p className="text-sm text-gray-600">Select a race and run a simulation to view score breakdowns</p>
        </div>
      )}

      {/* Fixture Difficulty Heatmap */}
      {activeTab === "fixtures" && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
          <div className="flex gap-2">
            {(["driver", "constructor"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setFixtureView(v)}
                className="px-4 py-2 rounded-xl text-xs font-semibold capitalize transition-all"
                style={fixtureView === v
                  ? { background: "var(--f1-red)", color: "white" }
                  : { background: "var(--card-bg)", border: "1px solid var(--card-border)", color: "#6b7280" }
                }
              >
                {v === "driver" ? "Drivers" : "Constructors"}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3 text-[10px] text-gray-500 uppercase tracking-widest font-semibold">
            <span>Difficulty</span>
            <div className="flex items-center gap-1">
              <div className="w-4 h-3 rounded-sm" style={{ background: "#22c55e" }} />
              <span>Easy</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-4 h-3 rounded-sm" style={{ background: "#f59e0b" }} />
              <span>Medium</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-4 h-3 rounded-sm" style={{ background: "#ef4444" }} />
              <span>Hard</span>
            </div>
          </div>

          {fixtureData.length > 0 && (
            <div className="glass-card rounded-2xl overflow-hidden" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
              <div className="overflow-x-auto">
                <table className="text-xs" style={{ minWidth: fixtureData[0]?.fixtures.length * 44 + 120 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--card-border)" }}>
                      <th className="sticky left-0 z-10 px-3 py-3 text-left text-[10px] uppercase tracking-widest text-gray-600 font-semibold whitespace-nowrap" style={{ background: "var(--card-bg)" }}>
                        {fixtureView === "driver" ? "Driver" : "Constructor"}
                      </th>
                      {fixtureData[0]?.fixtures.map((f) => (
                        <th key={f.race_id} className="px-1 py-3 text-center text-[9px] text-gray-600 font-medium" style={{ minWidth: 40 }}>
                          <div className="truncate" style={{ maxWidth: 36 }}>R{f.race_round}</div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {fixtureData.map((row) => (
                      <tr key={row.asset_id} className="transition-colors hover:bg-white/[0.02]" style={{ borderBottom: "1px solid var(--card-border)" }}>
                        <td className="sticky left-0 z-10 px-3 py-2.5 font-semibold whitespace-nowrap" style={{ background: "var(--card-bg)" }}>
                          <div className="flex items-center gap-2">
                            <div className="w-1.5 h-4 rounded-full" style={{ backgroundColor: row.color }} />
                            <span>{row.asset_name}</span>
                          </div>
                        </td>
                        {row.fixtures.map((f) => {
                          // Green (easy) -> Yellow (medium) -> Red (hard)
                          let bg: string;
                          if (f.difficulty < 0.5) {
                            const t = f.difficulty / 0.5;
                            bg = `rgba(${Math.round(34 + t * (245 - 34))}, ${Math.round(197 - t * (197 - 158))}, ${Math.round(94 - t * (94 - 11))}, ${0.6 + t * 0.2})`;
                          } else {
                            const t = (f.difficulty - 0.5) / 0.5;
                            bg = `rgba(${Math.round(245 - t * (245 - 239))}, ${Math.round(158 - t * (158 - 68))}, ${Math.round(11 + t * (68 - 11))}, ${0.8 + t * 0.15})`;
                          }
                          return (
                            <td key={f.race_id} className="px-1 py-1.5 text-center">
                              <div
                                className="mx-auto w-8 h-7 rounded-md flex items-center justify-center text-[10px] font-bold"
                                style={{ background: bg, color: "white", textShadow: "0 1px 2px rgba(0,0,0,0.3)" }}
                                title={`${f.race_name}: ${(f.difficulty * 10).toFixed(1)}/10`}
                              >
                                {(f.difficulty * 10).toFixed(0)}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {fixtureData.length === 0 && (
            <div className="text-center py-16">
              <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ background: "var(--card-border)" }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#4b5563" strokeWidth="2"><path d="M18 20V10M12 20V4M6 20v-6" /></svg>
              </div>
              <p className="text-sm text-gray-600">Loading fixture difficulty data...</p>
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}
