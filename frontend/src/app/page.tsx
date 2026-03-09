"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/lib/api";
import type {
  Driver,
  Constructor,
  Race,
  SimulationResult,
  SimulationMeta,
  TeamResult,
  PricePrediction,
} from "@/types";
import RaceSelector from "@/components/RaceSelector";

type SortKey = "price" | "xPts" | "ppm" | "xDelta" | "name";
type SortDir = "asc" | "desc";

export default function TeamCalculator() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [constructors, setConstructors] = useState<Constructor[]>([]);
  const [races, setRaces] = useState<Race[]>([]);
  const [selectedRaceId, setSelectedRaceId] = useState<number | null>(null);
  const [simResults, setSimResults] = useState<SimulationResult[]>([]);
  const [simMeta, setSimMeta] = useState<SimulationMeta | null>(null);
  const [bestTeams, setBestTeams] = useState<TeamResult[]>([]);
  const [pricePredictions, setPricePredictions] = useState<PricePrediction[]>([]);
  const [loading, setLoading] = useState(false);
  const [simulating, setSimulating] = useState(false);

  const [includeDrivers, setIncludeDrivers] = useState<Set<number>>(new Set());
  const [excludeDrivers, setExcludeDrivers] = useState<Set<number>>(new Set());
  const [includeConstructors, setIncludeConstructors] = useState<Set<number>>(new Set());
  const [excludeConstructors, setExcludeConstructors] = useState<Set<number>>(new Set());

  const [driverSearch, setDriverSearch] = useState("");
  const [constructorSearch, setConstructorSearch] = useState("");

  const [driverSort, setDriverSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "price", dir: "desc" });
  const [constructorSort, setConstructorSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "price", dir: "desc" });

  const [budget, setBudget] = useState(100);
  const [nSimulations, setNSimulations] = useState(10000);
  const [drsDriverId, setDrsDriverId] = useState<number | null>(null);

  const [selectedTeamIdx, setSelectedTeamIdx] = useState(0);

  useEffect(() => {
    Promise.all([api.getDrivers(), api.getConstructors(), api.getRaces()]).then(
      ([d, c, r]) => { setDrivers(d); setConstructors(c); setRaces(r); }
    );
  }, []);

  useEffect(() => {
    if (selectedRaceId) {
      api.getPricePredictions(selectedRaceId).then(setPricePredictions).catch(() => {});
    }
  }, [selectedRaceId]);

  const getSimResult = (assetType: string, assetId: number) =>
    simResults.find((r) => r.asset_type === assetType && r.asset_id === assetId);
  const getDriverPrediction = (driverId: number) =>
    pricePredictions.find((p) => p.asset_type === "driver" && p.asset_id === driverId);
  const getConstructorPrediction = (constructorId: number) =>
    pricePredictions.find((p) => p.asset_type === "constructor" && p.asset_id === constructorId);

  const toggleIncludeDriver = (id: number) => {
    setIncludeDrivers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); setExcludeDrivers((e) => { const n = new Set(e); n.delete(id); return n; }); }
      return next;
    });
  };
  const toggleExcludeDriver = (id: number) => {
    setExcludeDrivers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); setIncludeDrivers((e) => { const n = new Set(e); n.delete(id); return n; }); }
      return next;
    });
  };
  const toggleIncludeConstructor = (id: number) => {
    setIncludeConstructors((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); setExcludeConstructors((e) => { const n = new Set(e); n.delete(id); return n; }); }
      return next;
    });
  };
  const toggleExcludeConstructor = (id: number) => {
    setExcludeConstructors((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); setIncludeConstructors((e) => { const n = new Set(e); n.delete(id); return n; }); }
      return next;
    });
  };

  const handleSimulate = useCallback(async () => {
    if (!selectedRaceId) return;
    setSimulating(true);
    try {
      const { results, meta } = await api.runSimulation(selectedRaceId, nSimulations);
      setSimResults(results);
      setSimMeta(meta);
      const [ud, uc, pp] = await Promise.all([
        api.getDrivers(selectedRaceId),
        api.getConstructors(selectedRaceId),
        api.getPricePredictions(selectedRaceId),
      ]);
      setDrivers(ud); setConstructors(uc); setPricePredictions(pp);
    } finally { setSimulating(false); }
  }, [selectedRaceId, nSimulations]);

  const handleFindBestTeams = useCallback(async () => {
    if (!selectedRaceId) return;
    setLoading(true);
    try {
      const teams = await api.getBestTeams({
        budget,
        race_id: selectedRaceId,
        include_drivers: [...includeDrivers],
        exclude_drivers: [...excludeDrivers],
        include_constructors: [...includeConstructors],
        exclude_constructors: [...excludeConstructors],
        drs_multiplier: 2,
        top_n: 10,
        drs_driver_id: drsDriverId ?? undefined,
      });
      setBestTeams(teams);
      setSelectedTeamIdx(0);
    } finally { setLoading(false); }
  }, [selectedRaceId, budget, includeDrivers, excludeDrivers, includeConstructors, excludeConstructors, drsDriverId]);

  const sortItems = <T extends { price: number; expected_pts: number | null; code?: string; name?: string; id: number }>(
    items: T[], sort: { key: SortKey; dir: SortDir }, assetType: string
  ) => {
    return [...items].sort((a, b) => {
      let va: number, vb: number;
      const simA = getSimResult(assetType, a.id);
      const simB = getSimResult(assetType, b.id);
      switch (sort.key) {
        case "price": va = a.price; vb = b.price; break;
        case "xPts": va = a.expected_pts ?? 0; vb = b.expected_pts ?? 0; break;
        case "ppm": va = simA?.points_per_million ?? 0; vb = simB?.points_per_million ?? 0; break;
        case "xDelta": {
          const predA = assetType === "driver" ? getDriverPrediction(a.id) : getConstructorPrediction(a.id);
          const predB = assetType === "driver" ? getDriverPrediction(b.id) : getConstructorPrediction(b.id);
          va = predA?.predicted_change ?? 0;
          vb = predB?.predicted_change ?? 0;
          break;
        }
        case "name": return sort.dir === "asc"
          ? (a.code ?? a.name ?? "").localeCompare(b.code ?? b.name ?? "")
          : (b.code ?? b.name ?? "").localeCompare(a.code ?? a.name ?? "");
        default: va = 0; vb = 0;
      }
      return sort.dir === "asc" ? va - vb : vb - va;
    });
  };

  const toggleSort = (current: { key: SortKey; dir: SortDir }, key: SortKey): { key: SortKey; dir: SortDir } => {
    if (current.key === key) return { key, dir: current.dir === "desc" ? "asc" : "desc" };
    return { key, dir: "desc" };
  };

  const filteredDrivers = useMemo(() => {
    let filtered = drivers;
    if (driverSearch) {
      const q = driverSearch.toUpperCase();
      filtered = drivers.filter((d) =>
        d.code.toUpperCase().includes(q) ||
        d.first_name.toUpperCase().includes(q) ||
        d.last_name.toUpperCase().includes(q) ||
        d.constructor_name.toUpperCase().includes(q)
      );
    }
    return sortItems(filtered, driverSort, "driver");
  }, [drivers, driverSearch, driverSort, simResults, pricePredictions]);

  const filteredConstructors = useMemo(() => {
    let filtered = constructors;
    if (constructorSearch) {
      const q = constructorSearch.toUpperCase();
      filtered = constructors.filter((c) =>
        c.name.toUpperCase().includes(q) || c.ref_id.toUpperCase().includes(q)
      );
    }
    return sortItems(
      filtered.map((c) => ({ ...c, code: c.name })),
      constructorSort,
      "constructor"
    );
  }, [constructors, constructorSearch, constructorSort, simResults, pricePredictions]);

  const SortHeader = ({ sortState, column, label, setSortFn }: {
    sortState: { key: SortKey; dir: SortDir };
    column: SortKey;
    label: string;
    setSortFn: (s: { key: SortKey; dir: SortDir }) => void;
  }) => (
    <th
      className="px-3 py-3 text-right cursor-pointer hover:text-gray-300 transition-colors select-none group"
      onClick={() => setSortFn(toggleSort(sortState, column))}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <span className="text-[8px] opacity-50 group-hover:opacity-100 transition-opacity">
          {sortState.key === column ? (sortState.dir === "desc" ? "\u25BC" : "\u25B2") : "\u25BC"}
        </span>
      </span>
    </th>
  );

  const hasSimData = drivers.some((d) => d.expected_pts !== null && d.expected_pts !== undefined);
  const activeFilters = includeDrivers.size + excludeDrivers.size + includeConstructors.size + excludeConstructors.size;

  const selectedRace = races.find((r) => r.id === selectedRaceId);

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tight bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
            Team Calculator
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Monte Carlo simulation + brute-force optimization
            {selectedRaceId && races.find((r) => r.id === selectedRaceId)?.has_sprint && (
              <span className="ml-2 px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-400">SPRINT WEEKEND</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
          <RaceSelector races={races} selectedRaceId={selectedRaceId} onSelect={setSelectedRaceId} />
          <button
            onClick={handleSimulate}
            disabled={!selectedRaceId || simulating}
            className="px-5 py-2.5 rounded-xl text-xs font-bold tracking-wide uppercase transition-all disabled:opacity-30 disabled:cursor-not-allowed hover:scale-[1.02] active:scale-[0.98]"
            style={{
              background: selectedRaceId && !simulating
                ? "linear-gradient(135deg, #e10600, #b30500)"
                : "var(--card-border)",
              color: "white",
              boxShadow: selectedRaceId && !simulating ? "0 4px 20px rgba(225,6,0,0.3)" : "none",
            }}
          >
            {simulating ? (
              <span className="flex items-center gap-2">
                <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Simulating...
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                Simulate
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Simulation Meta Bar */}
      <AnimatePresence>
        {simMeta && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="rounded-xl overflow-hidden"
            style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}
          >
            <div className="px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-500 pulse-glow" />
                <span className="text-xs font-semibold text-gray-300">{simMeta.race_name}</span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                {new Date(simMeta.simulated_at).toLocaleTimeString()}
              </div>
              <div className="text-[11px] font-mono text-gray-500">
                {simMeta.n_simulations.toLocaleString()} sims
              </div>
              {simMeta.data_sources.length > 0 && (
                <div className="flex items-center gap-1.5">
                  {simMeta.data_sources.map((src) => (
                    <span key={src} className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                      style={{
                        background: src.includes("qualifying") ? "rgba(168,85,247,0.15)" : "rgba(59,130,246,0.15)",
                        color: src.includes("qualifying") ? "#a855f7" : "#3b82f6",
                        border: `1px solid ${src.includes("qualifying") ? "rgba(168,85,247,0.2)" : "rgba(59,130,246,0.2)"}`,
                      }}>
                      {src}
                    </span>
                  ))}
                </div>
              )}
              {simMeta.has_qualifying && (
                <span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{ background: "rgba(168,85,247,0.15)", color: "#a855f7", border: "1px solid rgba(168,85,247,0.25)" }}>
                  QUALI DATA
                </span>
              )}
              {simMeta.has_long_runs && (
                <span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{ background: "rgba(34,197,94,0.15)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.25)" }}>
                  LONG RUNS
                </span>
              )}
              {simMeta.weather && (
                <div className="flex items-center gap-2 text-[11px] text-gray-400">
                  <span>{simMeta.weather.rainfall ? "🌧" : "☀"}</span>
                  <span>Air {simMeta.weather.air_temp}°C</span>
                  <span>Track {simMeta.weather.track_temp}°C</span>
                  {simMeta.weather.wind_speed > 0 && <span>Wind {simMeta.weather.wind_speed} km/h</span>}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-4 md:gap-6">
        {/* Left Column: Tables */}
        <div className="space-y-6">
          {/* Drivers Table */}
          <div className="rounded-2xl overflow-hidden" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
            <div className="px-4 pt-4 pb-2 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-bold uppercase tracking-widest text-gray-400">Drivers</h2>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-mono" style={{ background: "var(--card-border)", color: "#6b7280" }}>
                  {filteredDrivers.length}
                </span>
              </div>
              <div className="relative">
                <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-600" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                <input
                  type="text"
                  value={driverSearch}
                  onChange={(e) => setDriverSearch(e.target.value)}
                  placeholder="Search drivers..."
                  className="text-xs pl-7 pr-3 py-1.5 rounded-lg bg-transparent focus:outline-none focus:ring-1 focus:ring-red-900/50 placeholder-gray-600 w-40"
                  style={{ border: "1px solid var(--card-border)" }}
                />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] uppercase tracking-wider font-semibold text-gray-600">
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--card-border)" }}>
                    <th className="px-4 py-3 text-left cursor-pointer hover:text-gray-300 transition-colors" onClick={() => setDriverSort(toggleSort(driverSort, "name"))}>
                      <span className="inline-flex items-center gap-1">
                        Driver
                        <span className="text-[8px] opacity-50">{driverSort.key === "name" ? (driverSort.dir === "desc" ? "\u25BC" : "\u25B2") : ""}</span>
                      </span>
                    </th>
                    <SortHeader sortState={driverSort} column="price" label="Price" setSortFn={setDriverSort} />
                    <SortHeader sortState={driverSort} column="xPts" label="xPts" setSortFn={setDriverSort} />
                    <SortHeader sortState={driverSort} column="ppm" label="PPM" setSortFn={setDriverSort} />
                    <SortHeader sortState={driverSort} column="xDelta" label="x&Delta;$" setSortFn={setDriverSort} />
                    <th className="px-3 py-3 text-center w-24">Lock</th>
                    {hasSimData && <th className="px-3 py-3 text-center w-10" title="DRS Boost">DRS</th>}
                  </tr>
                </thead>
                <tbody className="text-sm normal-case tracking-normal font-normal">
                  {filteredDrivers.map((driver) => {
                    const prediction = getDriverPrediction(driver.id);
                    const sim = getSimResult("driver", driver.id);
                    const xDelta = prediction?.predicted_change ?? null;
                    const isIncluded = includeDrivers.has(driver.id);
                    const isExcluded = excludeDrivers.has(driver.id);
                    const isDrsSelected = drsDriverId === driver.id;

                    return (
                      <tr
                        key={driver.id}
                        className="transition-colors hover:bg-white/[0.02] group"
                        style={{
                          borderBottom: "1px solid var(--card-border)",
                          opacity: isExcluded ? 0.35 : 1,
                        }}
                      >
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-3">
                            <div className="w-1 h-8 rounded-full flex-shrink-0" style={{ backgroundColor: driver.constructor_color }} />
                            <div className="min-w-0">
                              <div className="font-semibold text-sm text-white truncate">
                                {driver.first_name} <span className="uppercase font-bold">{driver.last_name}</span>
                              </div>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <span className="text-[10px] font-mono text-gray-500">{driver.code}</span>
                                <span className="text-[10px] text-gray-700">#{driver.number}</span>
                                <span className="text-[10px] text-gray-700">&middot;</span>
                                <span className="text-[10px] text-gray-600">{driver.constructor_name}</span>
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <span className="font-mono text-sm font-medium text-gray-200">${driver.price.toFixed(1)}M</span>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {driver.expected_pts != null ? (
                            <div>
                              <span className="font-mono text-sm font-semibold text-emerald-400">{driver.expected_pts.toFixed(1)}</span>
                              {sim && (
                                <div className="text-[9px] font-mono text-gray-600 mt-0.5">
                                  {sim.expected_pts_p10.toFixed(0)}-{sim.expected_pts_p90.toFixed(0)}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="font-mono text-sm text-gray-700">&mdash;</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {sim && sim.points_per_million > 0 ? (
                            <span className="font-mono text-[11px] text-amber-400">{sim.points_per_million.toFixed(2)}</span>
                          ) : (
                            <span className="font-mono text-sm text-gray-700">&mdash;</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-sm">
                          {xDelta !== null ? (
                            <span className={xDelta > 0 ? "text-emerald-400" : xDelta < 0 ? "text-red-400" : "text-gray-600"}>
                              {xDelta > 0 ? "+" : ""}{xDelta.toFixed(2)}
                            </span>
                          ) : (
                            <span className="text-gray-700">&mdash;</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => toggleIncludeDriver(driver.id)}
                              className="w-6 h-6 rounded-md flex items-center justify-center transition-all hover:scale-110"
                              style={{
                                background: isIncluded ? "rgba(34,197,94,0.15)" : "transparent",
                                border: `1.5px solid ${isIncluded ? "#22c55e" : "var(--card-border)"}`,
                              }}
                              title="Force include"
                            >
                              {isIncluded && (
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                              )}
                            </button>
                            <button
                              onClick={() => toggleExcludeDriver(driver.id)}
                              className="w-6 h-6 rounded-md flex items-center justify-center transition-all hover:scale-110"
                              style={{
                                background: isExcluded ? "rgba(239,68,68,0.15)" : "transparent",
                                border: `1.5px solid ${isExcluded ? "#ef4444" : "var(--card-border)"}`,
                              }}
                              title="Force exclude"
                            >
                              {isExcluded && (
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                              )}
                            </button>
                          </div>
                        </td>
                        {hasSimData && (
                          <td className="px-3 py-2.5 text-center">
                            <button
                              onClick={() => setDrsDriverId(isDrsSelected ? null : driver.id)}
                              className="w-6 h-6 rounded-md flex items-center justify-center transition-all hover:scale-110 mx-auto"
                              style={{
                                background: isDrsSelected ? "rgba(168,85,247,0.2)" : "transparent",
                                border: `1.5px solid ${isDrsSelected ? "#a855f7" : "var(--card-border)"}`,
                              }}
                              title="Lock as DRS booster (2x points)"
                            >
                              {isDrsSelected && (
                                <span className="text-[8px] font-black text-purple-400">D</span>
                              )}
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Constructors Table */}
          <div className="rounded-2xl overflow-hidden" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
            <div className="px-4 pt-4 pb-2 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-bold uppercase tracking-widest text-gray-400">Constructors</h2>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-mono" style={{ background: "var(--card-border)", color: "#6b7280" }}>
                  {filteredConstructors.length}
                </span>
              </div>
              <div className="relative">
                <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-600" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                <input
                  type="text"
                  value={constructorSearch}
                  onChange={(e) => setConstructorSearch(e.target.value)}
                  placeholder="Search teams..."
                  className="text-xs pl-7 pr-3 py-1.5 rounded-lg bg-transparent focus:outline-none focus:ring-1 focus:ring-red-900/50 placeholder-gray-600 w-40"
                  style={{ border: "1px solid var(--card-border)" }}
                />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] uppercase tracking-wider font-semibold text-gray-600">
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--card-border)" }}>
                    <th className="px-4 py-3 text-left cursor-pointer hover:text-gray-300 transition-colors" onClick={() => setConstructorSort(toggleSort(constructorSort, "name"))}>
                      <span className="inline-flex items-center gap-1">
                        Constructor
                        <span className="text-[8px] opacity-50">{constructorSort.key === "name" ? (constructorSort.dir === "desc" ? "\u25BC" : "\u25B2") : ""}</span>
                      </span>
                    </th>
                    <SortHeader sortState={constructorSort} column="price" label="Price" setSortFn={setConstructorSort} />
                    <SortHeader sortState={constructorSort} column="xPts" label="xPts" setSortFn={setConstructorSort} />
                    <SortHeader sortState={constructorSort} column="ppm" label="PPM" setSortFn={setConstructorSort} />
                    <SortHeader sortState={constructorSort} column="xDelta" label="x&Delta;$" setSortFn={setConstructorSort} />
                    <th className="px-3 py-3 text-center w-24">Lock</th>
                  </tr>
                </thead>
                <tbody className="text-sm normal-case tracking-normal font-normal">
                  {filteredConstructors.map((c) => {
                    const prediction = getConstructorPrediction(c.id);
                    const sim = getSimResult("constructor", c.id);
                    const xDelta = prediction?.predicted_change ?? null;
                    const isIncluded = includeConstructors.has(c.id);
                    const isExcluded = excludeConstructors.has(c.id);
                    return (
                      <tr
                        key={c.id}
                        className="transition-colors hover:bg-white/[0.02]"
                        style={{
                          borderBottom: "1px solid var(--card-border)",
                          opacity: isExcluded ? 0.35 : 1,
                        }}
                      >
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-3">
                            <div className="w-1 h-8 rounded-full flex-shrink-0" style={{ backgroundColor: c.color }} />
                            <div>
                              <span className="font-semibold text-sm text-white">{c.name}</span>
                              <div className="flex items-center gap-1 mt-0.5">
                                {c.driver_codes.map((code, i) => (
                                  <span key={code} className="text-[10px] font-mono text-gray-500">
                                    {code}{i < c.driver_codes.length - 1 ? <span className="text-gray-700 mx-0.5">/</span> : ""}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <span className="font-mono text-sm font-medium text-gray-200">${c.price.toFixed(1)}M</span>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {c.expected_pts != null ? (
                            <div>
                              <span className="font-mono text-sm font-semibold text-emerald-400">{c.expected_pts.toFixed(1)}</span>
                              {sim && (
                                <div className="text-[9px] font-mono text-gray-600 mt-0.5">
                                  {sim.expected_pts_p10.toFixed(0)}-{sim.expected_pts_p90.toFixed(0)}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="font-mono text-sm text-gray-700">&mdash;</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {sim && sim.points_per_million > 0 ? (
                            <span className="font-mono text-[11px] text-amber-400">{sim.points_per_million.toFixed(2)}</span>
                          ) : (
                            <span className="font-mono text-sm text-gray-700">&mdash;</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-sm">
                          {xDelta !== null ? (
                            <span className={xDelta > 0 ? "text-emerald-400" : xDelta < 0 ? "text-red-400" : "text-gray-600"}>
                              {xDelta > 0 ? "+" : ""}{xDelta.toFixed(2)}
                            </span>
                          ) : (
                            <span className="text-gray-700">&mdash;</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => toggleIncludeConstructor(c.id)}
                              className="w-6 h-6 rounded-md flex items-center justify-center transition-all hover:scale-110"
                              style={{
                                background: isIncluded ? "rgba(34,197,94,0.15)" : "transparent",
                                border: `1.5px solid ${isIncluded ? "#22c55e" : "var(--card-border)"}`,
                              }}
                              title="Force include"
                            >
                              {isIncluded && (
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                              )}
                            </button>
                            <button
                              onClick={() => toggleExcludeConstructor(c.id)}
                              className="w-6 h-6 rounded-md flex items-center justify-center transition-all hover:scale-110"
                              style={{
                                background: isExcluded ? "rgba(239,68,68,0.15)" : "transparent",
                                border: `1.5px solid ${isExcluded ? "#ef4444" : "var(--card-border)"}`,
                              }}
                              title="Force exclude"
                            >
                              {isExcluded && (
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right Sidebar — Optimizer Panel */}
        <div className="space-y-4">
          <div className="rounded-2xl overflow-hidden sticky top-8" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
            {/* Optimizer Header */}
            <div className="px-5 pt-5 pb-3">
              <h3 className="text-sm font-bold uppercase tracking-widest text-gray-400 flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20V10M18 20V4M6 20v-4"/></svg>
                Optimizer
              </h3>
            </div>

            {/* Budget Slider */}
            <div className="px-5 pb-3">
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-[10px] uppercase tracking-widest text-gray-600 font-semibold">Budget Cap</label>
                <span className="text-sm font-mono font-bold text-white">${budget}M</span>
              </div>
              <input
                type="range"
                min={70}
                max={120}
                step={0.5}
                value={budget}
                onChange={(e) => setBudget(Number(e.target.value))}
                className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-red-600"
                style={{ background: `linear-gradient(to right, #e10600 ${((budget - 70) / 50) * 100}%, #1e1e2e ${((budget - 70) / 50) * 100}%)` }}
              />
              <div className="flex justify-between text-[9px] text-gray-700 mt-0.5">
                <span>$70M</span>
                <span>$120M</span>
              </div>
            </div>

            {/* Simulation Count */}
            <div className="px-5 pb-3">
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-[10px] uppercase tracking-widest text-gray-600 font-semibold">Simulations</label>
                <span className="text-sm font-mono font-bold text-white">{(nSimulations / 1000).toFixed(0)}K</span>
              </div>
              <input
                type="range"
                min={1000}
                max={50000}
                step={1000}
                value={nSimulations}
                onChange={(e) => setNSimulations(Number(e.target.value))}
                className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-red-600"
                style={{ background: `linear-gradient(to right, #e10600 ${((nSimulations - 1000) / 49000) * 100}%, #1e1e2e ${((nSimulations - 1000) / 49000) * 100}%)` }}
              />
              <div className="flex justify-between text-[9px] text-gray-700 mt-0.5">
                <span>1K (fast)</span>
                <span>50K (precise)</span>
              </div>
            </div>

            {/* DRS Driver Lock */}
            {hasSimData && (
              <div className="px-5 pb-3">
                <label className="text-[10px] uppercase tracking-widest text-gray-600 font-semibold block mb-1.5">DRS Booster</label>
                <select
                  value={drsDriverId ?? ""}
                  onChange={(e) => setDrsDriverId(e.target.value ? Number(e.target.value) : null)}
                  className="w-full text-xs px-3 py-2 rounded-lg bg-transparent focus:outline-none focus:ring-1 focus:ring-purple-900/50 cursor-pointer"
                  style={{ border: "1px solid var(--card-border)", color: drsDriverId ? "#a855f7" : "#6b7280" }}
                >
                  <option value="">Auto (highest xPts)</option>
                  {drivers
                    .filter((d) => d.expected_pts != null)
                    .sort((a, b) => (b.expected_pts ?? 0) - (a.expected_pts ?? 0))
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.code} - {d.first_name} {d.last_name} ({d.expected_pts?.toFixed(1)} xPts)
                      </option>
                    ))}
                </select>
              </div>
            )}

            {/* Active Filters */}
            {activeFilters > 0 && (
              <div className="mx-5 mb-3 p-3 rounded-xl space-y-2" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--card-border)" }}>
                {(includeDrivers.size > 0 || includeConstructors.size > 0) && (
                  <div className="flex flex-wrap gap-1 items-center">
                    <span className="text-[10px] text-emerald-500 font-bold uppercase tracking-wider mr-1">IN</span>
                    {[...includeDrivers].map((id) => {
                      const d = drivers.find((dr) => dr.id === id);
                      return d ? (
                        <span key={id} className="text-[10px] px-1.5 py-0.5 rounded font-mono font-medium" style={{ background: "rgba(34,197,94,0.1)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.2)" }}>
                          {d.code}
                        </span>
                      ) : null;
                    })}
                    {[...includeConstructors].map((id) => {
                      const c = constructors.find((co) => co.id === id);
                      return c ? (
                        <span key={id} className="text-[10px] px-1.5 py-0.5 rounded font-mono font-medium" style={{ background: "rgba(34,197,94,0.1)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.2)" }}>
                          {c.name}
                        </span>
                      ) : null;
                    })}
                  </div>
                )}
                {(excludeDrivers.size > 0 || excludeConstructors.size > 0) && (
                  <div className="flex flex-wrap gap-1 items-center">
                    <span className="text-[10px] text-red-400 font-bold uppercase tracking-wider mr-1">OUT</span>
                    {[...excludeDrivers].map((id) => {
                      const d = drivers.find((dr) => dr.id === id);
                      return d ? (
                        <span key={id} className="text-[10px] px-1.5 py-0.5 rounded font-mono font-medium" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)" }}>
                          {d.code}
                        </span>
                      ) : null;
                    })}
                    {[...excludeConstructors].map((id) => {
                      const c = constructors.find((co) => co.id === id);
                      return c ? (
                        <span key={id} className="text-[10px] px-1.5 py-0.5 rounded font-mono font-medium" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)" }}>
                          {c.name}
                        </span>
                      ) : null;
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Find Best Teams Button */}
            <div className="px-5 pb-5">
              <button
                onClick={handleFindBestTeams}
                disabled={!selectedRaceId || !hasSimData || loading}
                className="w-full py-3.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all disabled:opacity-30 disabled:cursor-not-allowed hover:scale-[1.01] active:scale-[0.99]"
                style={{
                  background: hasSimData
                    ? "linear-gradient(135deg, #e10600, #b30500)"
                    : "var(--card-border)",
                  color: "white",
                  boxShadow: hasSimData ? "0 4px 20px rgba(225,6,0,0.3)" : "none",
                }}
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Optimizing...
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-2">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/></svg>
                    Find Best Teams
                  </span>
                )}
              </button>
              {!hasSimData && (
                <p className="text-[10px] text-gray-600 text-center mt-2">Run simulation first</p>
              )}
            </div>

            {/* Top Performers Summary */}
            {simResults.length > 0 && (
              <div className="px-5 pb-5 pt-2" style={{ borderTop: "1px solid var(--card-border)" }}>
                <h4 className="text-[10px] uppercase tracking-widest text-gray-600 font-semibold mb-3">Top Performers</h4>
                <div className="space-y-0.5">
                  {simResults
                    .filter((r) => r.asset_type === "driver")
                    .sort((a, b) => b.expected_pts_mean - a.expected_pts_mean)
                    .slice(0, 5)
                    .map((r, i) => {
                      const driver = drivers.find((d) => d.id === r.asset_id);
                      return (
                        <div key={`d-${r.asset_id}`} className="flex justify-between items-center text-xs py-1.5 px-2 rounded-lg hover:bg-white/[0.02] transition-colors">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-gray-600 font-mono w-4">{i + 1}.</span>
                            {driver && <div className="w-1 h-4 rounded-full" style={{ backgroundColor: driver.constructor_color }} />}
                            <span className="text-gray-300 font-medium">{r.asset_name}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="font-mono text-emerald-400 font-semibold">{r.expected_pts_mean.toFixed(1)}</span>
                            <span className="font-mono text-[10px] text-amber-400/70">{r.points_per_million.toFixed(2)}/M</span>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Best Teams Results */}
      <AnimatePresence>
        {bestTeams.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-4"
          >
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-bold uppercase tracking-widest text-gray-400">Optimal Teams</h2>
              <div className="flex-1 h-px" style={{ background: "var(--card-border)" }} />
              <span className="text-[10px] text-gray-600 font-mono">Top {bestTeams.length}</span>
            </div>

            {/* Team Selector Tabs */}
            <div className="flex gap-1 overflow-x-auto pb-1">
              {bestTeams.map((_, idx) => (
                <button
                  key={idx}
                  onClick={() => setSelectedTeamIdx(idx)}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex-shrink-0"
                  style={{
                    background: selectedTeamIdx === idx
                      ? idx === 0 ? "var(--f1-red)" : "var(--card-border)"
                      : "transparent",
                    color: selectedTeamIdx === idx ? "white" : "#6b7280",
                    border: `1px solid ${selectedTeamIdx === idx ? (idx === 0 ? "var(--f1-red)" : "var(--card-border)") : "transparent"}`,
                  }}
                >
                  #{idx + 1}
                </button>
              ))}
            </div>

            {/* Selected Team Detail */}
            {bestTeams[selectedTeamIdx] && (() => {
              const team = bestTeams[selectedTeamIdx];
              return (
                <motion.div
                  key={selectedTeamIdx}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-2xl overflow-hidden relative"
                  style={{ background: "var(--card-bg)", border: `1px solid ${selectedTeamIdx === 0 ? "rgba(225,6,0,0.3)" : "var(--card-border)"}` }}
                >
                  {selectedTeamIdx === 0 && <div className="absolute top-0 left-0 w-full h-[2px]" style={{ background: "linear-gradient(to right, #e10600, transparent)" }} />}

                  {/* Team Summary Bar */}
                  <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid var(--card-border)" }}>
                    <div className="flex items-center gap-4">
                      <span
                        className="w-9 h-9 rounded-xl flex items-center justify-center text-sm font-black"
                        style={{
                          background: selectedTeamIdx === 0 ? "linear-gradient(135deg, #e10600, #b30500)" : "var(--card-border)",
                          color: "white",
                          boxShadow: selectedTeamIdx === 0 ? "0 2px 12px rgba(225,6,0,0.3)" : "none",
                        }}
                      >
                        {selectedTeamIdx + 1}
                      </span>
                      <div>
                        <span className="text-2xl font-black font-mono text-emerald-400">
                          {team.total_points.toFixed(1)}
                        </span>
                        <span className="text-xs text-gray-500 ml-1.5">expected points</span>
                      </div>
                    </div>
                    <div className="flex gap-6 text-xs font-mono">
                      <div className="text-right">
                        <div className="text-gray-500 text-[10px] uppercase tracking-wider">Cost</div>
                        <div className="text-gray-300 font-semibold">${team.total_cost.toFixed(1)}M</div>
                      </div>
                      <div className="text-right">
                        <div className="text-gray-500 text-[10px] uppercase tracking-wider">Remaining</div>
                        <div className="text-emerald-400 font-semibold">${team.budget_remaining.toFixed(1)}M</div>
                      </div>
                    </div>
                  </div>

                  {/* Team Grid */}
                  <div className="p-5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {team.drivers.map((d) => {
                        const isDrs = team.drs_driver.id === d.id;
                        return (
                          <div
                            key={d.id}
                            className="rounded-xl p-3.5 relative overflow-hidden transition-all hover:scale-[1.02]"
                            style={{
                              background: `linear-gradient(135deg, ${d.constructor_color}08, ${d.constructor_color}03)`,
                              border: `1px solid ${d.constructor_color}25`,
                            }}
                          >
                            <div className="absolute top-0 left-0 w-full h-[2px]" style={{ background: d.constructor_color }} />
                            {isDrs && (
                              <div className="absolute top-2.5 right-2.5">
                                <span className="text-[9px] font-black px-1.5 py-0.5 rounded-md" style={{ background: "rgba(168,85,247,0.2)", color: "#a855f7", border: "1px solid rgba(168,85,247,0.3)" }}>
                                  DRS 2x
                                </span>
                              </div>
                            )}
                            <div className="flex items-center gap-2 mb-2">
                              <div className="w-1 h-6 rounded-full" style={{ backgroundColor: d.constructor_color }} />
                              <div>
                                <div className="text-xs font-bold text-white">{d.first_name} <span className="uppercase">{d.last_name}</span></div>
                                <div className="text-[10px] text-gray-500">{d.constructor_name}</div>
                              </div>
                            </div>
                            <div className="flex items-center justify-between mt-2">
                              <span className="font-mono text-xs text-gray-400">${d.price.toFixed(1)}M</span>
                              {d.expected_pts != null && (
                                <span className="font-mono text-sm font-bold text-emerald-400">
                                  {isDrs ? (d.expected_pts * 2).toFixed(1) : d.expected_pts.toFixed(1)}
                                  <span className="text-[9px] text-gray-600 ml-0.5">pts</span>
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                      {team.constructors.map((c) => (
                        <div
                          key={c.id}
                          className="rounded-xl p-3.5 relative overflow-hidden transition-all hover:scale-[1.02]"
                          style={{
                            background: `linear-gradient(135deg, ${c.color}08, ${c.color}03)`,
                            border: `1px solid ${c.color}25`,
                          }}
                        >
                          <div className="absolute top-0 left-0 w-full h-[2px]" style={{ background: c.color }} />
                          <div className="flex items-center gap-2 mb-2">
                            <div className="w-1 h-6 rounded-full" style={{ backgroundColor: c.color }} />
                            <div>
                              <div className="text-xs font-bold text-white">{c.name}</div>
                              <div className="text-[10px] text-gray-500">{c.driver_codes.join(" / ")}</div>
                            </div>
                          </div>
                          <div className="flex items-center justify-between mt-2">
                            <span className="font-mono text-xs text-gray-400">${c.price.toFixed(1)}M</span>
                            {c.expected_pts != null && (
                              <span className="font-mono text-sm font-bold text-emerald-400">
                                {c.expected_pts.toFixed(1)}
                                <span className="text-[9px] text-gray-600 ml-0.5">pts</span>
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              );
            })()}

            {/* Compact list of other teams */}
            <div className="space-y-2">
              {bestTeams.map((team, idx) => {
                if (idx === selectedTeamIdx) return null;
                return (
                  <button
                    key={idx}
                    onClick={() => setSelectedTeamIdx(idx)}
                    className="w-full rounded-xl p-3 flex items-center justify-between transition-all hover:bg-white/[0.02]"
                    style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-bold" style={{ background: "var(--card-border)", color: "#6b7280" }}>
                        {idx + 1}
                      </span>
                      <div className="flex gap-1.5">
                        {team.drivers.map((d) => (
                          <span key={d.id} className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: `${d.constructor_color}15`, color: d.constructor_color, border: `1px solid ${d.constructor_color}25` }}>
                            {d.code}{team.drs_driver.id === d.id ? "*" : ""}
                          </span>
                        ))}
                        {team.constructors.map((c) => (
                          <span key={c.id} className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: `${c.color}15`, color: c.color, border: `1px solid ${c.color}25` }}>
                            {c.ref_id}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-xs font-mono">
                      <span className="text-emerald-400 font-bold">{team.total_points.toFixed(1)}</span>
                      <span className="text-gray-600">${team.total_cost.toFixed(1)}M</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
