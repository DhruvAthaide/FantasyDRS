"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { api } from "@/lib/api";
import type { Race, Driver, DriverScorecard } from "@/types";
import RaceSelector from "@/components/RaceSelector";

type Tab = "entry" | "scorecard";

interface EntryRow {
  driver_id: number;
  code: string;
  name: string;
  constructor_color: string;
  quali: string;
  race: string;
  dnf: boolean;
  fastest_lap: boolean;
  dotd: boolean;
  overtakes: string;
}

export default function ResultsPage() {
  const [races, setRaces] = useState<Race[]>([]);
  const [selectedRaceId, setSelectedRaceId] = useState<number | null>(null);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [tab, setTab] = useState<Tab>("entry");
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [scorecard, setScorecard] = useState<DriverScorecard[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    Promise.all([api.getRaces(), api.getDrivers()]).then(([r, d]) => {
      setRaces(r);
      setDrivers(d);
    });
  }, []);

  useEffect(() => {
    if (!selectedRaceId || drivers.length === 0) return;

    // Initialize entry rows from drivers
    setEntries(
      drivers.map((d) => ({
        driver_id: d.id,
        code: d.code,
        name: `${d.first_name} ${d.last_name}`,
        constructor_color: d.constructor_color,
        quali: "",
        race: "",
        dnf: false,
        fastest_lap: false,
        dotd: false,
        overtakes: "0",
      }))
    );

    // Try to load existing results
    api.getResults(selectedRaceId).then((existing) => {
      if (existing.length > 0) {
        setEntries(
          drivers.map((d) => {
            const ex = existing.find((e) => e.driver_id === d.id);
            return {
              driver_id: d.id,
              code: d.code,
              name: `${d.first_name} ${d.last_name}`,
              constructor_color: d.constructor_color,
              quali: ex ? String(ex.qualifying_position) : "",
              race: ex ? String(ex.race_position) : "",
              dnf: ex?.dnf ?? false,
              fastest_lap: ex?.fastest_lap ?? false,
              dotd: ex?.dotd ?? false,
              overtakes: ex ? String(ex.overtakes) : "0",
            };
          })
        );
      }
    }).catch(() => {});

    // Load scorecard if available
    api.getScorecard(selectedRaceId).then(setScorecard).catch(() => setScorecard([]));
    setSaved(false);
  }, [selectedRaceId, drivers]);

  const updateEntry = (idx: number, field: keyof EntryRow, value: string | boolean) => {
    setEntries((prev) => prev.map((e, i) => i === idx ? { ...e, [field]: value } : e));
    setSaved(false);
  };

  const handleSave = async () => {
    if (!selectedRaceId) return;
    const valid = entries.filter((e) => e.quali && e.race);
    if (valid.length === 0) return;

    setSaving(true);
    try {
      await api.submitResults(
        selectedRaceId,
        valid.map((e) => ({
          driver_id: e.driver_id,
          qualifying_position: Number(e.quali),
          race_position: Number(e.race),
          dnf: e.dnf,
          fastest_lap: e.fastest_lap,
          dotd: e.dotd,
          overtakes: Number(e.overtakes),
        }))
      );
      setSaved(true);
      // Refresh scorecard
      const sc = await api.getScorecard(selectedRaceId);
      setScorecard(sc);
    } catch { /* */ }
    setSaving(false);
  };

  return (
    <div className="space-y-8">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight">Race Results</h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-1">Record actual results and compare vs predictions</p>
        </div>
        <RaceSelector races={races} selectedRaceId={selectedRaceId} onSelect={setSelectedRaceId} />
      </motion.div>

      {!selectedRaceId && (
        <div className="text-center py-16">
          <p className="text-sm text-gray-500 font-medium">Select a race to enter or view results</p>
        </div>
      )}

      {selectedRaceId && (
        <>
          {/* Tabs */}
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-2">
            {(["entry", "scorecard"] as Tab[]).map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className="px-4 py-2 rounded-xl text-xs font-bold transition-all"
                style={tab === t
                  ? { background: "var(--f1-red)", color: "white" }
                  : { background: "var(--card-bg)", border: "1px solid var(--card-border)", color: "#6b7280" }
                }
              >
                {t === "entry" ? "Enter Results" : "Scorecard"}
              </button>
            ))}
          </motion.div>

          {/* Entry Tab */}
          {tab === "entry" && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
              <div className="rounded-2xl overflow-hidden" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" style={{ minWidth: 700 }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--card-border)" }}>
                        {["Driver", "Quali", "Race", "DNF", "FL", "DotD", "Overtakes"].map((h, i) => (
                          <th key={h} className={`px-3 py-3 text-[10px] uppercase tracking-widest text-gray-600 font-semibold ${i === 0 ? "text-left" : "text-center"}`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((e, i) => (
                        <tr key={e.driver_id} style={{ borderBottom: "1px solid var(--card-border)" }}>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <div className="w-1.5 h-4 rounded-full" style={{ backgroundColor: e.constructor_color }} />
                              <span className="font-semibold text-xs">{e.code}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-center">
                            <input type="number" min="1" max="22" value={e.quali}
                              onChange={(ev) => updateEntry(i, "quali", ev.target.value)}
                              className="w-12 text-center text-xs font-mono bg-transparent rounded-lg py-1 outline-none focus:ring-1"
                              style={{ border: "1px solid var(--card-border)" }}
                            />
                          </td>
                          <td className="px-3 py-2 text-center">
                            <input type="number" min="1" max="22" value={e.race}
                              onChange={(ev) => updateEntry(i, "race", ev.target.value)}
                              className="w-12 text-center text-xs font-mono bg-transparent rounded-lg py-1 outline-none focus:ring-1"
                              style={{ border: "1px solid var(--card-border)" }}
                            />
                          </td>
                          <td className="px-3 py-2 text-center">
                            <button onClick={() => updateEntry(i, "dnf", !e.dnf)}
                              className={`w-6 h-6 rounded text-[10px] font-bold ${e.dnf ? "bg-red-500/20 text-red-400" : "text-gray-600"}`}
                              style={!e.dnf ? { border: "1px solid var(--card-border)" } : {}}
                            >{e.dnf ? "X" : ""}</button>
                          </td>
                          <td className="px-3 py-2 text-center">
                            <button onClick={() => updateEntry(i, "fastest_lap", !e.fastest_lap)}
                              className={`w-6 h-6 rounded text-[10px] font-bold ${e.fastest_lap ? "bg-purple-500/20 text-purple-400" : "text-gray-600"}`}
                              style={!e.fastest_lap ? { border: "1px solid var(--card-border)" } : {}}
                            >{e.fastest_lap ? "FL" : ""}</button>
                          </td>
                          <td className="px-3 py-2 text-center">
                            <button onClick={() => updateEntry(i, "dotd", !e.dotd)}
                              className={`w-6 h-6 rounded text-[10px] font-bold ${e.dotd ? "bg-cyan-500/20 text-cyan-400" : "text-gray-600"}`}
                              style={!e.dotd ? { border: "1px solid var(--card-border)" } : {}}
                            >{e.dotd ? "D" : ""}</button>
                          </td>
                          <td className="px-3 py-2 text-center">
                            <input type="number" min="0" max="50" value={e.overtakes}
                              onChange={(ev) => updateEntry(i, "overtakes", ev.target.value)}
                              className="w-12 text-center text-xs font-mono bg-transparent rounded-lg py-1 outline-none focus:ring-1"
                              style={{ border: "1px solid var(--card-border)" }}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button onClick={handleSave} disabled={saving}
                  className="px-5 py-2.5 rounded-xl text-xs font-bold text-white transition-all disabled:opacity-30"
                  style={{ background: "var(--f1-red)" }}
                >
                  {saving ? "Saving..." : "Save Results"}
                </button>
                {saved && <span className="text-xs text-emerald-400 font-semibold">Saved! Check the Scorecard tab.</span>}
              </div>
            </motion.div>
          )}

          {/* Scorecard Tab */}
          {tab === "scorecard" && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
              {scorecard.length === 0 ? (
                <div className="text-center py-16">
                  <p className="text-sm text-gray-500 font-medium">No Results Yet</p>
                  <p className="text-xs text-gray-600 mt-1">Enter results in the Entry tab first</p>
                </div>
              ) : (
                <>
                  {/* Summary stats */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { label: "Avg Actual", value: (scorecard.reduce((s, c) => s + c.total_pts, 0) / scorecard.length).toFixed(1) },
                      { label: "Avg Predicted", value: scorecard.filter((c) => c.predicted_pts !== null).length > 0 ? (scorecard.filter((c) => c.predicted_pts !== null).reduce((s, c) => s + (c.predicted_pts ?? 0), 0) / scorecard.filter((c) => c.predicted_pts !== null).length).toFixed(1) : "—" },
                      { label: "Top Scorer", value: scorecard[0]?.code ?? "—" },
                      { label: "Top Score", value: scorecard[0]?.total_pts.toFixed(1) ?? "—" },
                    ].map((s) => (
                      <div key={s.label} className="rounded-xl p-3" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
                        <div className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold">{s.label}</div>
                        <div className="text-lg font-black mt-0.5">{s.value}</div>
                      </div>
                    ))}
                  </div>

                  {/* Scorecard Table */}
                  <div className="rounded-2xl overflow-hidden" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm" style={{ minWidth: 800 }}>
                        <thead>
                          <tr style={{ borderBottom: "1px solid var(--card-border)" }}>
                            {["Driver", "Q", "R", "Q Pts", "R Pts", "Pos+", "OT", "FL", "DotD", "DNF", "Total", "Predicted", "Diff"].map((h, i) => (
                              <th key={h} className={`px-3 py-3 text-[10px] uppercase tracking-widest text-gray-600 font-semibold ${i === 0 ? "text-left" : "text-right"}`}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {scorecard.map((c) => (
                            <tr key={c.driver_id} className="hover:bg-white/[0.02]" style={{ borderBottom: "1px solid var(--card-border)" }}>
                              <td className="px-3 py-2">
                                <div className="flex items-center gap-2">
                                  <div className="w-1.5 h-4 rounded-full" style={{ backgroundColor: c.constructor_color }} />
                                  <span className="font-semibold">{c.code}</span>
                                </div>
                              </td>
                              <td className="px-3 py-2 text-right font-mono text-gray-400">P{c.qualifying_position}</td>
                              <td className="px-3 py-2 text-right font-mono text-gray-400">{c.dnf ? "DNF" : `P${c.race_position}`}</td>
                              <td className="px-3 py-2 text-right font-mono">{c.qualifying_pts}</td>
                              <td className="px-3 py-2 text-right font-mono">{c.race_pts}</td>
                              <td className={`px-3 py-2 text-right font-mono ${c.positions_gained_pts > 0 ? "text-emerald-400" : c.positions_gained_pts < 0 ? "text-red-400" : "text-gray-500"}`}>
                                {c.positions_gained_pts > 0 ? "+" : ""}{c.positions_gained_pts}
                              </td>
                              <td className="px-3 py-2 text-right font-mono text-gray-400">{c.overtake_pts}</td>
                              <td className="px-3 py-2 text-right font-mono">{c.fastest_lap_pts > 0 ? <span className="text-purple-400">{c.fastest_lap_pts}</span> : "—"}</td>
                              <td className="px-3 py-2 text-right font-mono">{c.dotd_pts > 0 ? <span className="text-cyan-400">{c.dotd_pts}</span> : "—"}</td>
                              <td className="px-3 py-2 text-right font-mono">{c.dnf_penalty < 0 ? <span className="text-red-400">{c.dnf_penalty}</span> : "—"}</td>
                              <td className="px-3 py-2 text-right font-mono font-bold text-white">{c.total_pts.toFixed(1)}</td>
                              <td className="px-3 py-2 text-right font-mono text-gray-400">{c.predicted_pts !== null ? c.predicted_pts.toFixed(1) : "—"}</td>
                              <td className={`px-3 py-2 text-right font-mono font-bold ${c.prediction_diff !== null ? (c.prediction_diff > 0 ? "text-emerald-400" : c.prediction_diff < 0 ? "text-red-400" : "text-gray-500") : "text-gray-600"}`}>
                                {c.prediction_diff !== null ? `${c.prediction_diff > 0 ? "+" : ""}${c.prediction_diff.toFixed(1)}` : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </motion.div>
          )}
        </>
      )}
    </div>
  );
}
