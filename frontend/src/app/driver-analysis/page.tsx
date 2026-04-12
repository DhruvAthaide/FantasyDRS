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
import { FEATURE_TELEMETRY_LIVE } from "@/lib/flags";
import type {
  Race,
  Driver,
  CompareDriverResult,
  LapTimePoint,
  SectorTimePoint,
  SpeedTracePoint,
  TireStint,
  PositionPoint,
  TelemetryPoint,
  SpeedTrap,
  LapDistribution,
  StintDegradation,
  GearDistribution,
  GapPoint,
} from "@/types";
import RaceSelector from "@/components/RaceSelector";
import InfoTooltip from "@/components/InfoTooltip";
import {
  LapTimeChart,
  SectorTimesChart,
  SpeedTraceChart,
  TireStrategyChart,
  PositionChart,
  TelemetryTraceChart,
  GearChart,
  SpeedTrapChart,
  LapDistributionChart,
  StintDegradationChart,
  GapAnalysisChart,
  ChartSkeleton,
} from "@/components/charts";

// ── Overview tab constants (migrated from /compare) ──────────────────
const DIMENSIONS = ["Pace", "Consistency", "Value", "Form", "Circuit Fit", "Risk"] as const;

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
  Form: "pace_rating",
};

function formToNumeric(trend: CompareDriverResult["form_trend"]): number {
  if (trend === "improving") return 90;
  if (trend === "stable") return 60;
  return 30;
}

function getDimensionValue(d: CompareDriverResult, dim: (typeof DIMENSIONS)[number]): number {
  if (dim === "Form") return formToNumeric(d.form_trend);
  return d[DIMENSION_KEYS[dim]] as number;
}

function FormTrendIndicator({ trend }: { trend: CompareDriverResult["form_trend"] }) {
  if (trend === "improving") {
    return (
      <span className="inline-flex items-center gap-1 text-emerald-400 text-xs font-bold">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="18 15 12 9 6 15" /></svg>
        Improving
      </span>
    );
  }
  if (trend === "declining") {
    return (
      <span className="inline-flex items-center gap-1 text-red-400 text-xs font-bold">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="6 9 12 15 18 9" /></svg>
        Declining
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-yellow-400 text-xs font-bold">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="5" y1="12" x2="19" y2="12" /></svg>
      Stable
    </span>
  );
}

// ── Session selector ──────────────────────────────────────────────────
const SESSION_TYPES = [
  { value: "R", label: "Race" },
  { value: "Q", label: "Qualifying" },
  { value: "S", label: "Sprint" },
  { value: "FP1", label: "FP1" },
  { value: "FP2", label: "FP2" },
  { value: "FP3", label: "FP3" },
];

// ── Tab definitions ──────────────────────────────────────────────────
const TABS = ["Overview", "Driver Graphs", "Compare"] as const;
type Tab = (typeof TABS)[number];

// ── Main component ──────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════
// Placeholder rendered when FEATURE_TELEMETRY_LIVE is off (v1.0 default).
// See .paul/phases/02-f1-data-strategy/02-01-RESEARCH.md §3 for context.
// ════════════════════════════════════════════════════════════════════
function TelemetryDisabledBanner() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-white/10 bg-white/5 p-6 sm:p-8 text-center"
    >
      <div className="mx-auto max-w-md space-y-3">
        <h2 className="text-lg font-bold text-white">Live telemetry unavailable</h2>
        <p className="text-sm text-gray-400 leading-relaxed">
          This deployment of FantasyDRS does not include live telemetry. The feature
          requires continuous session access that isn&apos;t available on Vercel&apos;s
          serverless runtime.
        </p>
        <p className="text-xs text-gray-500">
          Planned for a post-v1.0 release. Until then, check the Overview tab for
          simulation-driven driver comparisons.
        </p>
      </div>
    </motion.div>
  );
}

export default function DriverAnalysisPage() {
  const [activeTab, setActiveTab] = useState<Tab>("Overview");
  const [races, setRaces] = useState<Race[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [selectedRaceId, setSelectedRaceId] = useState<number | null>(null);
  const [sessionType, setSessionType] = useState("R");

  useEffect(() => {
    Promise.all([api.getRaces(), api.getDrivers(), api.getNextRace()]).then(
      ([r, d, next]) => {
        setRaces(r);
        setDrivers(d);
        if (next) setSelectedRaceId(next.id);
      }
    ).catch(() => {});
  }, []);

  const selectedRace = races.find((r) => r.id === selectedRaceId);

  // Derive year + event name from selected race
  const raceYear = selectedRace ? parseInt(selectedRace.date.slice(0, 4)) : 2026;
  const raceEvent = selectedRace?.name.replace(" Grand Prix", "") || "";

  const driversByConstructor = useMemo(() => {
    const map = new Map<string, Driver[]>();
    drivers.forEach((d) => {
      const existing = map.get(d.constructor_name) || [];
      existing.push(d);
      map.set(d.constructor_name, existing);
    });
    return map;
  }, [drivers]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"
      >
        <div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight">Driver Analysis</h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-1">
            Performance radar, telemetry graphs, and head-to-head comparison
          </p>
        </div>
        <div className="flex items-center gap-2">
          {activeTab !== "Overview" && (
            <select
              value={sessionType}
              onChange={(e) => setSessionType(e.target.value)}
              className="px-3 py-2 rounded-xl text-xs font-medium bg-white/5 border border-white/10 text-white outline-none"
            >
              {SESSION_TYPES.map((s) => (
                <option key={s.value} value={s.value} className="bg-gray-900">{s.label}</option>
              ))}
            </select>
          )}
          <RaceSelector races={races} selectedRaceId={selectedRaceId} onSelect={setSelectedRaceId} />
        </div>
      </motion.div>

      {/* Tab Bar */}
      <div className="flex gap-1 bg-white/5 rounded-xl p-1">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === tab
                ? "bg-white/10 text-white shadow-sm"
                : "text-gray-400 hover:text-gray-200"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === "Overview" && (
        <OverviewTab
          races={races}
          drivers={drivers}
          selectedRaceId={selectedRaceId}
          driversByConstructor={driversByConstructor}
        />
      )}

      {activeTab === "Driver Graphs" && (
        FEATURE_TELEMETRY_LIVE ? (
          <GraphsTab
            drivers={drivers}
            driversByConstructor={driversByConstructor}
            raceYear={raceYear}
            raceEvent={raceEvent}
            sessionType={sessionType}
          />
        ) : (
          <TelemetryDisabledBanner />
        )
      )}

      {activeTab === "Compare" && (
        FEATURE_TELEMETRY_LIVE ? (
          <CompareTab
            drivers={drivers}
            driversByConstructor={driversByConstructor}
            raceYear={raceYear}
            raceEvent={raceEvent}
            sessionType={sessionType}
          />
        ) : (
          <TelemetryDisabledBanner />
        )
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// TAB 1: Overview (migrated from /compare)
// ════════════════════════════════════════════════════════════════════
function OverviewTab({
  races,
  drivers,
  selectedRaceId,
  driversByConstructor,
}: {
  races: Race[];
  drivers: Driver[];
  selectedRaceId: number | null;
  driversByConstructor: Map<string, Driver[]>;
}) {
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [results, setResults] = useState<CompareDriverResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const MAX_DRIVERS = 4;

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
      results.forEach((d) => { entry[d.code] = getDimensionValue(d, dim); });
      return entry;
    });
  }, [results]);

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
    <div className="space-y-6">
      {/* Driver Selector */}
      <DriverSelector
        driversByConstructor={driversByConstructor}
        selectedIds={selectedIds}
        maxDrivers={MAX_DRIVERS}
        onToggle={toggleDriver}
        onClear={() => setSelectedIds([])}
      />

      {/* Compare Button */}
      <button
        onClick={handleCompare}
        disabled={selectedIds.length < 2 || !selectedRaceId || loading}
        className="px-6 py-2.5 rounded-xl text-xs font-bold text-white transition-all disabled:opacity-30"
        style={{
          background: selectedIds.length >= 2 && selectedRaceId ? "var(--f1-red)" : "var(--card-border)",
        }}
      >
        {loading ? "Comparing..." : "Compare Drivers"}
      </button>

      {/* No results message */}
      {searched && results.length === 0 && !loading && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-16">
          <p className="text-sm text-gray-500 font-medium">No Comparison Data</p>
          <p className="text-xs text-gray-600 mt-1">Run a simulation for this race first</p>
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
            <div className="glass-card rounded-2xl p-5 relative overflow-hidden">
              <div className="racing-stripe" />
              <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-4">Performance Radar</h3>
              <div className="w-full" style={{ height: 380 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="75%">
                    <PolarGrid stroke="var(--card-border)" strokeDasharray="3 3" />
                    <PolarAngleAxis dataKey="dimension" tick={{ fill: "#9ca3af", fontSize: 11, fontWeight: 600 }} />
                    {results.map((d, i) => (
                      <Radar key={d.driver_id} name={d.code} dataKey={d.code}
                        stroke={d.constructor_color} fill={d.constructor_color}
                        fillOpacity={0.12 + i * 0.03} strokeWidth={2} />
                    ))}
                    <Legend wrapperStyle={{ fontSize: 12, fontWeight: 700 }} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {results.map((d) => (
                <motion.div key={d.driver_id} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                  className="glass-card rounded-xl p-4 relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-full h-0.5" style={{ backgroundColor: d.constructor_color }} />
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-1.5 h-5 rounded-full" style={{ backgroundColor: d.constructor_color }} />
                    <span className="font-black text-sm">{d.code}</span>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500">Expected</span>
                      <span className="font-mono font-bold">{d.expected_pts.toFixed(1)}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500">Price</span>
                      <span className="font-mono font-bold">${d.price.toFixed(1)}m</span>
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
            <div className="glass-card rounded-2xl p-5">
              <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-5">Dimension Breakdown</h3>
              <div className="space-y-5">
                {DIMENSIONS.map((dim) => (
                  <div key={dim}>
                    <div className="text-xs font-semibold text-gray-400 mb-2 inline-flex items-center">
                      {dim}<InfoTooltip text={DIMENSION_TOOLTIPS[dim]} />
                    </div>
                    <div className="space-y-1.5">
                      {results.map((d) => {
                        const val = getDimensionValue(d, dim);
                        const pct = Math.max(5, (val / maxDimensionValue) * 100);
                        return (
                          <div key={d.driver_id} className="flex items-center gap-3">
                            <div className="w-10 text-xs font-bold text-right shrink-0" style={{ color: d.constructor_color }}>{d.code}</div>
                            <div className="flex-1 h-6 rounded-lg overflow-hidden relative" style={{ background: "var(--surface)" }}>
                              <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }}
                                transition={{ duration: 0.6, ease: "easeOut" }}
                                className="h-full rounded-lg flex items-center px-2"
                                style={{ background: `${d.constructor_color}30`, borderRight: `2px solid ${d.constructor_color}` }}>
                                <span className="text-[10px] font-mono font-bold whitespace-nowrap">{val.toFixed(1)}</span>
                              </motion.div>
                            </div>
                            {dim === "Form" && <div className="shrink-0"><FormTrendIndicator trend={d.form_trend} /></div>}
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

// ════════════════════════════════════════════════════════════════════
// TAB 2: Driver Graphs (10 charts for a single driver)
// ════════════════════════════════════════════════════════════════════
function GraphsTab({
  drivers,
  driversByConstructor,
  raceYear,
  raceEvent,
  sessionType,
}: {
  drivers: Driver[];
  driversByConstructor: Map<string, Driver[]>;
  raceYear: number;
  raceEvent: string;
  sessionType: string;
}) {
  const [selectedDriver, setSelectedDriver] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [lapTimes, setLapTimes] = useState<LapTimePoint[]>([]);
  const [sectors, setSectors] = useState<SectorTimePoint[]>([]);
  const [speedTrace, setSpeedTrace] = useState<SpeedTracePoint[]>([]);
  const [tireStrategy, setTireStrategy] = useState<TireStint[]>([]);
  const [positions, setPositions] = useState<PositionPoint[]>([]);
  const [telemetry, setTelemetry] = useState<TelemetryPoint[]>([]);
  const [gears, setGears] = useState<GearDistribution[]>([]);
  const [speedTraps, setSpeedTraps] = useState<SpeedTrap[]>([]);
  const [distribution, setDistribution] = useState<LapDistribution | null>(null);
  const [degradation, setDegradation] = useState<StintDegradation[]>([]);
  const [hasLoaded, setHasLoaded] = useState(false);

  // Clear stale data when race/session/driver changes
  useEffect(() => {
    setHasLoaded(false);
    setLapTimes([]);
    setSectors([]);
    setSpeedTrace([]);
    setTireStrategy([]);
    setPositions([]);
    setTelemetry([]);
    setGears([]);
    setSpeedTraps([]);
    setDistribution(null);
    setDegradation([]);
  }, [raceEvent, sessionType, selectedDriver]);

  const loadData = async () => {
    if (!selectedDriver || !raceEvent) return;
    setLoading(true);
    setHasLoaded(false);

    const results = await Promise.allSettled([
      api.getTelemetryLaps(raceYear, raceEvent, sessionType, selectedDriver),
      api.getTelemetrySectors(raceYear, raceEvent, sessionType, selectedDriver),
      api.getTelemetrySpeedTrace(raceYear, raceEvent, sessionType, selectedDriver),
      api.getTelemetryTireStrategy(raceYear, raceEvent, sessionType, selectedDriver),
      api.getTelemetryPositions(raceYear, raceEvent, sessionType, selectedDriver),
      api.getTelemetryDrivingData(raceYear, raceEvent, sessionType, selectedDriver),
      api.getTelemetryGear(raceYear, raceEvent, sessionType, selectedDriver),
      api.getTelemetrySpeedTraps(raceYear, raceEvent, sessionType, selectedDriver),
      api.getTelemetryDistribution(raceYear, raceEvent, sessionType, selectedDriver),
      api.getTelemetryDegradation(raceYear, raceEvent, sessionType, selectedDriver),
    ]);

    const get = <T,>(i: number, fallback: T): T => {
      const r = results[i];
      return r.status === "fulfilled" ? r.value as T : fallback;
    };

    setLapTimes(get(0, [] as LapTimePoint[]));
    setSectors(get(1, [] as SectorTimePoint[]));
    const traceData = get(2, { points: [] as SpeedTracePoint[], lap_number: null, lap_time: null });
    setSpeedTrace(traceData.points || []);
    setTireStrategy(get(3, [] as TireStint[]));
    setPositions(get(4, [] as PositionPoint[]));
    const telData = get(5, { points: [] as TelemetryPoint[], lap_number: null });
    setTelemetry(telData.points || []);
    setGears(get(6, [] as GearDistribution[]));
    setSpeedTraps(get(7, [] as SpeedTrap[]));
    setDistribution(get(8, null as LapDistribution | null));
    setDegradation(get(9, [] as StintDegradation[]));

    setLoading(false);
    setHasLoaded(true);
  };

  const driverColor = drivers.find((d) => d.code === selectedDriver)?.constructor_color || "#e10600";

  return (
    <div className="space-y-6">
      {/* Driver selector + Load button */}
      <div className="glass-card rounded-2xl p-5">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="flex-1">
            <label className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-2 block">Select Driver</label>
            <select
              value={selectedDriver}
              onChange={(e) => setSelectedDriver(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-white/5 border border-white/10 text-white outline-none"
            >
              <option value="" className="bg-gray-900">Choose a driver...</option>
              {Array.from(driversByConstructor.entries()).map(([team, teamDrivers]) => (
                <optgroup key={team} label={team}>
                  {teamDrivers.map((d) => (
                    <option key={d.code} value={d.code} className="bg-gray-900">
                      {d.code} - {d.first_name} {d.last_name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <button
            onClick={loadData}
            disabled={!selectedDriver || !raceEvent || loading}
            className="px-6 py-2.5 rounded-xl text-xs font-bold text-white transition-all disabled:opacity-30 shrink-0"
            style={{ background: selectedDriver && raceEvent ? "var(--f1-red)" : "var(--card-border)" }}
          >
            {loading ? "Loading Telemetry..." : "Load Data"}
          </button>
        </div>
      </div>

      {/* Charts Grid */}
      {(loading || hasLoaded) && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
          {/* Row 1: Lap Times (full width) */}
          <ChartCard title="Lap Time Progression" tooltip="Lap times colored by tire compound">
            <LapTimeChart data={lapTimes} loading={loading} driver1Color={driverColor} />
          </ChartCard>

          {/* Row 2: Speed Trace | Position */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartCard title="Speed Trace" tooltip="Speed vs distance around fastest lap">
              <SpeedTraceChart data={speedTrace} loading={loading} driver1Color={driverColor} driver1Name={selectedDriver} />
            </ChartCard>
            <ChartCard title="Position Progression" tooltip="Race position changes lap by lap">
              <PositionChart data={positions} loading={loading} driver1Color={driverColor} />
            </ChartCard>
          </div>

          {/* Row 3: Sectors | Tire Strategy */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartCard title="Sector Times" tooltip="S1/S2/S3 breakdown per lap">
              <SectorTimesChart data={sectors} loading={loading} />
            </ChartCard>
            <ChartCard title="Tire Strategy" tooltip="Stint breakdown with compound colors">
              <TireStrategyChart stints={tireStrategy} loading={loading}
                totalLaps={lapTimes.length > 0 ? Math.max(...lapTimes.map((l) => l.lap_number)) : undefined} />
            </ChartCard>
          </div>

          {/* Row 4: Telemetry Trace (full width) */}
          <ChartCard title="Telemetry Trace" tooltip="Speed, throttle, brake and DRS data vs distance">
            <TelemetryTraceChart data={telemetry} loading={loading} driver1Color={driverColor} />
          </ChartCard>

          {/* Row 5: Degradation | Distribution */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartCard title="Stint Degradation" tooltip="Lap time trend per stint showing tire wear">
              <StintDegradationChart data={degradation} loading={loading} />
            </ChartCard>
            <ChartCard title="Lap Time Distribution" tooltip="Statistical spread of lap times (excluding pit laps)">
              <LapDistributionChart data={distribution} loading={loading} />
            </ChartCard>
          </div>

          {/* Row 6: Gears | Speed Traps */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartCard title="Gear Usage" tooltip="Percentage of fastest lap spent in each gear">
              <GearChart data={gears} loading={loading} />
            </ChartCard>
            <ChartCard title="Speed Traps" tooltip="Best speed at each measurement point">
              <SpeedTrapChart data={speedTraps} loading={loading} driver1Color={driverColor} driver1Name={selectedDriver} />
            </ChartCard>
          </div>
        </motion.div>
      )}

      {!loading && !hasLoaded && (
        <div className="text-center py-20">
          <p className="text-sm text-gray-500">Select a driver and click Load Data to view telemetry</p>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// TAB 3: Compare (8 overlaid charts for two drivers)
// ════════════════════════════════════════════════════════════════════
function CompareTab({
  drivers,
  driversByConstructor,
  raceYear,
  raceEvent,
  sessionType,
}: {
  drivers: Driver[];
  driversByConstructor: Map<string, Driver[]>;
  raceYear: number;
  raceEvent: string;
  sessionType: string;
}) {
  const [driver1, setDriver1] = useState("");
  const [driver2, setDriver2] = useState("");
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);

  // Data states
  const [lapTimes1, setLapTimes1] = useState<LapTimePoint[]>([]);
  const [lapTimes2, setLapTimes2] = useState<LapTimePoint[]>([]);
  const [speed1, setSpeed1] = useState<SpeedTracePoint[]>([]);
  const [speed2, setSpeed2] = useState<SpeedTracePoint[]>([]);
  const [sectors1, setSectors1] = useState<SectorTimePoint[]>([]);
  const [sectors2, setSectors2] = useState<SectorTimePoint[]>([]);
  const [pos1, setPos1] = useState<PositionPoint[]>([]);
  const [pos2, setPos2] = useState<PositionPoint[]>([]);
  const [stints1, setStints1] = useState<TireStint[]>([]);
  const [stints2, setStints2] = useState<TireStint[]>([]);
  const [tel1, setTel1] = useState<TelemetryPoint[]>([]);
  const [tel2, setTel2] = useState<TelemetryPoint[]>([]);
  const [gap, setGap] = useState<GapPoint[]>([]);
  const [speedTraps1, setSpeedTraps1] = useState<SpeedTrap[]>([]);
  const [speedTraps2, setSpeedTraps2] = useState<SpeedTrap[]>([]);

  // Clear stale data when race/session/drivers change
  useEffect(() => {
    setHasLoaded(false);
    setLapTimes1([]); setLapTimes2([]);
    setSpeed1([]); setSpeed2([]);
    setSectors1([]); setSectors2([]);
    setPos1([]); setPos2([]);
    setStints1([]); setStints2([]);
    setTel1([]); setTel2([]);
    setGap([]);
    setSpeedTraps1([]); setSpeedTraps2([]);
  }, [raceEvent, sessionType, driver1, driver2]);

  const d1 = drivers.find((d) => d.code === driver1);
  const d2 = drivers.find((d) => d.code === driver2);
  const rawColor1 = d1?.constructor_color || "#e10600";
  const rawColor2 = d2?.constructor_color || "#00d2ff";
  // If both drivers share the same team color, differentiate with a fallback
  const color1 = rawColor1;
  const color2 = rawColor1 === rawColor2 ? "#00d2ff" : rawColor2;

  const loadCompare = async () => {
    if (!driver1 || !driver2 || !raceEvent) return;
    setLoading(true);
    setHasLoaded(false);

    const results = await Promise.allSettled([
      api.getTelemetryLaps(raceYear, raceEvent, sessionType, driver1),
      api.getTelemetryLaps(raceYear, raceEvent, sessionType, driver2),
      api.getTelemetrySpeedTrace(raceYear, raceEvent, sessionType, driver1),
      api.getTelemetrySpeedTrace(raceYear, raceEvent, sessionType, driver2),
      api.getTelemetrySectors(raceYear, raceEvent, sessionType, driver1),
      api.getTelemetrySectors(raceYear, raceEvent, sessionType, driver2),
      api.getTelemetryPositions(raceYear, raceEvent, sessionType, driver1),
      api.getTelemetryPositions(raceYear, raceEvent, sessionType, driver2),
      api.getTelemetryTireStrategy(raceYear, raceEvent, sessionType, driver1),
      api.getTelemetryTireStrategy(raceYear, raceEvent, sessionType, driver2),
      api.getTelemetryDrivingData(raceYear, raceEvent, sessionType, driver1),
      api.getTelemetryDrivingData(raceYear, raceEvent, sessionType, driver2),
      api.getTelemetryCompare(raceYear, raceEvent, sessionType, [driver1, driver2], "gap"),
      api.getTelemetrySpeedTraps(raceYear, raceEvent, sessionType, driver1),
      api.getTelemetrySpeedTraps(raceYear, raceEvent, sessionType, driver2),
    ]);

    const get = <T,>(i: number, fallback: T): T => {
      const r = results[i];
      return r.status === "fulfilled" ? r.value as T : fallback;
    };

    setLapTimes1(get(0, []));
    setLapTimes2(get(1, []));
    const st1 = get(2, { points: [] as SpeedTracePoint[] });
    const st2 = get(3, { points: [] as SpeedTracePoint[] });
    setSpeed1((st1 as { points: SpeedTracePoint[] }).points || []);
    setSpeed2((st2 as { points: SpeedTracePoint[] }).points || []);
    setSectors1(get(4, []));
    setSectors2(get(5, []));
    setPos1(get(6, []));
    setPos2(get(7, []));
    setStints1(get(8, []));
    setStints2(get(9, []));
    const tl1 = get(10, { points: [] as TelemetryPoint[] });
    const tl2 = get(11, { points: [] as TelemetryPoint[] });
    setTel1((tl1 as { points: TelemetryPoint[] }).points || []);
    setTel2((tl2 as { points: TelemetryPoint[] }).points || []);
    const gapData = get(12, { points: [] as GapPoint[] }) as { points?: GapPoint[] };
    setGap(gapData.points ?? []);
    setSpeedTraps1(get(13, []));
    setSpeedTraps2(get(14, []));

    setLoading(false);
    setHasLoaded(true);
  };

  const maxLaps = Math.max(
    lapTimes1.length > 0 ? Math.max(...lapTimes1.map((l) => l.lap_number)) : 0,
    lapTimes2.length > 0 ? Math.max(...lapTimes2.map((l) => l.lap_number)) : 0,
  );

  return (
    <div className="space-y-6">
      {/* Two driver selectors */}
      <div className="glass-card rounded-2xl p-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-2 block">Driver 1</label>
            <select value={driver1} onChange={(e) => setDriver1(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-white/5 border border-white/10 text-white outline-none">
              <option value="" className="bg-gray-900">Choose driver...</option>
              {Array.from(driversByConstructor.entries()).map(([team, teamDrivers]) => (
                <optgroup key={team} label={team}>
                  {teamDrivers.map((d) => (
                    <option key={d.code} value={d.code} className="bg-gray-900">{d.code} - {d.first_name} {d.last_name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-2 block">Driver 2</label>
            <select value={driver2} onChange={(e) => setDriver2(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-white/5 border border-white/10 text-white outline-none">
              <option value="" className="bg-gray-900">Choose driver...</option>
              {Array.from(driversByConstructor.entries()).map(([team, teamDrivers]) => (
                <optgroup key={team} label={team}>
                  {teamDrivers.map((d) => (
                    <option key={d.code} value={d.code} className="bg-gray-900">{d.code} - {d.first_name} {d.last_name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        </div>
        <button
          onClick={loadCompare}
          disabled={!driver1 || !driver2 || driver1 === driver2 || !raceEvent || loading}
          className="px-6 py-2.5 rounded-xl text-xs font-bold text-white transition-all disabled:opacity-30"
          style={{ background: driver1 && driver2 && driver1 !== driver2 && raceEvent ? "var(--f1-red)" : "var(--card-border)" }}
        >
          {loading ? "Loading Comparison..." : "Compare"}
        </button>
      </div>

      {/* Compare Charts */}
      {(loading || hasLoaded) && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
          {/* Speed Trace Overlay */}
          <ChartCard title="Speed Trace Overlay" tooltip="Both drivers' speed profiles overlaid">
            <SpeedTraceChart data={speed1} data2={speed2} driver1Color={color1} driver2Color={color2}
              driver1Name={driver1} driver2Name={driver2} loading={loading} />
          </ChartCard>

          {/* Lap Times | Gap Analysis */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartCard title="Lap Time Comparison" tooltip="Lap times for both drivers on same chart">
              <LapTimeChart data={lapTimes1} data2={lapTimes2} driver1Color={color1} driver2Color={color2} loading={loading} />
            </ChartCard>
            <ChartCard title="Gap Analysis" tooltip="Time delta between drivers over lap distance (negative = Driver 1 ahead)">
              <GapAnalysisChart data={gap} driver1Name={driver1} driver2Name={driver2} loading={loading} />
            </ChartCard>
          </div>

          {/* Position Battle | Sector Comparison */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartCard title="Position Battle" tooltip="Both drivers' position progression">
              <PositionChart data={pos1} data2={pos2} driver1Color={color1} driver2Color={color2} loading={loading} />
            </ChartCard>
            <ChartCard title="Speed Traps" tooltip="Speed comparison at measurement points">
              <SpeedTrapChart data={speedTraps1} data2={speedTraps2} driver1Color={color1} driver2Color={color2}
                driver1Name={driver1} driver2Name={driver2} loading={loading} />
            </ChartCard>
          </div>

          {/* Tire Strategy Comparison */}
          <ChartCard title="Tire Strategy Comparison" tooltip="Stint breakdown for both drivers">
            <TireStrategyChart stints={stints1} stints2={stints2} driver1Name={driver1} driver2Name={driver2}
              totalLaps={maxLaps || undefined} loading={loading} />
          </ChartCard>

          {/* Telemetry Overlay */}
          <ChartCard title="Telemetry Overlay" tooltip="Speed, throttle and brake comparison">
            <TelemetryTraceChart data={tel1} data2={tel2} driver1Color={color1} driver2Color={color2} loading={loading} />
          </ChartCard>
        </motion.div>
      )}

      {!loading && !hasLoaded && (
        <div className="text-center py-20">
          <p className="text-sm text-gray-500">Select two drivers and click Compare to view telemetry overlay</p>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Shared components
// ════════════════════════════════════════════════════════════════════
function DriverSelector({
  driversByConstructor,
  selectedIds,
  maxDrivers,
  onToggle,
  onClear,
}: {
  driversByConstructor: Map<string, Driver[]>;
  selectedIds: number[];
  maxDrivers: number;
  onToggle: (id: number) => void;
  onClear: () => void;
}) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.05 }} className="glass-card rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs font-bold uppercase tracking-widest text-gray-500">
          Select Drivers ({selectedIds.length}/{maxDrivers})
        </h2>
        {selectedIds.length > 0 && (
          <button onClick={onClear} className="text-[10px] uppercase tracking-widest text-gray-500 hover:text-white transition-colors">Clear</button>
        )}
      </div>
      <div className="space-y-3">
        {Array.from(driversByConstructor.entries()).map(([constructorName, teamDrivers]) => (
          <div key={constructorName}>
            <div className="text-[10px] uppercase tracking-widest font-semibold mb-1.5"
              style={{ color: teamDrivers[0]?.constructor_color ?? "#6b7280" }}>{constructorName}</div>
            <div className="flex flex-wrap gap-2">
              {teamDrivers.map((d) => {
                const isSelected = selectedIds.includes(d.id);
                const isDisabled = !isSelected && selectedIds.length >= maxDrivers;
                return (
                  <motion.button key={d.id} whileHover={{ scale: isDisabled ? 1 : 1.05 }} whileTap={{ scale: isDisabled ? 1 : 0.95 }}
                    onClick={() => !isDisabled && onToggle(d.id)} disabled={isDisabled}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                    style={{
                      background: isSelected ? `${d.constructor_color}25` : "var(--surface)",
                      border: isSelected ? `1.5px solid ${d.constructor_color}` : "1.5px solid var(--card-border)",
                      color: isSelected ? d.constructor_color : "#9ca3af",
                    }}>
                    <div className="w-1.5 h-4 rounded-full" style={{ backgroundColor: d.constructor_color }} />
                    {d.code}
                    <span className="font-mono text-[10px] opacity-60">${d.price}m</span>
                  </motion.button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

function ChartCard({ title, tooltip, children }: { title: string; tooltip: string; children: React.ReactNode }) {
  return (
    <div className="glass-card rounded-2xl p-5 relative overflow-hidden">
      <div className="racing-stripe" />
      <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-4 inline-flex items-center gap-1">
        {title}
        <InfoTooltip text={tooltip} />
      </h3>
      {children}
    </div>
  );
}
