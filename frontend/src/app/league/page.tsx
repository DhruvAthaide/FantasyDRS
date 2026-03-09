"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { api } from "@/lib/api";
import { getMyTeam, getRivals, saveRivals, type SavedRival } from "@/lib/storage";
import type { Driver, Constructor, Race, LeagueSimResult } from "@/types";
import RaceSelector from "@/components/RaceSelector";

export default function LeaguePage() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [constructors, setConstructors] = useState<Constructor[]>([]);
  const [races, setRaces] = useState<Race[]>([]);
  const [selectedRaceId, setSelectedRaceId] = useState<number | null>(null);
  const [rivals, setRivals] = useState<SavedRival[]>([]);
  const [results, setResults] = useState<LeagueSimResult[]>([]);
  const [simulating, setSimulating] = useState(false);
  const [hasTeam, setHasTeam] = useState(false);

  // Rival editing state
  const [editingRival, setEditingRival] = useState<number | null>(null);
  const [rivalName, setRivalName] = useState("");
  const [rivalDrivers, setRivalDrivers] = useState<number[]>([]);
  const [rivalConstructors, setRivalConstructors] = useState<number[]>([]);
  const [rivalDrs, setRivalDrs] = useState<number | null>(null);

  useEffect(() => {
    Promise.all([api.getDrivers(), api.getConstructors(), api.getRaces()]).then(([d, c, r]) => {
      setDrivers(d);
      setConstructors(c);
      setRaces(r);
      setHasTeam(!!getMyTeam());
      setRivals(getRivals());
    });
  }, []);

  const startAddRival = () => {
    setEditingRival(-1); // -1 = new
    setRivalName(`Rival ${rivals.length + 1}`);
    setRivalDrivers([]);
    setRivalConstructors([]);
    setRivalDrs(null);
  };

  const saveCurrentRival = () => {
    if (rivalDrivers.length !== 5 || rivalConstructors.length !== 2 || !rivalDrs) return;
    const rival: SavedRival = { name: rivalName, driver_ids: rivalDrivers, constructor_ids: rivalConstructors, drs_driver_id: rivalDrs };
    const updated = editingRival === -1 ? [...rivals, rival] : rivals.map((r, i) => i === editingRival ? rival : r);
    setRivals(updated);
    saveRivals(updated);
    setEditingRival(null);
  };

  const removeRival = (idx: number) => {
    const updated = rivals.filter((_, i) => i !== idx);
    setRivals(updated);
    saveRivals(updated);
  };

  const toggleRivalDriver = (id: number) => {
    setRivalDrivers((prev) => {
      if (prev.includes(id)) {
        if (rivalDrs === id) setRivalDrs(null);
        return prev.filter((x) => x !== id);
      }
      if (prev.length >= 5) return prev;
      return [...prev, id];
    });
  };

  const toggleRivalConstructor = (id: number) => {
    setRivalConstructors((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return prev;
      return [...prev, id];
    });
  };

  const handleSimulate = async () => {
    const myTeam = getMyTeam();
    if (!myTeam || !selectedRaceId || rivals.length === 0) return;
    setSimulating(true);
    try {
      const data = await api.simulateLeague({
        my_team: { name: "My Team", driver_ids: myTeam.driver_ids, constructor_ids: myTeam.constructor_ids, drs_driver_id: myTeam.drs_driver_id },
        rivals: rivals.map((r) => ({ name: r.name, driver_ids: r.driver_ids, constructor_ids: r.constructor_ids, drs_driver_id: r.drs_driver_id })),
        race_id: selectedRaceId,
      });
      setResults(data);
    } catch { /* sim may not exist */ }
    setSimulating(false);
  };

  return (
    <div className="space-y-8">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight">Mini League</h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-1">Simulate head-to-head matchups against rival teams</p>
          <p className="text-[10px] text-gray-600 mt-0.5">Rival teams are saved in this browser only — manually enter your friends&apos; teams</p>
        </div>
        <RaceSelector races={races} selectedRaceId={selectedRaceId} onSelect={setSelectedRaceId} />
      </motion.div>

      {!hasTeam && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-16">
          <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ background: "var(--card-border)" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#4b5563" strokeWidth="2">
              <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5C7 4 6 9 6 9z" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5C17 4 18 9 18 9z" />
              <path d="M4 22h16" /><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
            </svg>
          </div>
          <p className="text-sm text-gray-500 font-medium">No Team Saved</p>
          <p className="text-xs text-gray-600 mt-1">Save your team in the My Team page first</p>
        </motion.div>
      )}

      {hasTeam && (
        <>
          {/* Rival Teams */}
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.05 }} className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-widest text-gray-500">Rival Teams ({rivals.length}/5)</h2>
              {rivals.length < 5 && editingRival === null && (
                <button onClick={startAddRival} className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)", color: "#9ca3af" }}>
                  + Add Rival
                </button>
              )}
            </div>

            {/* Existing rivals */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {rivals.map((rival, idx) => (
                <div key={idx} className="rounded-xl p-4" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-bold text-sm">{rival.name}</span>
                    <button onClick={() => removeRival(idx)} className="text-[10px] text-red-400 hover:text-red-300 font-semibold">Remove</button>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {rival.driver_ids.map((did) => {
                      const d = drivers.find((dr) => dr.id === did);
                      return (
                        <span key={did} className="px-1.5 py-0.5 rounded text-[10px] font-semibold" style={{ background: "var(--card-border)" }}>
                          {d?.code || did}{did === rival.drs_driver_id ? " (DRS)" : ""}
                        </span>
                      );
                    })}
                    {rival.constructor_ids.map((cid) => {
                      const c = constructors.find((co) => co.id === cid);
                      return (
                        <span key={`c-${cid}`} className="px-1.5 py-0.5 rounded text-[10px] font-semibold" style={{ background: c?.color ? `${c.color}30` : "var(--card-border)", color: c?.color }}>
                          {c?.name || cid}
                        </span>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Rival Editor */}
          {editingRival !== null && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl p-5 space-y-4" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
              <input
                value={rivalName}
                onChange={(e) => setRivalName(e.target.value)}
                className="w-full bg-transparent text-sm font-bold outline-none pb-2"
                style={{ borderBottom: "1px solid var(--card-border)" }}
                placeholder="Rival name..."
              />

              <div>
                <p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-2">Drivers ({rivalDrivers.length}/5)</p>
                <div className="flex flex-wrap gap-1.5">
                  {drivers.map((d) => {
                    const sel = rivalDrivers.includes(d.id);
                    const isDrs = rivalDrs === d.id;
                    return (
                      <button key={d.id} onClick={() => toggleRivalDriver(d.id)}
                        className="px-2 py-1 rounded-lg text-[10px] font-bold transition-all"
                        style={sel ? { background: `${d.constructor_color}30`, border: `1px solid ${d.constructor_color}`, color: d.constructor_color }
                          : { background: "var(--surface)", border: "1px solid var(--card-border)", color: "#6b7280" }}
                      >
                        {d.code}
                        {sel && (
                          <span onClick={(e) => { e.stopPropagation(); setRivalDrs(isDrs ? null : d.id); }}
                            className="ml-1 cursor-pointer" style={{ color: isDrs ? "var(--f1-red)" : "#4b5563" }}>
                            {isDrs ? "[DRS]" : ""}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                {rivalDrivers.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    <span className="text-[10px] text-gray-500">DRS:</span>
                    {rivalDrivers.map((did) => {
                      const d = drivers.find((dr) => dr.id === did);
                      return (
                        <button key={did} onClick={() => setRivalDrs(did)}
                          className="px-1.5 py-0.5 rounded text-[9px] font-bold"
                          style={rivalDrs === did ? { background: "var(--f1-red)", color: "white" } : { background: "var(--card-border)", color: "#9ca3af" }}
                        >
                          {d?.code}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div>
                <p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-2">Constructors ({rivalConstructors.length}/2)</p>
                <div className="flex flex-wrap gap-1.5">
                  {constructors.map((c) => {
                    const sel = rivalConstructors.includes(c.id);
                    return (
                      <button key={c.id} onClick={() => toggleRivalConstructor(c.id)}
                        className="px-2 py-1 rounded-lg text-[10px] font-bold transition-all"
                        style={sel ? { background: `${c.color}30`, border: `1px solid ${c.color}`, color: c.color }
                          : { background: "var(--surface)", border: "1px solid var(--card-border)", color: "#6b7280" }}
                      >
                        {c.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex gap-2">
                <button onClick={saveCurrentRival}
                  disabled={rivalDrivers.length !== 5 || rivalConstructors.length !== 2 || !rivalDrs}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-white disabled:opacity-30" style={{ background: "var(--f1-red)" }}>
                  Save Rival
                </button>
                <button onClick={() => setEditingRival(null)}
                  className="px-4 py-2 rounded-xl text-xs font-bold" style={{ background: "var(--card-border)", color: "#9ca3af" }}>
                  Cancel
                </button>
              </div>
            </motion.div>
          )}

          {/* Simulate Button */}
          {rivals.length > 0 && editingRival === null && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <button onClick={handleSimulate}
                disabled={!selectedRaceId || simulating}
                className="px-5 py-2.5 rounded-xl text-xs font-bold text-white transition-all disabled:opacity-30"
                style={{ background: selectedRaceId ? "var(--f1-red)" : "var(--card-border)" }}>
                {simulating ? "Simulating..." : "Simulate League"}
              </button>
            </motion.div>
          )}

          {/* Results */}
          {results.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
              {results.map((r, i) => {
                const isMe = r.team_name === "My Team";
                const barWidth = Math.round(r.win_probability * 100);
                return (
                  <div key={r.team_name}
                    className="rounded-xl p-4"
                    style={{
                      background: isMe ? "rgba(34,197,94,0.06)" : "var(--card-bg)",
                      border: isMe ? "1px solid rgba(34,197,94,0.25)" : "1px solid var(--card-border)",
                    }}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-lg font-black text-gray-600">#{i + 1}</span>
                        <span className="font-bold text-sm">{r.team_name}</span>
                        {isMe && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-400">YOU</span>}
                      </div>
                      <span className="text-sm font-mono font-bold text-white">{r.expected_points.toFixed(1)} pts</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "var(--card-border)" }}>
                        <div className="h-full rounded-full transition-all duration-700"
                          style={{ width: `${barWidth}%`, background: isMe ? "#22c55e" : "var(--f1-red)" }} />
                      </div>
                      <span className="text-xs font-mono font-bold" style={{ color: isMe ? "#22c55e" : "#f59e0b", minWidth: 40 }}>
                        {(r.win_probability * 100).toFixed(0)}%
                      </span>
                    </div>
                    {!isMe && (
                      <p className={`text-[10px] font-mono mt-1 ${r.differential > 0 ? "text-emerald-400" : r.differential < 0 ? "text-red-400" : "text-gray-500"}`}>
                        {r.differential > 0 ? "+" : ""}{r.differential.toFixed(1)} vs your team
                      </p>
                    )}
                  </div>
                );
              })}
            </motion.div>
          )}
        </>
      )}
    </div>
  );
}
