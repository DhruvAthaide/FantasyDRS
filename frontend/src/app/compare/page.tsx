"use client";

import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  Radar,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { api } from "@/lib/api";
import type { Race, Driver, CompareDriverResult } from "@/types";
import RaceSelector from "@/components/RaceSelector";
import InfoTooltip from "@/components/InfoTooltip";

const DIMENSIONS = [
  "Pace",
  "Consistency",
  "Value",
  "Form",
  "Circuit Fit",
  "Risk",
] as const;

const DIMENSION_TOOLTIPS: Record<(typeof DIMENSIONS)[number], string> = {
  Pace: "Qualifying and race pace rating normalized 0-100",
  Consistency: "How predictable the driver's results are. Higher = more reliable",
  Value: "Points per million — how cost-effective the driver is",
  Form: "Recent performance trend: improving, stable, or declining",
  "Circuit Fit": "How well the driver's strengths match this specific circuit",
  Risk: "DNF/incident probability. Lower = safer pick",
};

const DIMENSION_KEYS: Record<(typeof DIMENSIONS)[number], keyof CompareDriverResult> = {
  Pace: "pace_rating",
  Consistency: "consistency",
  Value: "value",
  "Circuit Fit": "circuit_fit",
  Risk: "risk",
  Form: "pace_rating", // Form uses form_trend for the indicator; we map a numeric proxy below
};

const MAX_DRIVERS = 4;

function formToNumeric(trend: CompareDriverResult["form_trend"]): number {
  if (trend === "improving") return 90;
  if (trend === "stable") return 60;
  return 30;
}

function getDimensionValue(
  d: CompareDriverResult,
  dim: (typeof DIMENSIONS)[number]
): number {
  if (dim === "Form") return formToNumeric(d.form_trend);
  return d[DIMENSION_KEYS[dim]] as number;
}

function FormTrendIndicator({ trend }: { trend: CompareDriverResult["form_trend"] }) {
  if (trend === "improving") {
    return (
      <span className="inline-flex items-center gap-1 text-emerald-400 text-xs font-bold">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
          <polyline points="18 15 12 9 6 15" />
        </svg>
        Improving
      </span>
    );
  }
  if (trend === "declining") {
    return (
      <span className="inline-flex items-center gap-1 text-red-400 text-xs font-bold">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
          <polyline points="6 9 12 15 18 9" />
        </svg>
        Declining
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-yellow-400 text-xs font-bold">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
      Stable
    </span>
  );
}

export default function ComparePage() {
  const [races, setRaces] = useState<Race[]>([]);
  const [selectedRaceId, setSelectedRaceId] = useState<number | null>(null);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [results, setResults] = useState<CompareDriverResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    Promise.all([api.getRaces(), api.getDrivers(), api.getNextRace()]).then(
      ([r, d, next]) => {
        setRaces(r);
        setDrivers(d);
        if (next) setSelectedRaceId(next.id);
      }
    ).catch(() => {});
  }, []);

  const toggleDriver = (id: number) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((d) => d !== id);
      if (prev.length >= MAX_DRIVERS) return prev;
      return [...prev, id];
    });
  };

  const handleCompare = async () => {
    if (selectedIds.length < 2 || !selectedRaceId) return;
    setLoading(true);
    try {
      const data = await api.compareDrivers(selectedIds, selectedRaceId);
      setResults(data);
      setSearched(true);
    } catch {
      setResults([]);
      setSearched(true);
    }
    setLoading(false);
  };

  const radarData = useMemo(() => {
    if (results.length === 0) return [];
    return DIMENSIONS.map((dim) => {
      const entry: Record<string, string | number> = { dimension: dim };
      results.forEach((d) => {
        entry[d.code] = getDimensionValue(d, dim);
      });
      return entry;
    });
  }, [results]);

  // Group drivers by constructor for the selector
  const driversByConstructor = useMemo(() => {
    const map = new Map<string, Driver[]>();
    drivers.forEach((d) => {
      const existing = map.get(d.constructor_name) || [];
      existing.push(d);
      map.set(d.constructor_name, existing);
    });
    return map;
  }, [drivers]);

  const maxDimensionValue = useMemo(() => {
    if (results.length === 0) return 100;
    let max = 0;
    DIMENSIONS.forEach((dim) => {
      results.forEach((d) => {
        const v = getDimensionValue(d, dim);
        if (v > max) max = v;
      });
    });
    return Math.max(max, 1);
  }, [results]);

  return (
    <div className="space-y-8">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"
      >
        <div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight">
            Head-to-Head
          </h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-1">
            Compare 2-4 drivers across six performance dimensions
          </p>
        </div>
        <RaceSelector
          races={races}
          selectedRaceId={selectedRaceId}
          onSelect={setSelectedRaceId}
        />
      </motion.div>

      {/* Driver Selector */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.05 }}
        className="glass-card rounded-2xl p-5"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-bold uppercase tracking-widest text-gray-500">
            Select Drivers ({selectedIds.length}/{MAX_DRIVERS})
          </h2>
          {selectedIds.length > 0 && (
            <button
              onClick={() => setSelectedIds([])}
              className="text-[10px] uppercase tracking-widest text-gray-500 hover:text-white transition-colors"
            >
              Clear
            </button>
          )}
        </div>

        <div className="space-y-3">
          {Array.from(driversByConstructor.entries()).map(
            ([constructorName, teamDrivers]) => (
              <div key={constructorName}>
                <div
                  className="text-[10px] uppercase tracking-widest font-semibold mb-1.5"
                  style={{ color: teamDrivers[0]?.constructor_color ?? "#6b7280" }}
                >
                  {constructorName}
                </div>
                <div className="flex flex-wrap gap-2">
                  {teamDrivers.map((d) => {
                    const isSelected = selectedIds.includes(d.id);
                    const isDisabled =
                      !isSelected && selectedIds.length >= MAX_DRIVERS;
                    return (
                      <motion.button
                        key={d.id}
                        whileHover={{ scale: isDisabled ? 1 : 1.05 }}
                        whileTap={{ scale: isDisabled ? 1 : 0.95 }}
                        onClick={() => !isDisabled && toggleDriver(d.id)}
                        disabled={isDisabled}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                        style={{
                          background: isSelected
                            ? `${d.constructor_color}25`
                            : "var(--surface)",
                          border: isSelected
                            ? `1.5px solid ${d.constructor_color}`
                            : "1.5px solid var(--card-border)",
                          color: isSelected ? d.constructor_color : "#9ca3af",
                        }}
                      >
                        <div
                          className="w-1.5 h-4 rounded-full"
                          style={{ backgroundColor: d.constructor_color }}
                        />
                        {d.code}
                        <span className="font-mono text-[10px] opacity-60">
                          ${d.price}m
                        </span>
                      </motion.button>
                    );
                  })}
                </div>
              </div>
            )
          )}
        </div>
      </motion.div>

      {/* Compare Button */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1 }}
      >
        <button
          onClick={handleCompare}
          disabled={selectedIds.length < 2 || !selectedRaceId || loading}
          className="px-6 py-2.5 rounded-xl text-xs font-bold text-white transition-all disabled:opacity-30"
          style={{
            background:
              selectedIds.length >= 2 && selectedRaceId
                ? "var(--f1-red)"
                : "var(--card-border)",
          }}
        >
          {loading ? "Comparing..." : "Compare Drivers"}
        </button>
      </motion.div>

      {/* No results message */}
      {searched && results.length === 0 && !loading && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center py-16"
        >
          <div
            className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center"
            style={{ background: "var(--card-border)" }}
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#4b5563"
              strokeWidth="2"
            >
              <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4-4v-2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 00-3-3.87" />
              <path d="M16 3.13a4 4 0 010 7.75" />
            </svg>
          </div>
          <p className="text-sm text-gray-500 font-medium">
            No Comparison Data
          </p>
          <p className="text-xs text-gray-600 mt-1">
            Run a simulation for this race first to compare drivers
          </p>
        </motion.div>
      )}

      {/* Results */}
      <AnimatePresence>
        {results.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-6"
          >
            {/* Radar Chart */}
            <div
              className="glass-card rounded-2xl p-5 relative overflow-hidden"
            >
              <div className="racing-stripe" />
              <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-4">
                Performance Radar
              </h3>
              <div className="w-full" style={{ height: 380 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="75%">
                    <PolarGrid
                      stroke="var(--card-border)"
                      strokeDasharray="3 3"
                    />
                    <PolarAngleAxis
                      dataKey="dimension"
                      tick={{ fill: "#9ca3af", fontSize: 11, fontWeight: 600 }}
                    />
                    {results.map((d, i) => (
                      <Radar
                        key={d.driver_id}
                        name={d.code}
                        dataKey={d.code}
                        stroke={d.constructor_color}
                        fill={d.constructor_color}
                        fillOpacity={0.12 + i * 0.03}
                        strokeWidth={2}
                      />
                    ))}
                    <Legend
                      wrapperStyle={{ fontSize: 12, fontWeight: 700 }}
                    />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {results.map((d) => (
                <motion.div
                  key={d.driver_id}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="glass-card rounded-xl p-4 relative overflow-hidden"
                >
                  <div
                    className="absolute top-0 left-0 w-full h-0.5"
                    style={{ backgroundColor: d.constructor_color }}
                  />
                  <div className="flex items-center gap-2 mb-3">
                    <div
                      className="w-1.5 h-5 rounded-full"
                      style={{ backgroundColor: d.constructor_color }}
                    />
                    <span className="font-black text-sm">{d.code}</span>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500">Expected</span>
                      <span className="font-mono font-bold">
                        {d.expected_pts.toFixed(1)}
                      </span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500">Price</span>
                      <span className="font-mono font-bold">
                        ${d.price.toFixed(1)}m
                      </span>
                    </div>
                    <div className="flex justify-between text-xs items-center">
                      <span className="text-gray-500">Form</span>
                      <FormTrendIndicator trend={d.form_trend} />
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>

            {/* Stat Bars per Dimension */}
            <div
              className="glass-card rounded-2xl p-5"
            >
              <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-5">
                Dimension Breakdown
              </h3>
              <div className="space-y-5">
                {DIMENSIONS.map((dim) => (
                  <div key={dim}>
                    <div className="text-xs font-semibold text-gray-400 mb-2 inline-flex items-center">
                      {dim}<InfoTooltip text={DIMENSION_TOOLTIPS[dim]} />
                    </div>
                    <div className="space-y-1.5">
                      {results.map((d) => {
                        const val = getDimensionValue(d, dim);
                        const pct = Math.max(
                          5,
                          (val / maxDimensionValue) * 100
                        );
                        return (
                          <div
                            key={d.driver_id}
                            className="flex items-center gap-3"
                          >
                            <div
                              className="w-10 text-xs font-bold text-right shrink-0"
                              style={{ color: d.constructor_color }}
                            >
                              {d.code}
                            </div>
                            <div
                              className="flex-1 h-6 rounded-lg overflow-hidden relative"
                              style={{ background: "var(--surface)" }}
                            >
                              <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${pct}%` }}
                                transition={{
                                  duration: 0.6,
                                  ease: "easeOut",
                                }}
                                className="h-full rounded-lg flex items-center px-2"
                                style={{
                                  background: `${d.constructor_color}30`,
                                  borderRight: `2px solid ${d.constructor_color}`,
                                }}
                              >
                                <span className="text-[10px] font-mono font-bold whitespace-nowrap">
                                  {val.toFixed(1)}
                                </span>
                              </motion.div>
                            </div>
                            {dim === "Form" && (
                              <div className="shrink-0">
                                <FormTrendIndicator trend={d.form_trend} />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
