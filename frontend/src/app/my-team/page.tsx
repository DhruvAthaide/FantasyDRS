"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { api } from "@/lib/api";
import { getMyTeam, saveMyTeam } from "@/lib/storage";
import type { Driver, Constructor, Race, TeamComparisonResponse } from "@/types";
import RaceSelector from "@/components/RaceSelector";

export default function MyTeamPage() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [constructors, setConstructors] = useState<Constructor[]>([]);
  const [races, setRaces] = useState<Race[]>([]);
  const [selectedDrivers, setSelectedDrivers] = useState<number[]>([]);
  const [selectedConstructors, setSelectedConstructors] = useState<number[]>([]);
  const [drsDriverId, setDrsDriverId] = useState<number | null>(null);
  const [selectedRaceId, setSelectedRaceId] = useState<number | null>(null);
  const [comparison, setComparison] = useState<TeamComparisonResponse | null>(null);
  const [comparing, setComparing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [autoFilling, setAutoFilling] = useState(false);

  useEffect(() => {
    Promise.all([api.getDrivers(), api.getConstructors(), api.getRaces()]).then(
      ([d, c, r]) => {
        setDrivers(d);
        setConstructors(c);
        setRaces(r);
        const team = getMyTeam();
        if (team) {
          setSelectedDrivers(team.driver_ids);
          setSelectedConstructors(team.constructor_ids);
          setDrsDriverId(team.drs_driver_id);
        }
      }
    ).catch(() => {});
    api.getNextRace().then((next) => {
      if (next) setSelectedRaceId(next.id);
    }).catch(() => {});
  }, []);

  const toggleDriver = (id: number) => {
    setSelectedDrivers((prev) => {
      if (prev.includes(id)) {
        const remaining = prev.filter((x) => x !== id);
        // If removing the DRS driver, fall back to first remaining driver
        if (drsDriverId === id) {
          setDrsDriverId(remaining[0] || null);
        }
        return remaining;
      }
      if (prev.length >= 5) return prev;
      return [...prev, id];
    });
    setComparison(null);
    setSaved(false);
  };

  const toggleConstructor = (id: number) => {
    setSelectedConstructors((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return prev;
      return [...prev, id];
    });
    setComparison(null);
    setSaved(false);
  };

  const totalCost = [
    ...drivers.filter((d) => selectedDrivers.includes(d.id)).map((d) => d.price),
    ...constructors.filter((c) => selectedConstructors.includes(c.id)).map((c) => c.price),
  ].reduce((a, b) => a + b, 0);

  const isTeamComplete = selectedDrivers.length === 5 && selectedConstructors.length === 2 && drsDriverId !== null;

  const handleSave = () => {
    if (!isTeamComplete || !drsDriverId) return;
    saveMyTeam({ driver_ids: selectedDrivers, constructor_ids: selectedConstructors, drs_driver_id: drsDriverId });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleCompare = async () => {
    if (!isTeamComplete || !selectedRaceId || !drsDriverId) return;
    setComparing(true);
    try {
      const result = await api.compareMyTeam({
        driver_ids: selectedDrivers,
        constructor_ids: selectedConstructors,
        drs_driver_id: drsDriverId,
        race_id: selectedRaceId,
      });
      setComparison(result);
    } catch { /* sim may not exist */ }
    setComparing(false);
  };

  const handleAutoFill = async () => {
    if (!selectedRaceId) return;
    setAutoFilling(true);
    try {
      const teams = await api.getBestTeams({
        budget: 100,
        race_id: selectedRaceId,
        include_drivers: [],
        exclude_drivers: [],
        include_constructors: [],
        exclude_constructors: [],
        drs_multiplier: 2,
        top_n: 1,
      });
      if (teams.length > 0) {
        const best = teams[0];
        setSelectedDrivers(best.drivers.map((d: any) => d.id));
        setSelectedConstructors(best.constructors.map((c: any) => c.id));
        setDrsDriverId(best.drs_driver?.id || null);
        setSaved(false);
        setComparison(null);
      }
    } catch { /* sim may not exist */ }
    setAutoFilling(false);
  };

  return (
    <div className="space-y-8">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight">My Team</h1>
          <p className="text-xs sm:text-sm mt-1" style={{ color: "rgba(255,255,255,0.4)" }}>Track your fantasy team and compare vs optimal picks</p>
          <p className="text-[10px] mt-0.5" style={{ color: "rgba(255,255,255,0.25)" }}>Your team is saved in this browser only</p>
        </div>
        <RaceSelector races={races} selectedRaceId={selectedRaceId} onSelect={setSelectedRaceId} />
      </motion.div>

      {/* Budget Bar */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.05 }}
        className="glass-card p-5"
      >
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-bold uppercase tracking-widest" style={{ color: "var(--neon-cyan)" }}>Budget</span>
          <span className="text-sm font-mono font-bold" style={{ color: totalCost > 100 ? "var(--f1-red)" : "var(--neon-green)" }}>
            ${totalCost.toFixed(1)}M / $100.0M
          </span>
        </div>
        <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: "var(--card-border)" }}>
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${Math.min(100, (totalCost / 100) * 100)}%`, background: totalCost > 100 ? "var(--f1-red)" : "var(--neon-green)" }}
          />
        </div>
        <div className="flex flex-wrap items-center gap-4 mt-3 text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
          <span>{selectedDrivers.length}/5 Drivers</span>
          <span>{selectedConstructors.length}/2 Constructors</span>
          <span style={{ color: drsDriverId ? "var(--neon-purple)" : "rgba(255,255,255,0.4)" }}>{drsDriverId ? "DRS set" : "No DRS driver"}</span>
          {totalCost > 100 && <span className="font-semibold" style={{ color: "var(--f1-red)" }}>Over budget!</span>}
        </div>
        <div className="flex gap-2 mt-3">
          <button
            onClick={handleAutoFill}
            disabled={!selectedRaceId || autoFilling}
            className="px-4 py-2 rounded-lg text-xs font-bold transition-all"
            style={{
              background: selectedRaceId ? "var(--neon-cyan)" : "var(--card-border)",
              color: selectedRaceId ? "#050508" : "rgba(255,255,255,0.3)",
              opacity: autoFilling ? 0.6 : 1,
            }}
          >
            {autoFilling ? "Optimizing..." : "Fill Optimal Team"}
          </button>
          {!selectedRaceId && (
            <span className="text-[10px] self-center" style={{ color: "rgba(255,255,255,0.3)" }}>
              Select a race first
            </span>
          )}
        </div>
      </motion.div>

      {/* Driver Selection */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }} className="space-y-4">
        <h2 className="text-xs font-bold uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.4)" }}>Select 5 Drivers</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {drivers.map((d) => {
            const selected = selectedDrivers.includes(d.id);
            const isDrs = drsDriverId === d.id;
            return (
              <div key={d.id} className="relative">
                <button
                  onClick={() => toggleDriver(d.id)}
                  className={`w-full rounded-xl px-3 py-3 text-left transition-all min-h-[80px] ${selected ? "" : "glass-card"}`}
                  style={selected ? { background: `${d.constructor_color}15`, border: `2px solid ${d.constructor_color}`, borderRadius: "12px" }
                    : undefined}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-1.5 h-5 rounded-full" style={{ backgroundColor: d.constructor_color }} />
                    <span className="font-bold text-sm">{d.code}</span>
                  </div>
                  <div className="text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>{d.constructor_name}</div>
                  <div className="text-xs font-mono mt-1" style={{ color: "rgba(255,255,255,0.4)" }}>${d.price}M</div>
                </button>
                {selected && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setDrsDriverId(isDrs ? null : d.id); setSaved(false); }}
                    className={`absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded text-[9px] font-bold transition-all ${isDrs ? "glow-purple" : ""}`}
                    style={isDrs ? { background: "var(--neon-purple)", color: "white" }
                      : { background: "var(--card-border)", color: "#9ca3af" }}
                  >
                    DRS
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </motion.div>

      {/* Constructor Selection */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }} className="space-y-4">
        <h2 className="text-xs font-bold uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.4)" }}>Select 2 Constructors</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {constructors.map((c) => {
            const selected = selectedConstructors.includes(c.id);
            return (
              <button
                key={c.id}
                onClick={() => toggleConstructor(c.id)}
                className={`rounded-xl px-3 py-3 text-left transition-all ${selected ? "" : "glass-card"}`}
                style={selected ? { background: `${c.color}15`, border: `2px solid ${c.color}`, borderRadius: "12px" }
                  : undefined}
              >
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: c.color }} />
                  <span className="font-bold text-sm">{c.name}</span>
                </div>
                <div className="text-xs font-mono" style={{ color: "rgba(255,255,255,0.4)" }}>${c.price}M</div>
              </button>
            );
          })}
        </div>
      </motion.div>

      {/* Actions */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="flex flex-wrap gap-3">
        <button
          onClick={handleSave}
          disabled={!isTeamComplete}
          className={`px-5 py-2.5 rounded-xl text-xs font-bold transition-all disabled:opacity-30 ${saved ? "glow-green" : ""}`}
          style={{ background: saved ? "var(--neon-green)" : "var(--card-bg)", border: "1px solid var(--card-border)", color: saved ? "#000" : isTeamComplete ? "white" : "rgba(255,255,255,0.4)" }}
        >
          {saved ? "Saved!" : "Save Team"}
        </button>
        <button
          onClick={handleCompare}
          disabled={!isTeamComplete || !selectedRaceId || comparing}
          className="px-5 py-2.5 rounded-xl text-xs font-bold text-white transition-all disabled:opacity-30 glow-red"
          style={{ background: isTeamComplete && selectedRaceId ? "var(--f1-red)" : "var(--card-border)" }}
        >
          {comparing ? "Comparing..." : "Compare vs Optimal"}
        </button>
      </motion.div>

      {/* Comparison Results */}
      {comparison && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
          <div className="racing-stripe" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { label: "Your Team", value: comparison.my_team_points, color: "var(--neon-green)" },
              { label: "Optimal Team", value: comparison.optimal_points, color: "var(--neon-cyan)" },
              { label: "Points Left on Table", value: comparison.points_left_on_table, color: comparison.points_left_on_table > 10 ? "var(--f1-red)" : comparison.points_left_on_table > 0 ? "var(--timing-yellow)" : "var(--neon-green)" },
            ].map((card) => (
              <div key={card.label} className="glass-card p-5 text-center">
                <p className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: "rgba(255,255,255,0.4)" }}>{card.label}</p>
                <p className="text-2xl font-black" style={{ color: card.color }}>{card.value.toFixed(1)}</p>
              </div>
            ))}
          </div>

          <div className="glass-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--card-border)" }}>
                  {["Asset", "Expected Pts", "Role"].map((h, i) => (
                    <th key={h} className={`px-5 py-3.5 text-[10px] uppercase tracking-widest font-semibold ${i === 0 ? "text-left" : "text-right"}`} style={{ color: "rgba(255,255,255,0.3)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {comparison.driver_points.map((d) => (
                  <tr key={`d-${d.id}`} className="transition-colors hover:bg-white/[0.02]" style={{ borderBottom: "1px solid var(--card-border)" }}>
                    <td className="px-5 py-3 font-semibold">{d.name}</td>
                    <td className="px-5 py-3 text-right font-mono" style={{ color: "var(--neon-green)" }}>{d.points.toFixed(1)}</td>
                    <td className="px-5 py-3 text-right">
                      {d.is_drs ? <span className="px-2 py-0.5 rounded text-[10px] font-bold glow-purple" style={{ background: "var(--neon-purple)", color: "white" }}>DRS x2</span> : <span className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>Driver</span>}
                    </td>
                  </tr>
                ))}
                {comparison.constructor_points.map((c) => (
                  <tr key={`c-${c.id}`} className="transition-colors hover:bg-white/[0.02]" style={{ borderBottom: "1px solid var(--card-border)" }}>
                    <td className="px-5 py-3 font-semibold">{c.name}</td>
                    <td className="px-5 py-3 text-right font-mono" style={{ color: "var(--neon-green)" }}>{c.points.toFixed(1)}</td>
                    <td className="px-5 py-3 text-right text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>Constructor</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}
    </div>
  );
}
