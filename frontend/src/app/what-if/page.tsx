"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { api } from "@/lib/api";
import { getMyTeam } from "@/lib/storage";
import type { SavedTeam } from "@/lib/storage";
import type { Race, Driver, Constructor } from "@/types";
import RaceSelector from "@/components/RaceSelector";

interface WhatIfResult {
  original_total: number;
  modified_total: number;
  differential: number;
  original_breakdown: { asset_type: string; asset_id: number; name: string; color: string; base_pts: number; multiplier: number; scored_pts: number }[];
  modified_breakdown: { asset_type: string; asset_id: number; name: string; color: string; base_pts: number; multiplier: number; scored_pts: number }[];
  swaps: { type: string; out: { name: string; color: string; scored_pts: number }; in: { name: string; color: string; scored_pts: number }; diff: number }[];
  drs_changed: boolean;
  drs_diff: number;
}

export default function WhatIfPage() {
  const [races, setRaces] = useState<Race[]>([]);
  const [selectedRaceId, setSelectedRaceId] = useState<number | null>(null);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [constructors, setConstructors] = useState<Constructor[]>([]);
  const [hasTeam, setHasTeam] = useState(false);
  const [myTeam, setMyTeam] = useState<SavedTeam | null>(null);

  // Modified team state
  const [modDrivers, setModDrivers] = useState<number[]>([]);
  const [modConstructors, setModConstructors] = useState<number[]>([]);
  const [modDrs, setModDrs] = useState<number>(0);

  const [result, setResult] = useState<WhatIfResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const team = getMyTeam();
    setMyTeam(team);
    setHasTeam(!!team);
    if (team) {
      setModDrivers([...team.driver_ids]);
      setModConstructors([...team.constructor_ids]);
      setModDrs(team.drs_driver_id);
    }
    Promise.all([api.getRaces(), api.getDrivers(), api.getConstructors()]).then(([r, d, c]) => {
      setRaces(r);
      setDrivers(d);
      setConstructors(c);
    });
  }, []);

  const toggleDriver = (id: number) => {
    setModDrivers((prev) => {
      if (prev.includes(id)) {
        if (modDrs === id) setModDrs(prev.filter((x) => x !== id)[0] || 0);
        return prev.filter((x) => x !== id);
      }
      if (prev.length >= 5) return prev;
      return [...prev, id];
    });
    setResult(null);
  };

  const toggleConstructor = (id: number) => {
    setModConstructors((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return prev;
      return [...prev, id];
    });
    setResult(null);
  };

  const handleCompare = async () => {
    if (!myTeam || !selectedRaceId || modDrivers.length !== 5 || modConstructors.length !== 2 || !modDrs) return;
    setLoading(true);
    try {
      const data = await api.whatIf({
        race_id: selectedRaceId,
        original_driver_ids: myTeam.driver_ids,
        original_constructor_ids: myTeam.constructor_ids,
        original_drs_driver_id: myTeam.drs_driver_id,
        modified_driver_ids: modDrivers,
        modified_constructor_ids: modConstructors,
        modified_drs_driver_id: modDrs,
      });
      setResult(data);
    } catch { /* */ }
    setLoading(false);
  };

  return (
    <div className="space-y-8">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight">What If</h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-1">Compare alternative team picks vs your actual team</p>
        </div>
        <RaceSelector races={races} selectedRaceId={selectedRaceId} onSelect={setSelectedRaceId} />
      </motion.div>

      {!hasTeam && (
        <div className="text-center py-16">
          <p className="text-sm text-gray-500 font-medium">No Team Saved</p>
          <p className="text-xs text-gray-600 mt-1">Save your team in My Team first</p>
        </div>
      )}

      {hasTeam && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
          {/* Modified Team Builder */}
          <div className="rounded-2xl p-5" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
            <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3">
              Alternative Team ({modDrivers.length}/5 drivers, {modConstructors.length}/2 constructors)
            </h3>

            {/* Drivers */}
            <div className="mb-3">
              <p className="text-[10px] text-gray-500 mb-1.5">Drivers</p>
              <div className="flex flex-wrap gap-1.5">
                {drivers.map((d) => {
                  const sel = modDrivers.includes(d.id);
                  const isOrig = myTeam?.driver_ids.includes(d.id);
                  return (
                    <button key={d.id} onClick={() => toggleDriver(d.id)}
                      className="px-2 py-1 rounded-lg text-[10px] font-bold transition-all"
                      style={sel
                        ? { background: `${d.constructor_color}30`, border: `1px solid ${d.constructor_color}`, color: d.constructor_color }
                        : { background: "var(--surface)", border: "1px solid var(--card-border)", color: "#6b7280" }
                      }
                    >
                      {d.code}
                      {sel && !isOrig && <span className="ml-0.5 text-emerald-400">+</span>}
                      {!sel && isOrig && <span className="ml-0.5 text-red-400">-</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* DRS */}
            {modDrivers.length > 0 && (
              <div className="mb-3">
                <p className="text-[10px] text-gray-500 mb-1.5">DRS Captain</p>
                <div className="flex flex-wrap gap-1.5">
                  {modDrivers.map((did) => {
                    const d = drivers.find((dr) => dr.id === did);
                    return (
                      <button key={did} onClick={() => { setModDrs(did); setResult(null); }}
                        className="px-2 py-1 rounded text-[9px] font-bold"
                        style={modDrs === did ? { background: "var(--f1-red)", color: "white" } : { background: "var(--card-border)", color: "#9ca3af" }}
                      >
                        {d?.code}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Constructors */}
            <div className="mb-4">
              <p className="text-[10px] text-gray-500 mb-1.5">Constructors</p>
              <div className="flex flex-wrap gap-1.5">
                {constructors.map((c) => {
                  const sel = modConstructors.includes(c.id);
                  const isOrig = myTeam?.constructor_ids.includes(c.id);
                  return (
                    <button key={c.id} onClick={() => toggleConstructor(c.id)}
                      className="px-2 py-1 rounded-lg text-[10px] font-bold transition-all"
                      style={sel
                        ? { background: `${c.color}30`, border: `1px solid ${c.color}`, color: c.color }
                        : { background: "var(--surface)", border: "1px solid var(--card-border)", color: "#6b7280" }
                      }
                    >
                      {c.name}
                      {sel && !isOrig && <span className="ml-0.5 text-emerald-400">+</span>}
                      {!sel && isOrig && <span className="ml-0.5 text-red-400">-</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            <button onClick={handleCompare}
              disabled={!selectedRaceId || loading || modDrivers.length !== 5 || modConstructors.length !== 2 || !modDrs}
              className="px-5 py-2.5 rounded-xl text-xs font-bold text-white transition-all disabled:opacity-30"
              style={{ background: "var(--f1-red)" }}
            >
              {loading ? "Comparing..." : "Compare Teams"}
            </button>
          </div>

          {/* Results */}
          {result && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
              {/* Differential */}
              <div className="rounded-2xl p-5 text-center"
                style={{
                  background: result.differential > 0 ? "rgba(34,197,94,0.06)" : result.differential < 0 ? "rgba(239,68,68,0.06)" : "var(--card-bg)",
                  border: result.differential > 0 ? "1px solid rgba(34,197,94,0.25)" : result.differential < 0 ? "1px solid rgba(239,68,68,0.25)" : "1px solid var(--card-border)",
                }}
              >
                <div className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-1">
                  {result.differential > 0 ? "Alternative team scores more" : result.differential < 0 ? "Your team scores more" : "Teams are equal"}
                </div>
                <div className={`text-3xl font-black font-mono ${result.differential > 0 ? "text-emerald-400" : result.differential < 0 ? "text-red-400" : "text-gray-500"}`}>
                  {result.differential > 0 ? "+" : ""}{result.differential.toFixed(1)} pts
                </div>
                <div className="flex justify-center gap-6 mt-2 text-xs text-gray-400">
                  <span>Your Team: <span className="font-mono text-white">{result.original_total.toFixed(1)}</span></span>
                  <span>Alt Team: <span className="font-mono text-white">{result.modified_total.toFixed(1)}</span></span>
                </div>
              </div>

              {/* Swaps Impact */}
              {result.swaps.length > 0 && (
                <div className="rounded-2xl p-5" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
                  <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3">Swap Impact</h3>
                  <div className="space-y-2">
                    {result.swaps.map((s, i) => (
                      <div key={i} className="flex items-center gap-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold" style={{ background: "rgba(239,68,68,0.15)", color: "#ef4444" }}>OUT</span>
                          <div className="w-1.5 h-4 rounded-full" style={{ backgroundColor: s.out.color }} />
                          <span className="text-sm font-semibold">{s.out.name}</span>
                          <span className="text-[10px] font-mono text-gray-500">{s.out.scored_pts.toFixed(1)}</span>
                        </div>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4b5563" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
                        <div className="flex items-center gap-1.5">
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold" style={{ background: "rgba(34,197,94,0.15)", color: "#22c55e" }}>IN</span>
                          <div className="w-1.5 h-4 rounded-full" style={{ backgroundColor: s.in.color }} />
                          <span className="text-sm font-semibold">{s.in.name}</span>
                          <span className="text-[10px] font-mono text-gray-500">{s.in.scored_pts.toFixed(1)}</span>
                        </div>
                        <span className={`ml-auto text-sm font-mono font-bold ${s.diff > 0 ? "text-emerald-400" : s.diff < 0 ? "text-red-400" : "text-gray-500"}`}>
                          {s.diff > 0 ? "+" : ""}{s.diff.toFixed(1)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Side by Side */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[
                  { label: "Your Team", breakdown: result.original_breakdown, total: result.original_total },
                  { label: "Alternative Team", breakdown: result.modified_breakdown, total: result.modified_total },
                ].map((side) => (
                  <div key={side.label} className="rounded-xl p-4" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
                    <div className="flex justify-between items-center mb-3">
                      <h4 className="text-xs font-bold uppercase tracking-widest text-gray-500">{side.label}</h4>
                      <span className="text-sm font-mono font-bold">{side.total.toFixed(1)}</span>
                    </div>
                    <div className="space-y-1.5">
                      {side.breakdown.map((b) => (
                        <div key={`${b.asset_type}-${b.asset_id}`} className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <div className="w-1.5 h-3 rounded-full" style={{ backgroundColor: b.color }} />
                            <span className="text-xs font-semibold">{b.name}</span>
                            {b.multiplier === 2 && <span className="text-[8px] font-bold px-1 rounded" style={{ background: "var(--f1-red)", color: "white" }}>2x</span>}
                          </div>
                          <span className="text-xs font-mono text-gray-400">{b.scored_pts.toFixed(1)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </motion.div>
      )}
    </div>
  );
}
