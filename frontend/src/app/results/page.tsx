"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/lib/api";
import type { Race, Driver, RaceResultEntry, DriverScorecard } from "@/types";
import RaceSelector from "@/components/RaceSelector";

type Tab = "results" | "scorecard";
type IngestStatus = "idle" | "loading" | "exists" | "ingested" | "pending" | "unavailable" | "error" | "manual";

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

function PositionBadge({ position }: { position: number }) {
  if (position >= 1 && position <= 3) {
    return (
      <span
        className={`pos-badge-${position} inline-flex items-center justify-center w-7 h-7 rounded-lg text-xs font-black`}
      >
        P{position}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-xs font-mono text-gray-400">
      P{position}
    </span>
  );
}

function StatusBadge({ status }: { status: IngestStatus }) {
  if (status === "exists" || status === "ingested") {
    return (
      <span className="status-auto inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider">
        <span className="w-1.5 h-1.5 rounded-full bg-current" />
        Auto-loaded
      </span>
    );
  }
  if (status === "pending") {
    return (
      <span className="status-pending inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider">
        <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
        Pending
      </span>
    );
  }
  if (status === "manual") {
    return (
      <span className="status-manual inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider">
        <span className="w-1.5 h-1.5 rounded-full bg-current" />
        Manual
      </span>
    );
  }
  if (status === "loading") {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider text-gray-500"
        style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--card-border)" }}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
        Loading...
      </span>
    );
  }
  if (status === "error" || status === "unavailable") {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider text-gray-500"
        style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--card-border)" }}
      >
        {status === "error" ? "Error" : "Unavailable"}
      </span>
    );
  }
  return null;
}

export default function ResultsPage() {
  const [races, setRaces] = useState<Race[]>([]);
  const [selectedRaceId, setSelectedRaceId] = useState<number | null>(null);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [tab, setTab] = useState<Tab>("results");

  // Results state
  const [results, setResults] = useState<RaceResultEntry[]>([]);
  const [ingestStatus, setIngestStatus] = useState<IngestStatus>("idle");

  // Manual entry state
  const [manualMode, setManualMode] = useState(false);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Scorecard state
  const [scorecard, setScorecard] = useState<DriverScorecard[]>([]);

  useEffect(() => {
    Promise.all([api.getRaces(), api.getDrivers()]).then(([r, d]) => {
      setRaces(r);
      setDrivers(d);
    }).catch(() => {});
    api.getNextRace().then((next) => {
      if (next) setSelectedRaceId(next.id);
    }).catch(() => {});
  }, []);

  const initializeEntries = useCallback(
    (existingResults?: RaceResultEntry[]) => {
      setEntries(
        drivers.map((d) => {
          const ex = existingResults?.find((e) => e.driver_id === d.id);
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
    },
    [drivers]
  );

  useEffect(() => {
    if (!selectedRaceId || drivers.length === 0) return;

    setManualMode(false);
    setSaved(false);
    setResults([]);
    setScorecard([]);
    setIngestStatus("loading");

    // Auto-ingest results for the selected race
    api
      .autoIngestResults(selectedRaceId)
      .then((response) => {
        const status = response.status as IngestStatus;
        setIngestStatus(status);

        if (
          (status === "exists" || status === "ingested") &&
          response.results &&
          response.results.length > 0
        ) {
          // Sort by race position
          const sorted = [...response.results].sort(
            (a, b) => (a.dnf ? 999 : a.race_position) - (b.dnf ? 999 : b.race_position)
          );
          setResults(sorted);
          initializeEntries(response.results);
        } else {
          // No auto results, initialize blank entries
          initializeEntries();
        }
      })
      .catch(() => {
        setIngestStatus("error");
        initializeEntries();
      });

    // Load scorecard
    api
      .getScorecard(selectedRaceId)
      .then(setScorecard)
      .catch(() => setScorecard([]));
  }, [selectedRaceId, drivers, initializeEntries]);

  const updateEntry = (idx: number, field: keyof EntryRow, value: string | boolean) => {
    setEntries((prev) => prev.map((e, i) => (i === idx ? { ...e, [field]: value } : e)));
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
      setIngestStatus("manual");

      // Reload results + scorecard
      const [newResults, sc] = await Promise.all([
        api.getResults(selectedRaceId),
        api.getScorecard(selectedRaceId),
      ]);
      const sorted = [...newResults].sort(
        (a, b) => (a.dnf ? 999 : a.race_position) - (b.dnf ? 999 : b.race_position)
      );
      setResults(sorted);
      setScorecard(sc);
      setManualMode(false);
    } catch {
      /* */
    }
    setSaving(false);
  };

  const selectedRace = races.find((r) => r.id === selectedRaceId);

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"
      >
        <div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight">Race Results</h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-1">
            Auto-loaded from official data or enter manually
          </p>
        </div>
        <RaceSelector races={races} selectedRaceId={selectedRaceId} onSelect={setSelectedRaceId} />
      </motion.div>

      {/* Empty state */}
      {!selectedRaceId && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="glass-card text-center py-20"
        >
          <div className="text-3xl mb-3 opacity-20">&#9873;</div>
          <p className="text-sm text-gray-500 font-medium">Select a race to view results</p>
          <p className="text-xs text-gray-600 mt-1">
            Results are auto-loaded when available
          </p>
        </motion.div>
      )}

      {selectedRaceId && (
        <AnimatePresence mode="wait">
          <motion.div
            key={selectedRaceId}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25 }}
            className="space-y-5"
          >
            {/* Race info bar + status */}
            <div className="glass-card p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-3">
                <div
                  className="w-1 h-8 rounded-full"
                  style={{ background: "var(--f1-red)" }}
                />
                <div>
                  <div className="text-sm font-bold">{selectedRace?.name}</div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-widest">
                    {selectedRace?.circuit_name} / {selectedRace?.country}
                    {selectedRace?.has_sprint ? " // Sprint Weekend" : ""}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <StatusBadge status={ingestStatus} />
                {!manualMode &&
                  ingestStatus !== "loading" && (
                    <button
                      onClick={() => {
                        setManualMode(true);
                        if (results.length > 0) {
                          initializeEntries(results);
                        }
                      }}
                      className="text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg transition-all hover:bg-white/5"
                      style={{ border: "1px solid var(--card-border)", color: "#6b7280" }}
                    >
                      Manual Entry
                    </button>
                  )}
                {manualMode && (
                  <button
                    onClick={() => setManualMode(false)}
                    className="text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg transition-all hover:bg-white/5"
                    style={{ border: "1px solid var(--card-border)", color: "#6b7280" }}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-2">
              {(
                [
                  { key: "results", label: "Results" },
                  { key: "scorecard", label: "Scorecard" },
                ] as { key: Tab; label: string }[]
              ).map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className="relative px-5 py-2.5 rounded-xl text-xs font-bold transition-all"
                  style={
                    tab === t.key
                      ? { background: "var(--f1-red)", color: "white" }
                      : {
                          background: "var(--card-bg)",
                          border: "1px solid var(--card-border)",
                          color: "#6b7280",
                        }
                  }
                >
                  {t.label}
                  {t.key === "scorecard" && scorecard.length > 0 && (
                    <span
                      className="absolute -top-1 -right-1 w-2 h-2 rounded-full"
                      style={{ background: "var(--neon-green)" }}
                    />
                  )}
                </button>
              ))}
            </div>

            {/* Results Tab */}
            {tab === "results" && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2 }}
                className="space-y-4"
              >
                {/* Loading state */}
                {ingestStatus === "loading" && (
                  <div className="glass-card p-12 text-center">
                    <div className="inline-block w-6 h-6 border-2 border-gray-600 border-t-[var(--f1-red)] rounded-full animate-spin mb-3" />
                    <p className="text-xs text-gray-500 font-medium">
                      Fetching results...
                    </p>
                  </div>
                )}

                {/* Read-only results view */}
                {!manualMode && ingestStatus !== "loading" && (
                  <>
                    {results.length === 0 ? (
                      <div className="glass-card text-center py-16">
                        <p className="text-sm text-gray-500 font-medium">
                          No Results Available
                        </p>
                        <p className="text-xs text-gray-600 mt-1">
                          {ingestStatus === "pending"
                            ? "Race results are not yet published"
                            : "Use Manual Entry to add results"}
                        </p>
                      </div>
                    ) : (
                      <div
                        className="glass-card overflow-hidden"
                      >
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm" style={{ minWidth: 600 }}>
                            <thead>
                              <tr style={{ borderBottom: "1px solid var(--card-border)" }}>
                                {["Pos", "Driver", "Quali", "Race", "FL", "DotD", "OT"].map(
                                  (h, i) => (
                                    <th
                                      key={h}
                                      className={`px-4 py-3 text-[10px] uppercase tracking-widest text-gray-600 font-semibold ${
                                        i <= 1 ? "text-left" : "text-center"
                                      }`}
                                    >
                                      {h}
                                    </th>
                                  )
                                )}
                              </tr>
                            </thead>
                            <tbody>
                              {results.map((r, idx) => (
                                <motion.tr
                                  key={r.driver_id}
                                  initial={{ opacity: 0, x: -8 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  transition={{ delay: idx * 0.03, duration: 0.2 }}
                                  className="hover:bg-white/[0.02] transition-colors"
                                  style={{
                                    borderBottom: "1px solid var(--card-border)",
                                  }}
                                >
                                  <td className="px-4 py-3">
                                    {r.dnf ? (
                                      <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-[10px] font-black bg-red-500/20 text-red-400">
                                        DNF
                                      </span>
                                    ) : (
                                      <PositionBadge position={r.race_position} />
                                    )}
                                  </td>
                                  <td className="px-4 py-3">
                                    <div className="flex items-center gap-2.5">
                                      <div
                                        className="w-1 h-5 rounded-full"
                                        style={{
                                          backgroundColor: r.constructor_color,
                                        }}
                                      />
                                      <div>
                                        <span className="font-bold text-xs">
                                          {r.code}
                                        </span>
                                        <span className="text-[10px] text-gray-500 ml-2 hidden sm:inline">
                                          {r.name}
                                        </span>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="px-4 py-3 text-center">
                                    <span className="font-mono text-xs text-gray-400">
                                      P{r.qualifying_position}
                                    </span>
                                  </td>
                                  <td className="px-4 py-3 text-center">
                                    <span className="font-mono text-xs text-gray-400">
                                      {r.dnf ? "DNF" : `P${r.race_position}`}
                                    </span>
                                  </td>
                                  <td className="px-4 py-3 text-center">
                                    {r.fastest_lap ? (
                                      <span
                                        className="inline-flex items-center justify-center w-6 h-6 rounded text-[10px] font-black"
                                        style={{
                                          background: "rgba(153, 69, 255, 0.2)",
                                          color: "var(--neon-purple)",
                                        }}
                                      >
                                        FL
                                      </span>
                                    ) : (
                                      <span className="text-gray-700">--</span>
                                    )}
                                  </td>
                                  <td className="px-4 py-3 text-center">
                                    {r.dotd ? (
                                      <span
                                        className="inline-flex items-center justify-center w-6 h-6 rounded text-[10px] font-black"
                                        style={{
                                          background: "rgba(0, 212, 255, 0.2)",
                                          color: "var(--neon-cyan)",
                                        }}
                                      >
                                        D
                                      </span>
                                    ) : (
                                      <span className="text-gray-700">--</span>
                                    )}
                                  </td>
                                  <td className="px-4 py-3 text-center">
                                    <span className="font-mono text-xs text-gray-400">
                                      {r.overtakes > 0 ? `+${r.overtakes}` : "--"}
                                    </span>
                                  </td>
                                </motion.tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* Manual entry mode */}
                {manualMode && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-4"
                  >
                    <div className="glass-card overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm" style={{ minWidth: 700 }}>
                          <thead>
                            <tr
                              style={{
                                borderBottom: "1px solid var(--card-border)",
                              }}
                            >
                              {[
                                "Driver",
                                "Quali",
                                "Race",
                                "DNF",
                                "FL",
                                "DotD",
                                "Overtakes",
                              ].map((h, i) => (
                                <th
                                  key={h}
                                  className={`px-3 py-3 text-[10px] uppercase tracking-widest text-gray-600 font-semibold ${
                                    i === 0 ? "text-left" : "text-center"
                                  }`}
                                >
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {entries.map((e, i) => (
                              <tr
                                key={e.driver_id}
                                style={{
                                  borderBottom: "1px solid var(--card-border)",
                                }}
                              >
                                <td className="px-3 py-2">
                                  <div className="flex items-center gap-2">
                                    <div
                                      className="w-1.5 h-4 rounded-full"
                                      style={{
                                        backgroundColor: e.constructor_color,
                                      }}
                                    />
                                    <span className="font-semibold text-xs">
                                      {e.code}
                                    </span>
                                  </div>
                                </td>
                                <td className="px-3 py-2 text-center">
                                  <input
                                    type="number"
                                    min="1"
                                    max="22"
                                    value={e.quali}
                                    onChange={(ev) =>
                                      updateEntry(i, "quali", ev.target.value)
                                    }
                                    className="w-12 text-center text-xs font-mono bg-transparent rounded-lg py-1 outline-none focus:ring-1"
                                    style={{
                                      border: "1px solid var(--card-border)",
                                    }}
                                  />
                                </td>
                                <td className="px-3 py-2 text-center">
                                  <input
                                    type="number"
                                    min="1"
                                    max="22"
                                    value={e.race}
                                    onChange={(ev) =>
                                      updateEntry(i, "race", ev.target.value)
                                    }
                                    className="w-12 text-center text-xs font-mono bg-transparent rounded-lg py-1 outline-none focus:ring-1"
                                    style={{
                                      border: "1px solid var(--card-border)",
                                    }}
                                  />
                                </td>
                                <td className="px-3 py-2 text-center">
                                  <button
                                    onClick={() => updateEntry(i, "dnf", !e.dnf)}
                                    className={`w-6 h-6 rounded text-[10px] font-bold ${
                                      e.dnf
                                        ? "bg-red-500/20 text-red-400"
                                        : "text-gray-600"
                                    }`}
                                    style={
                                      !e.dnf
                                        ? {
                                            border:
                                              "1px solid var(--card-border)",
                                          }
                                        : {}
                                    }
                                  >
                                    {e.dnf ? "X" : ""}
                                  </button>
                                </td>
                                <td className="px-3 py-2 text-center">
                                  <button
                                    onClick={() =>
                                      updateEntry(
                                        i,
                                        "fastest_lap",
                                        !e.fastest_lap
                                      )
                                    }
                                    className={`w-6 h-6 rounded text-[10px] font-bold ${
                                      e.fastest_lap
                                        ? "bg-purple-500/20 text-purple-400"
                                        : "text-gray-600"
                                    }`}
                                    style={
                                      !e.fastest_lap
                                        ? {
                                            border:
                                              "1px solid var(--card-border)",
                                          }
                                        : {}
                                    }
                                  >
                                    {e.fastest_lap ? "FL" : ""}
                                  </button>
                                </td>
                                <td className="px-3 py-2 text-center">
                                  <button
                                    onClick={() =>
                                      updateEntry(i, "dotd", !e.dotd)
                                    }
                                    className={`w-6 h-6 rounded text-[10px] font-bold ${
                                      e.dotd
                                        ? "bg-cyan-500/20 text-cyan-400"
                                        : "text-gray-600"
                                    }`}
                                    style={
                                      !e.dotd
                                        ? {
                                            border:
                                              "1px solid var(--card-border)",
                                          }
                                        : {}
                                    }
                                  >
                                    {e.dotd ? "D" : ""}
                                  </button>
                                </td>
                                <td className="px-3 py-2 text-center">
                                  <input
                                    type="number"
                                    min="0"
                                    max="50"
                                    value={e.overtakes}
                                    onChange={(ev) =>
                                      updateEntry(i, "overtakes", ev.target.value)
                                    }
                                    className="w-12 text-center text-xs font-mono bg-transparent rounded-lg py-1 outline-none focus:ring-1"
                                    style={{
                                      border: "1px solid var(--card-border)",
                                    }}
                                  />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        onClick={handleSave}
                        disabled={saving}
                        className="px-5 py-2.5 rounded-xl text-xs font-bold text-white transition-all disabled:opacity-30"
                        style={{ background: "var(--f1-red)" }}
                      >
                        {saving ? "Saving..." : "Save Results"}
                      </button>
                      {saved && (
                        <motion.span
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          className="text-xs font-semibold"
                          style={{ color: "var(--neon-green)" }}
                        >
                          Saved! Check the Scorecard tab.
                        </motion.span>
                      )}
                    </div>
                  </motion.div>
                )}
              </motion.div>
            )}

            {/* Scorecard Tab */}
            {tab === "scorecard" && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2 }}
                className="space-y-4"
              >
                {scorecard.length === 0 ? (
                  <div className="glass-card text-center py-16">
                    <p className="text-sm text-gray-500 font-medium">
                      No Scorecard Available
                    </p>
                    <p className="text-xs text-gray-600 mt-1">
                      Results must be recorded before prediction accuracy can be
                      compared
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Summary stats */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {[
                        {
                          label: "Avg Actual",
                          value: (
                            scorecard.reduce((s, c) => s + c.total_pts, 0) /
                            scorecard.length
                          ).toFixed(1),
                          color: "var(--foreground)",
                        },
                        {
                          label: "Avg Predicted",
                          value:
                            scorecard.filter((c) => c.predicted_pts !== null)
                              .length > 0
                              ? (
                                  scorecard
                                    .filter((c) => c.predicted_pts !== null)
                                    .reduce(
                                      (s, c) => s + (c.predicted_pts ?? 0),
                                      0
                                    ) /
                                  scorecard.filter(
                                    (c) => c.predicted_pts !== null
                                  ).length
                                ).toFixed(1)
                              : "--",
                          color: "var(--neon-cyan)",
                        },
                        {
                          label: "Top Scorer",
                          value: scorecard[0]?.code ?? "--",
                          color: "var(--neon-green)",
                        },
                        {
                          label: "Top Score",
                          value: scorecard[0]?.total_pts.toFixed(1) ?? "--",
                          color: "var(--neon-green)",
                        },
                      ].map((s, idx) => (
                        <motion.div
                          key={s.label}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: idx * 0.05 }}
                          className="glass-card p-4"
                        >
                          <div className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold">
                            {s.label}
                          </div>
                          <div
                            className="text-xl font-black mt-1 driver-number"
                            style={{ color: s.color }}
                          >
                            {s.value}
                          </div>
                        </motion.div>
                      ))}
                    </div>

                    {/* Scorecard Table */}
                    <div className="glass-card overflow-hidden">
                      <div className="overflow-x-auto">
                        <table
                          className="w-full text-sm"
                          style={{ minWidth: 800 }}
                        >
                          <thead>
                            <tr
                              style={{
                                borderBottom: "1px solid var(--card-border)",
                              }}
                            >
                              {[
                                "Driver",
                                "Q",
                                "R",
                                "Q Pts",
                                "R Pts",
                                "Pos+",
                                "OT",
                                "FL",
                                "DotD",
                                "DNF",
                                "Total",
                                "Predicted",
                                "Diff",
                              ].map((h, i) => (
                                <th
                                  key={h}
                                  className={`px-3 py-3 text-[10px] uppercase tracking-widest text-gray-600 font-semibold ${
                                    i === 0 ? "text-left" : "text-right"
                                  }`}
                                >
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {scorecard.map((c, idx) => (
                              <motion.tr
                                key={c.driver_id}
                                initial={{ opacity: 0, x: -8 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{
                                  delay: idx * 0.025,
                                  duration: 0.2,
                                }}
                                className="hover:bg-white/[0.02] transition-colors"
                                style={{
                                  borderBottom: "1px solid var(--card-border)",
                                }}
                              >
                                <td className="px-3 py-2">
                                  <div className="flex items-center gap-2">
                                    <div
                                      className="w-1.5 h-4 rounded-full"
                                      style={{
                                        backgroundColor: c.constructor_color,
                                      }}
                                    />
                                    <span className="font-semibold">
                                      {c.code}
                                    </span>
                                  </div>
                                </td>
                                <td className="px-3 py-2 text-right">
                                  <PositionBadge
                                    position={c.qualifying_position}
                                  />
                                </td>
                                <td className="px-3 py-2 text-right">
                                  {c.dnf ? (
                                    <span className="text-[10px] font-black text-red-400">
                                      DNF
                                    </span>
                                  ) : (
                                    <PositionBadge position={c.race_position} />
                                  )}
                                </td>
                                <td className="px-3 py-2 text-right font-mono">
                                  {c.qualifying_pts}
                                </td>
                                <td className="px-3 py-2 text-right font-mono">
                                  {c.race_pts}
                                </td>
                                <td
                                  className={`px-3 py-2 text-right font-mono ${
                                    c.positions_gained_pts > 0
                                      ? "text-emerald-400"
                                      : c.positions_gained_pts < 0
                                      ? "text-red-400"
                                      : "text-gray-500"
                                  }`}
                                >
                                  {c.positions_gained_pts > 0 ? "+" : ""}
                                  {c.positions_gained_pts}
                                </td>
                                <td className="px-3 py-2 text-right font-mono text-gray-400">
                                  {c.overtake_pts}
                                </td>
                                <td className="px-3 py-2 text-right font-mono">
                                  {c.fastest_lap_pts > 0 ? (
                                    <span style={{ color: "var(--neon-purple)" }}>
                                      {c.fastest_lap_pts}
                                    </span>
                                  ) : (
                                    <span className="text-gray-700">--</span>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-right font-mono">
                                  {c.dotd_pts > 0 ? (
                                    <span style={{ color: "var(--neon-cyan)" }}>
                                      {c.dotd_pts}
                                    </span>
                                  ) : (
                                    <span className="text-gray-700">--</span>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-right font-mono">
                                  {c.dnf_penalty < 0 ? (
                                    <span className="text-red-400">
                                      {c.dnf_penalty}
                                    </span>
                                  ) : (
                                    <span className="text-gray-700">--</span>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-right font-mono font-bold text-white">
                                  {c.total_pts.toFixed(1)}
                                </td>
                                <td className="px-3 py-2 text-right font-mono text-gray-400">
                                  {c.predicted_pts !== null
                                    ? c.predicted_pts.toFixed(1)
                                    : "--"}
                                </td>
                                <td
                                  className={`px-3 py-2 text-right font-mono font-bold ${
                                    c.prediction_diff !== null
                                      ? c.prediction_diff > 0
                                        ? "text-emerald-400"
                                        : c.prediction_diff < 0
                                        ? "text-red-400"
                                        : "text-gray-500"
                                      : "text-gray-600"
                                  }`}
                                >
                                  {c.prediction_diff !== null
                                    ? `${
                                        c.prediction_diff > 0 ? "+" : ""
                                      }${c.prediction_diff.toFixed(1)}`
                                    : "--"}
                                </td>
                              </motion.tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                )}
              </motion.div>
            )}
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );
}
