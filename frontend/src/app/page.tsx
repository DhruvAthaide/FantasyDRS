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
import InfoTooltip from "@/components/InfoTooltip";

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
  const [nSimulations, setNSimulations] = useState(50000);
  const [drsDriverId, setDrsDriverId] = useState<number | null>(null);

  const [selectedTeamIdx, setSelectedTeamIdx] = useState(0);
  const [cachedStatus, setCachedStatus] = useState<string | null>(null);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [driverTrends, setDriverTrends] = useState<Record<number, string>>({});

  // Togglable column visibility
  const [showDriverCols, setShowDriverCols] = useState({ price: true, xDelta: true, xPts: true, ppm: false });
  const [showConsCols, setShowConsCols] = useState({ price: true, xDelta: true, xPts: true, ppm: false });
  const [driverColMenu, setDriverColMenu] = useState(false);
  const [consColMenu, setConsColMenu] = useState(false);
  const [expandedTeamIdx, setExpandedTeamIdx] = useState<number | null>(null);
  const [showBestCols, setShowBestCols] = useState({ cost: true, xDelta: true, xPts: true });
  const [bestColMenu, setBestColMenu] = useState(false);

  useEffect(() => {
    Promise.all([api.getDrivers(), api.getConstructors(), api.getRaces(), api.getNextRace()]).then(
      ([d, c, r, nextRace]) => {
        setDrivers(d); setConstructors(c); setRaces(r);
        if (nextRace && nextRace.id) {
          setSelectedRaceId(nextRace.id);
        }
      }
    ).catch(() => {});
    api.getDriverTrends().then(setDriverTrends).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedRaceId) return;
    api.getPricePredictions(selectedRaceId).then(setPricePredictions).catch(() => {});
    api.getCachedSimulation(selectedRaceId).then((data) => {
      if (data.status === "ok" && data.results && data.results.length > 0) {
        setSimResults(data.results);
        setCachedStatus("cached");
        setCachedAt(data.simulated_at);
        setSimMeta({
          race_id: data.race_id,
          race_name: data.race_name,
          n_simulations: 50000,
          data_sources: data.data_sources || [],
          has_qualifying: data.has_qualifying || false,
          has_long_runs: data.has_long_runs || false,
          weather: data.weather || null,
          simulated_at: data.simulated_at || "",
        });
        Promise.all([
          api.getDrivers(selectedRaceId),
          api.getConstructors(selectedRaceId),
        ]).then(([ud, uc]) => {
          setDrivers(ud);
          setConstructors(uc);
        }).catch(() => {});
      } else {
        setCachedStatus(null);
      }
    }).catch(() => {});
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
      await Promise.all([
        api.getDrivers(selectedRaceId),
        api.getConstructors(selectedRaceId),
        api.getPricePredictions(selectedRaceId),
      ]).then(([ud, uc, pp]) => {
        setDrivers(ud); setConstructors(uc); setPricePredictions(pp);
      }).catch(() => {});
    } catch {
      // Simulation failed — keep any existing results visible
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
    } catch { setBestTeams([]); } finally { setLoading(false); }
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

  const SortHeader = ({ sortState, column, label, setSortFn, tooltip }: {
    sortState: { key: SortKey; dir: SortDir };
    column: SortKey;
    label: string;
    setSortFn: (s: { key: SortKey; dir: SortDir }) => void;
    tooltip?: string;
  }) => (
    <th
      className="px-2 py-2 text-right cursor-pointer hover:text-gray-300 transition-colors select-none group whitespace-nowrap"
      onClick={() => setSortFn(toggleSort(sortState, column))}
    >
      <span className="inline-flex items-center gap-0.5">
        {label}
        {tooltip && <InfoTooltip text={tooltip} />}
        <span className="text-[7px] opacity-50 group-hover:opacity-100">
          {sortState.key === column ? (sortState.dir === "desc" ? "\u25BC" : "\u25B2") : "\u25BC"}
        </span>
      </span>
    </th>
  );

  const hasSimData = drivers.some((d) => d.expected_pts !== null && d.expected_pts !== undefined);
  const activeFilters = includeDrivers.size + excludeDrivers.size + includeConstructors.size + excludeConstructors.size;
  const selectedRace = races.find((r) => r.id === selectedRaceId);

  // Column toggle dropdown component
  const ColumnMenu = ({ show, cols, setCols, onClose }: {
    show: boolean;
    cols: Record<string, boolean>;
    setCols: (c: Record<string, boolean>) => void;
    onClose: () => void;
  }) => {
    if (!show) return null;
    const labels: Record<string, string> = { price: "$", xDelta: "x\u0394$", xPts: "xPts", ppm: "PPM", cost: "$", };
    return (
      <>
        <div className="fixed inset-0 z-40" onClick={onClose} />
        <div className="absolute right-0 top-full mt-1 z-50 rounded-lg p-2 min-w-[120px]" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
          {Object.entries(cols).map(([key, val]) => (
            <label key={key} className="flex items-center gap-2 px-2 py-1.5 text-xs text-gray-300 cursor-pointer hover:bg-white/5 rounded">
              <input type="checkbox" checked={val} onChange={() => setCols({ ...cols, [key]: !val })} className="rounded accent-red-600" />
              {labels[key] || key}
            </label>
          ))}
        </div>
      </>
    );
  };

  return (
    <div className="space-y-4">
      {/* Header Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
            Team Calculator
          </h1>
          <p className="text-[10px] text-gray-500 mt-0.5">
            Monte Carlo simulation + brute-force optimization
            {selectedRaceId && races.find((r) => r.id === selectedRaceId)?.has_sprint && (
              <span className="ml-2 px-1.5 py-0.5 rounded text-[9px] font-bold" style={{ background: "rgba(255,208,0,0.15)", color: "var(--timing-yellow)", border: "1px solid rgba(255,208,0,0.3)" }}>SPRINT</span>
            )}
            {cachedStatus === "cached" && cachedAt && (
              <span className="ml-2 text-[10px] font-mono" style={{ color: "var(--neon-cyan)" }}>
                Cached {(() => { const mins = Math.round((Date.now() - new Date(cachedAt).getTime()) / 60000); return mins < 1 ? "just now" : `${mins}min ago`; })()}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
          <RaceSelector races={races} selectedRaceId={selectedRaceId} onSelect={setSelectedRaceId} />
        </div>
      </div>

      {/* Sim Meta Bar */}
      <AnimatePresence>
        {simMeta && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="rounded-xl overflow-hidden glass-card">
            <div className="px-3 py-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 pulse-glow" />
                <span className="text-[11px] font-semibold text-gray-300">{simMeta.race_name}</span>
              </div>
              <div className="text-[10px] font-mono text-gray-500">{simMeta.n_simulations.toLocaleString()} sims</div>
              {simMeta.data_sources.length > 0 && simMeta.data_sources.map((src) => (
                <span key={src} className="text-[9px] px-1.5 py-0.5 rounded-full font-medium"
                  style={{ background: src.includes("qualifying") ? "rgba(168,85,247,0.15)" : "rgba(59,130,246,0.15)", color: src.includes("qualifying") ? "#a855f7" : "#3b82f6" }}>
                  {src}
                </span>
              ))}
              {simMeta.has_qualifying && <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: "rgba(168,85,247,0.15)", color: "#a855f7" }}>QUALI</span>}
              {simMeta.has_long_runs && <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: "rgba(34,197,94,0.15)", color: "#22c55e" }}>LONG RUNS</span>}
              {simMeta.weather && (
                <span className="text-[10px] text-gray-400">
                  {simMeta.weather.rainfall ? "Rain" : "Dry"} {simMeta.weather.air_temp}°C
                </span>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ========= 3-COLUMN LAYOUT ========= */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] xl:grid-cols-[minmax(320px,1.2fr)_300px_minmax(280px,1fr)] gap-4">

        {/* ===== LEFT: Best Teams ===== */}
        <div className="rounded-2xl glass-card order-2 xl:order-1 flex flex-col" style={{ maxHeight: "calc(100vh - 140px)" }}>
          <div className="px-4 pt-3 pb-2 shrink-0">
            <h2 className="text-sm font-bold uppercase tracking-widest text-gray-400">Best Teams</h2>
          </div>

          <div className="overflow-y-auto min-h-0 flex-1 px-2 pb-2">
            {bestTeams.length === 0 ? (
              <div className="py-12 text-center">
                <div className="text-gray-600 text-xs">
                  {hasSimData ? "Click \"Find Best Teams\" to optimize" : "Run simulation first, then optimize"}
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {(() => {
                  // Ensure team colors are visible on dark backgrounds
                  const safeColor = (hex: string) => {
                    if (!hex || hex.length < 7) return "#9CA3AF";
                    const r = parseInt(hex.slice(1, 3), 16);
                    const g = parseInt(hex.slice(3, 5), 16);
                    const b = parseInt(hex.slice(5, 7), 16);
                    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
                    return brightness < 40 ? "#9CA3AF" : hex;
                  };

                  return bestTeams.map((team, idx) => {
                    const drsDriver = team.drs_driver;
                    const otherDrivers = team.drivers.filter((d) => d.id !== drsDriver.id);
                    const teamXDelta = [...team.drivers, ...team.constructors].reduce((sum, a) => {
                      const pred = "code" in a ? getDriverPrediction(a.id) : getConstructorPrediction(a.id);
                      return sum + (pred?.predicted_change ?? 0);
                    }, 0);
                    const isExpanded = expandedTeamIdx === idx;
                    const isSelected = selectedTeamIdx === idx;

                    return (
                      <div
                        key={idx}
                        className={`rounded-xl p-3 transition-all cursor-pointer ${isSelected ? "ring-1 ring-emerald-500/30 bg-emerald-500/[0.04]" : "hover:bg-white/[0.03]"}`}
                        style={{ background: isSelected ? undefined : "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}
                        onClick={() => { setSelectedTeamIdx(idx); setExpandedTeamIdx(isExpanded ? null : idx); }}
                      >
                        {/* Header */}
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-mono font-bold text-gray-500 bg-white/5 rounded px-1.5 py-0.5">#{idx + 1}</span>
                            <span className="text-sm font-mono font-bold text-emerald-400">{team.total_points.toFixed(1)}<span className="text-[10px] text-emerald-400/60 ml-0.5">pts</span></span>
                          </div>
                          <div className="flex items-center gap-2 text-[10px] font-mono">
                            <span className="text-gray-500">${team.total_cost.toFixed(1)}M</span>
                            {teamXDelta !== 0 && (
                              <span className={teamXDelta > 0 ? "text-emerald-400" : "text-red-400"}>
                                {teamXDelta > 0 ? "+" : ""}{teamXDelta.toFixed(1)}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Constructors: 2-col grid — always fits */}
                        <div className="grid grid-cols-2 gap-1.5 mb-2">
                          {team.constructors.map((c) => {
                            const cc = safeColor(c.color);
                            return (
                              <div key={c.id} className="flex items-center gap-1.5 rounded-lg px-2 py-1" style={{ background: `${cc}10`, borderLeft: `3px solid ${cc}` }}>
                                <span className="text-[10px] font-bold" style={{ color: cc }}>{c.ref_id.slice(0, 3).toUpperCase()}</span>
                                <span className="text-[9px] font-mono text-gray-400 ml-auto">{c.expected_pts?.toFixed(1) ?? "—"}</span>
                              </div>
                            );
                          })}
                        </div>

                        {/* Drivers: row 1 = 3 drivers, row 2 = 2 drivers */}
                        <div className="grid grid-cols-3 gap-1 mb-1">
                          {(() => {
                            const dc = safeColor(drsDriver.constructor_color);
                            return (
                              <div className="flex flex-col items-center rounded-lg py-1 relative" style={{ background: `${dc}12`, border: `1px solid ${dc}30` }}>
                                <div className="absolute -top-1.5 -right-0.5 bg-yellow-500 text-black text-[6px] font-black px-1 rounded">DRS</div>
                                <span className="text-[10px] font-bold" style={{ color: dc }}>{drsDriver.code}</span>
                                <span className="text-[8px] font-mono text-gray-400">{drsDriver.expected_pts != null ? (drsDriver.expected_pts * 2).toFixed(1) : "—"}</span>
                              </div>
                            );
                          })()}
                          {otherDrivers.slice(0, 2).map((d) => {
                            const dc = safeColor(d.constructor_color);
                            return (
                              <div key={d.id} className="flex flex-col items-center rounded-lg py-1" style={{ background: `${dc}08`, border: `1px solid ${dc}20` }}>
                                <span className="text-[10px] font-bold" style={{ color: dc }}>{d.code}</span>
                                <span className="text-[8px] font-mono text-gray-400">{d.expected_pts?.toFixed(1) ?? "—"}</span>
                              </div>
                            );
                          })}
                        </div>
                        <div className="grid grid-cols-3 gap-1">
                          {otherDrivers.slice(2).map((d) => {
                            const dc = safeColor(d.constructor_color);
                            return (
                              <div key={d.id} className="flex flex-col items-center rounded-lg py-1" style={{ background: `${dc}08`, border: `1px solid ${dc}20` }}>
                                <span className="text-[10px] font-bold" style={{ color: dc }}>{d.code}</span>
                                <span className="text-[8px] font-mono text-gray-400">{d.expected_pts?.toFixed(1) ?? "—"}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            )}
          </div>
        </div>

        {/* ===== MIDDLE: Settings ===== */}
        <div className="rounded-2xl overflow-hidden glass-card order-1 xl:order-2 xl:sticky xl:top-4 xl:self-start">
          <div className="px-4 pt-4 pb-2">
            <h2 className="text-sm font-bold uppercase tracking-widest text-gray-400">Settings</h2>
          </div>

          {/* Simulation Controls */}
          <div className="px-4 pb-3 space-y-3">
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-[10px] uppercase tracking-widest text-gray-600 font-semibold">Budget Cap</label>
                <div className="flex items-center gap-1">
                  <span className="text-sm font-mono font-bold text-white">$</span>
                  <input
                    type="number"
                    value={budget}
                    onChange={(e) => setBudget(Number(e.target.value) || 100)}
                    className="w-14 text-sm font-mono font-bold text-white bg-transparent text-right focus:outline-none"
                    step={0.1}
                    min={70}
                    max={120}
                  />
                  <span className="text-xs text-gray-500">M</span>
                </div>
              </div>
              <input
                type="range" min={70} max={120} step={0.5} value={budget}
                onChange={(e) => setBudget(Number(e.target.value))}
                className="w-full h-1 rounded-full appearance-none cursor-pointer accent-red-600"
                style={{ background: `linear-gradient(to right, #e10600 ${((budget - 70) / 50) * 100}%, #1e1e2e ${((budget - 70) / 50) * 100}%)` }}
              />
            </div>

            {/* Simulations count */}
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-[10px] uppercase tracking-widest text-gray-600 font-semibold">Simulations</label>
                <span className="text-xs font-mono font-bold text-white">{(nSimulations / 1000).toFixed(0)}K</span>
              </div>
              <input
                type="range" min={1000} max={50000} step={1000} value={nSimulations}
                onChange={(e) => setNSimulations(Number(e.target.value))}
                className="w-full h-1 rounded-full appearance-none cursor-pointer accent-red-600"
                style={{ background: `linear-gradient(to right, #e10600 ${((nSimulations - 1000) / 49000) * 100}%, #1e1e2e ${((nSimulations - 1000) / 49000) * 100}%)` }}
              />
            </div>

            {/* DRS Booster */}
            {hasSimData && (
              <div>
                <label className="text-[10px] uppercase tracking-widest text-gray-600 font-semibold block mb-1">DRS Booster</label>
                <select
                  value={drsDriverId ?? ""}
                  onChange={(e) => setDrsDriverId(e.target.value ? Number(e.target.value) : null)}
                  className="w-full text-[11px] px-2.5 py-1.5 rounded-lg bg-transparent focus:outline-none cursor-pointer"
                  style={{ border: "1px solid var(--card-border)", color: drsDriverId ? "#a855f7" : "#6b7280" }}
                >
                  <option value="">Auto (highest xPts)</option>
                  {drivers.filter((d) => d.expected_pts != null).sort((a, b) => (b.expected_pts ?? 0) - (a.expected_pts ?? 0)).map((d) => (
                    <option key={d.id} value={d.id}>{d.code} — {d.expected_pts?.toFixed(1)} xPts</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Active Filters */}
          {activeFilters > 0 && (
            <div className="mx-4 mb-3 p-2.5 rounded-lg space-y-1.5" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--card-border)" }}>
              {(includeDrivers.size > 0 || includeConstructors.size > 0) && (
                <div className="flex flex-wrap gap-1 items-center">
                  <span className="text-[9px] text-emerald-500 font-bold uppercase mr-1">IN</span>
                  {[...includeDrivers].map((id) => { const d = drivers.find((dr) => dr.id === id); return d ? <span key={id} className="text-[9px] px-1.5 py-0.5 rounded font-mono" style={{ background: "rgba(34,197,94,0.1)", color: "#22c55e" }}>{d.code}</span> : null; })}
                  {[...includeConstructors].map((id) => { const c = constructors.find((co) => co.id === id); return c ? <span key={id} className="text-[9px] px-1.5 py-0.5 rounded font-mono" style={{ background: "rgba(34,197,94,0.1)", color: "#22c55e" }}>{c.name}</span> : null; })}
                </div>
              )}
              {(excludeDrivers.size > 0 || excludeConstructors.size > 0) && (
                <div className="flex flex-wrap gap-1 items-center">
                  <span className="text-[9px] text-red-400 font-bold uppercase mr-1">OUT</span>
                  {[...excludeDrivers].map((id) => { const d = drivers.find((dr) => dr.id === id); return d ? <span key={id} className="text-[9px] px-1.5 py-0.5 rounded font-mono" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}>{d.code}</span> : null; })}
                  {[...excludeConstructors].map((id) => { const c = constructors.find((co) => co.id === id); return c ? <span key={id} className="text-[9px] px-1.5 py-0.5 rounded font-mono" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}>{c.name}</span> : null; })}
                </div>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div className="px-4 pb-4 space-y-2">
            <button
              onClick={handleSimulate}
              disabled={!selectedRaceId || simulating}
              className="w-full py-2.5 rounded-xl text-[11px] font-bold uppercase tracking-wider transition-all disabled:opacity-30 disabled:cursor-not-allowed hover:scale-[1.01] active:scale-[0.99]"
              style={{
                background: cachedStatus === "cached" ? "transparent" : selectedRaceId && !simulating ? "linear-gradient(135deg, #e10600, #b30500)" : "var(--card-border)",
                color: "white",
                border: cachedStatus === "cached" ? "1px solid var(--card-border)" : "none",
                boxShadow: cachedStatus !== "cached" && selectedRaceId && !simulating ? "0 4px 20px rgba(225,6,0,0.3)" : "none",
              }}
            >
              {simulating ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Simulating...
                </span>
              ) : (
                <span className="flex items-center justify-center gap-1.5">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                  {cachedStatus === "cached" ? "Re-run Sim" : "Simulate"}
                </span>
              )}
            </button>

            <button
              onClick={handleFindBestTeams}
              disabled={!selectedRaceId || !hasSimData || loading}
              className="w-full py-2.5 rounded-xl text-[11px] font-bold uppercase tracking-wider transition-all disabled:opacity-30 disabled:cursor-not-allowed hover:scale-[1.01] active:scale-[0.99]"
              style={{
                background: hasSimData ? "linear-gradient(135deg, #e10600, #b30500)" : "var(--card-border)",
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
                <span className="flex items-center justify-center gap-1.5">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
                  Find Best Teams
                </span>
              )}
            </button>
            {!hasSimData && <p className="text-[9px] text-gray-600 text-center">Run simulation first</p>}

            <button
              onClick={() => {
                setIncludeDrivers(new Set()); setExcludeDrivers(new Set());
                setIncludeConstructors(new Set()); setExcludeConstructors(new Set());
                setDrsDriverId(null); setBudget(100); setBestTeams([]);
              }}
              className="w-full py-1.5 rounded-lg text-[10px] text-gray-500 hover:text-gray-300 transition-colors flex items-center justify-center gap-1.5"
              style={{ border: "1px solid var(--card-border)" }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>
              Full Reset
            </button>
          </div>

          {/* Simulation Notes */}
          {simMeta && (
            <div className="px-4 pb-4 pt-2" style={{ borderTop: "1px solid var(--card-border)" }}>
              <h4 className="text-[10px] uppercase tracking-widest text-gray-600 font-semibold mb-2">Notes</h4>
              <p className="text-[10px] text-gray-500 leading-relaxed">
                {simMeta.data_sources.length > 0
                  ? `Using ${simMeta.data_sources.join(", ")} data for enhanced accuracy.`
                  : "Dry/average conditions. A somewhat reasonable placeholder for now; equal-PPM and form are not super useful."}
              </p>
            </div>
          )}
        </div>

        {/* ===== RIGHT: Drivers + Constructors ===== */}
        <div className="space-y-4 order-3">
          {/* Drivers Table */}
          <div className="rounded-2xl overflow-hidden glass-card">
            <div className="px-3 pt-3 pb-1.5 flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-widest text-gray-400">Drivers</h2>
              <div className="flex items-center gap-1.5">
                <div className="relative">
                  <svg className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-600" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                  <input type="text" value={driverSearch} onChange={(e) => setDriverSearch(e.target.value)} placeholder="e.g. VER+NOR" className="text-[10px] pl-6 pr-2 py-1 rounded-md bg-transparent focus:outline-none placeholder-gray-600 w-28" style={{ border: "1px solid var(--card-border)" }} />
                </div>
                <div className="relative">
                  <button onClick={() => setDriverColMenu(!driverColMenu)} className="text-[10px] px-2 py-1 rounded-md hover:bg-white/5 text-gray-500 flex items-center gap-1" style={{ border: "1px solid var(--card-border)" }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7m0-18H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7m0-18v18"/></svg>
                    Columns
                  </button>
                  <ColumnMenu show={driverColMenu} cols={showDriverCols} setCols={(c) => setShowDriverCols(c as typeof showDriverCols)} onClose={() => setDriverColMenu(false)} />
                </div>
              </div>
            </div>
            <div className="overflow-x-auto" style={{ maxHeight: "45vh" }}>
              <table className="w-full text-[10px] uppercase tracking-wider font-semibold text-gray-600">
                <thead className="sticky top-0 z-10" style={{ background: "var(--card-bg)" }}>
                  <tr style={{ borderBottom: "1px solid var(--card-border)" }}>
                    <th className="px-3 py-2 text-left cursor-pointer hover:text-gray-300" onClick={() => setDriverSort(toggleSort(driverSort, "name"))}>
                      <span className="inline-flex items-center gap-0.5">DR <span className="text-[7px] opacity-50">{driverSort.key === "name" ? (driverSort.dir === "desc" ? "\u25BC" : "\u25B2") : ""}</span></span>
                    </th>
                    {showDriverCols.price && <SortHeader sortState={driverSort} column="price" label="$" setSortFn={setDriverSort} />}
                    {showDriverCols.xDelta && <SortHeader sortState={driverSort} column="xDelta" label="x&Delta;$" setSortFn={setDriverSort} tooltip="Predicted Price Change" />}
                    {showDriverCols.xPts && <SortHeader sortState={driverSort} column="xPts" label="xPts" setSortFn={setDriverSort} tooltip="Expected Points from simulation" />}
                    {showDriverCols.ppm && <SortHeader sortState={driverSort} column="ppm" label="PPM" setSortFn={setDriverSort} tooltip="Points Per Million" />}
                    <th className="px-1 py-2 text-center w-14">
                      <span className="text-[9px]">Incl</span>
                    </th>
                    <th className="px-1 py-2 text-center w-10">
                      <span className="text-[9px]">Excl</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="text-xs normal-case tracking-normal font-normal">
                  {filteredDrivers.map((driver) => {
                    const prediction = getDriverPrediction(driver.id);
                    const sim = getSimResult("driver", driver.id);
                    const xDelta = prediction?.predicted_change ?? null;
                    const isIncluded = includeDrivers.has(driver.id);
                    const isExcluded = excludeDrivers.has(driver.id);

                    return (
                      <tr key={driver.id} className="transition-colors hover:bg-white/[0.02]" style={{ borderBottom: "1px solid var(--card-border)", opacity: isExcluded ? 0.35 : 1 }}>
                        <td className="px-3 py-1.5">
                          <div className="flex items-center gap-2">
                            <span className="w-7 h-5 rounded text-[9px] font-bold flex items-center justify-center flex-shrink-0" style={{ background: `${driver.constructor_color}25`, color: driver.constructor_color, border: `1px solid ${driver.constructor_color}30` }}>
                              {driver.code}
                            </span>
                            <span className="text-[10px] text-gray-500 truncate hidden sm:inline">{driver.last_name}</span>
                            {driverTrends[driver.id] === "improving" && <span className="text-[8px]" style={{ color: "var(--neon-green)" }}>&#9650;</span>}
                            {driverTrends[driver.id] === "declining" && <span className="text-[8px]" style={{ color: "var(--f1-red)" }}>&#9660;</span>}
                          </div>
                        </td>
                        {showDriverCols.price && (
                          <td className="px-2 py-1.5 text-right font-mono text-gray-300">{driver.price.toFixed(1)}</td>
                        )}
                        {showDriverCols.xDelta && (
                          <td className="px-2 py-1.5 text-right font-mono">
                            {xDelta !== null ? (
                              <span className={xDelta > 0 ? "text-emerald-400" : xDelta < 0 ? "text-red-400" : "text-gray-600"}>
                                {xDelta > 0 ? "+" : ""}{xDelta.toFixed(2)}
                              </span>
                            ) : <span className="text-gray-700">—</span>}
                          </td>
                        )}
                        {showDriverCols.xPts && (
                          <td className="px-2 py-1.5 text-right">
                            {driver.expected_pts != null ? (
                              <span className="font-mono font-semibold text-emerald-400">{driver.expected_pts.toFixed(1)}</span>
                            ) : <span className="font-mono text-gray-700">—</span>}
                          </td>
                        )}
                        {showDriverCols.ppm && (
                          <td className="px-2 py-1.5 text-right">
                            {sim && sim.points_per_million > 0 ? (
                              <span className="font-mono text-[10px] text-amber-400">{sim.points_per_million.toFixed(2)}</span>
                            ) : <span className="font-mono text-gray-700">—</span>}
                          </td>
                        )}
                        <td className="px-1 py-1.5 text-center">
                          <button onClick={() => toggleIncludeDriver(driver.id)} className="w-5 h-5 rounded flex items-center justify-center transition-all hover:scale-110 mx-auto" style={{ background: isIncluded ? "rgba(34,197,94,0.15)" : "transparent", border: `1.5px solid ${isIncluded ? "#22c55e" : "var(--card-border)"}` }}>
                            {isIncluded && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>}
                          </button>
                        </td>
                        <td className="px-1 py-1.5 text-center">
                          <button onClick={() => toggleExcludeDriver(driver.id)} className="w-5 h-5 rounded flex items-center justify-center transition-all hover:scale-110 mx-auto" style={{ background: isExcluded ? "rgba(239,68,68,0.15)" : "transparent", border: `1.5px solid ${isExcluded ? "#ef4444" : "var(--card-border)"}` }}>
                            {isExcluded && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Constructors Table */}
          <div className="rounded-2xl overflow-hidden glass-card">
            <div className="px-3 pt-3 pb-1.5 flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-widest text-gray-400">Constructors</h2>
              <div className="flex items-center gap-1.5">
                <div className="relative">
                  <svg className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-600" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                  <input type="text" value={constructorSearch} onChange={(e) => setConstructorSearch(e.target.value)} placeholder="e.g. RED+MCL" className="text-[10px] pl-6 pr-2 py-1 rounded-md bg-transparent focus:outline-none placeholder-gray-600 w-28" style={{ border: "1px solid var(--card-border)" }} />
                </div>
                <div className="relative">
                  <button onClick={() => setConsColMenu(!consColMenu)} className="text-[10px] px-2 py-1 rounded-md hover:bg-white/5 text-gray-500 flex items-center gap-1" style={{ border: "1px solid var(--card-border)" }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7m0-18H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7m0-18v18"/></svg>
                    Columns
                  </button>
                  <ColumnMenu show={consColMenu} cols={showConsCols} setCols={(c) => setShowConsCols(c as typeof showConsCols)} onClose={() => setConsColMenu(false)} />
                </div>
              </div>
            </div>
            <div className="overflow-x-auto" style={{ maxHeight: "35vh" }}>
              <table className="w-full text-[10px] uppercase tracking-wider font-semibold text-gray-600">
                <thead className="sticky top-0 z-10" style={{ background: "var(--card-bg)" }}>
                  <tr style={{ borderBottom: "1px solid var(--card-border)" }}>
                    <th className="px-3 py-2 text-left cursor-pointer hover:text-gray-300" onClick={() => setConstructorSort(toggleSort(constructorSort, "name"))}>
                      <span className="inline-flex items-center gap-0.5">CR <span className="text-[7px] opacity-50">{constructorSort.key === "name" ? (constructorSort.dir === "desc" ? "\u25BC" : "\u25B2") : ""}</span></span>
                    </th>
                    {showConsCols.price && <SortHeader sortState={constructorSort} column="price" label="$" setSortFn={setConstructorSort} />}
                    {showConsCols.xDelta && <SortHeader sortState={constructorSort} column="xDelta" label="x&Delta;$" setSortFn={setConstructorSort} tooltip="Predicted Price Change" />}
                    {showConsCols.xPts && <SortHeader sortState={constructorSort} column="xPts" label="xPts" setSortFn={setConstructorSort} tooltip="Expected Points from simulation" />}
                    {showConsCols.ppm && <SortHeader sortState={constructorSort} column="ppm" label="PPM" setSortFn={setConstructorSort} tooltip="Points Per Million" />}
                    <th className="px-1 py-2 text-center w-14"><span className="text-[9px]">Incl</span></th>
                    <th className="px-1 py-2 text-center w-10"><span className="text-[9px]">Excl</span></th>
                  </tr>
                </thead>
                <tbody className="text-xs normal-case tracking-normal font-normal">
                  {filteredConstructors.map((c) => {
                    const prediction = getConstructorPrediction(c.id);
                    const sim = getSimResult("constructor", c.id);
                    const xDelta = prediction?.predicted_change ?? null;
                    const isIncluded = includeConstructors.has(c.id);
                    const isExcluded = excludeConstructors.has(c.id);
                    return (
                      <tr key={c.id} className="transition-colors hover:bg-white/[0.02]" style={{ borderBottom: "1px solid var(--card-border)", opacity: isExcluded ? 0.35 : 1 }}>
                        <td className="px-3 py-1.5">
                          <div className="flex items-center gap-2">
                            <span className="w-7 h-5 rounded text-[9px] font-bold flex items-center justify-center flex-shrink-0" style={{ background: `${c.color}25`, color: c.color, border: `1px solid ${c.color}30` }}>
                              {c.ref_id.slice(0, 3).toUpperCase()}
                            </span>
                          </div>
                        </td>
                        {showConsCols.price && <td className="px-2 py-1.5 text-right font-mono text-gray-300">{c.price.toFixed(1)}</td>}
                        {showConsCols.xDelta && (
                          <td className="px-2 py-1.5 text-right font-mono">
                            {xDelta !== null ? (
                              <span className={xDelta > 0 ? "text-emerald-400" : xDelta < 0 ? "text-red-400" : "text-gray-600"}>{xDelta > 0 ? "+" : ""}{xDelta.toFixed(2)}</span>
                            ) : <span className="text-gray-700">—</span>}
                          </td>
                        )}
                        {showConsCols.xPts && (
                          <td className="px-2 py-1.5 text-right">
                            {c.expected_pts != null ? (
                              <span className="font-mono font-semibold text-emerald-400">{c.expected_pts.toFixed(1)}</span>
                            ) : <span className="font-mono text-gray-700">—</span>}
                          </td>
                        )}
                        {showConsCols.ppm && (
                          <td className="px-2 py-1.5 text-right">
                            {sim && sim.points_per_million > 0 ? (
                              <span className="font-mono text-[10px] text-amber-400">{sim.points_per_million.toFixed(2)}</span>
                            ) : <span className="font-mono text-gray-700">—</span>}
                          </td>
                        )}
                        <td className="px-1 py-1.5 text-center">
                          <button onClick={() => toggleIncludeConstructor(c.id)} className="w-5 h-5 rounded flex items-center justify-center transition-all hover:scale-110 mx-auto" style={{ background: isIncluded ? "rgba(34,197,94,0.15)" : "transparent", border: `1.5px solid ${isIncluded ? "#22c55e" : "var(--card-border)"}` }}>
                            {isIncluded && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>}
                          </button>
                        </td>
                        <td className="px-1 py-1.5 text-center">
                          <button onClick={() => toggleExcludeConstructor(c.id)} className="w-5 h-5 rounded flex items-center justify-center transition-all hover:scale-110 mx-auto" style={{ background: isExcluded ? "rgba(239,68,68,0.15)" : "transparent", border: `1.5px solid ${isExcluded ? "#ef4444" : "var(--card-border)"}` }}>
                            {isExcluded && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
