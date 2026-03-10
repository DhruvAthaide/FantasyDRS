"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { api } from "@/lib/api";
import { useFreshness } from "@/hooks/useFreshness";
import { getMyTeam } from "@/lib/storage";
import StrategyBrief from "@/components/StrategyBrief";
import type { Race, Driver, Constructor, SimulationResult } from "@/types";
import type { SavedTeam } from "@/lib/storage";

function useCountdown(targetDate: string) {
  const [timeLeft, setTimeLeft] = useState({ days: 0, hours: 0, mins: 0, secs: 0 });

  useEffect(() => {
    const target = new Date(targetDate + "T14:00:00Z").getTime();
    const tick = () => {
      const diff = Math.max(0, target - Date.now());
      setTimeLeft({
        days: Math.floor(diff / 86400000),
        hours: Math.floor((diff % 86400000) / 3600000),
        mins: Math.floor((diff % 3600000) / 60000),
        secs: Math.floor((diff % 60000) / 1000),
      });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [targetDate]);

  return timeLeft;
}

function CountdownUnit({ value, label }: { value: number; label: string }) {
  return (
    <div className="text-center">
      <div className="text-2xl sm:text-3xl font-black font-mono tabular-nums" style={{ color: "var(--f1-red)" }}>
        {String(value).padStart(2, "0")}
      </div>
      <div className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mt-0.5">{label}</div>
    </div>
  );
}

function PredictionCard({ title, subtitle, value, color, icon }: {
  title: string; subtitle: string; value: string; color: string; icon: string;
}) {
  return (
    <div className="glass-card p-4 relative overflow-hidden">
      <div className="absolute top-0 right-0 w-20 h-20 opacity-[0.06]"
        style={{ background: `radial-gradient(circle, ${color}, transparent 70%)` }}
      />
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: `${color}15`, border: `1px solid ${color}30` }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d={icon} />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{title}</p>
          <p className="text-sm font-bold mt-0.5 truncate">{subtitle}</p>
          <p className="text-xs font-mono mt-0.5" style={{ color }}>{value}</p>
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [nextRace, setNextRace] = useState<Race | null>(null);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [constructors, setConstructors] = useState<Constructor[]>([]);
  const [loading, setLoading] = useState(true);
  const [myTeam, setMyTeam] = useState<SavedTeam | null>(null);

  useEffect(() => {
    setMyTeam(getMyTeam());
    Promise.all([api.getNextRace(), api.getDrivers(), api.getConstructors()])
      .then(([race, d, c]) => {
        setNextRace(race);
        setDrivers(d);
        setConstructors(c);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const { results: simResults, timeSinceUpdate, hasCachedData, dataSources, hasQualifying, hasLongRuns, weather } = useFreshness(nextRace?.id ?? null);

  const countdown = useCountdown(nextRace?.date || "2026-03-08");
  const isRaceComplete = countdown.days === 0 && countdown.hours === 0 && countdown.mins === 0 && countdown.secs === 0;

  // Derive predictions from cached sim results
  const driverSims = simResults.filter((r: SimulationResult) => r.asset_type === "driver").sort((a: SimulationResult, b: SimulationResult) => b.expected_pts_mean - a.expected_pts_mean);
  const topDriver = driverSims[0];
  const bestValue = [...driverSims].sort((a: SimulationResult, b: SimulationResult) => b.points_per_million - a.points_per_million)[0];
  const mostVolatile = [...driverSims].sort((a: SimulationResult, b: SimulationResult) => b.expected_pts_std - a.expected_pts_std)[0];

  const teamDrivers = myTeam ? drivers.filter((d) => myTeam.driver_ids.includes(d.id)) : [];
  const teamConstructors = myTeam ? constructors.filter((c) => myTeam.constructor_ids.includes(c.id)) : [];
  const teamCost = teamDrivers.reduce((s, d) => s + d.price, 0) + teamConstructors.reduce((s, c) => s + c.price, 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="w-6 h-6 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl sm:text-3xl font-black tracking-tight">Race Hub</h1>
        <p className="text-xs sm:text-sm text-gray-500 mt-1">Your command center for race weekends</p>
      </motion.div>

      {/* Next Race Hero + Countdown */}
      {nextRace && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
          className="glass-card rounded-2xl p-5 sm:p-6 relative overflow-hidden"
        >
          <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: "linear-gradient(90deg, var(--f1-red), var(--neon-purple), transparent)" }} />
          <div className="absolute top-0 right-0 w-48 h-48 opacity-[0.04]" style={{ background: "radial-gradient(circle, var(--f1-red) 0%, transparent 70%)" }} />

          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold">Round {nextRace.round}</span>
                {nextRace.has_sprint && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold" style={{ background: "rgba(255, 208, 0, 0.15)", color: "var(--timing-yellow)", border: "1px solid rgba(255, 208, 0, 0.3)" }}>SPRINT</span>
                )}
              </div>
              <h2 className="text-xl sm:text-2xl font-black">{nextRace.name}</h2>
              <p className="text-sm text-gray-400 mt-0.5">{nextRace.circuit_name} — {nextRace.country}</p>
              <p className="text-xs text-gray-500 mt-1">{new Date(nextRace.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</p>
              {timeSinceUpdate !== null && (
                <p className="text-[10px] font-mono mt-2" style={{ color: "var(--neon-cyan)" }}>
                  Predictions updated {timeSinceUpdate < 1 ? "just now" : `${timeSinceUpdate}min ago`}
                </p>
              )}
              {hasCachedData && (
                <div className="flex flex-wrap items-center gap-2 mt-1.5">
                  {weather && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono" style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.5)" }}>
                      {weather.rainfall ? "🌧" : "☀"} {Math.round(weather.track_temp)}°C track
                      {weather.wind_speed > 0 && ` · ${weather.wind_speed.toFixed(0)}km/h wind`}
                    </span>
                  )}
                  {dataSources.length > 0 && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono" style={{ background: hasQualifying ? "rgba(0,255,135,0.08)" : "rgba(255,255,255,0.05)", color: hasQualifying ? "var(--neon-green)" : "rgba(255,255,255,0.4)" }}>
                      {hasQualifying ? "Quali data" : hasLongRuns ? "Practice data" : "Defaults"}
                    </span>
                  )}
                </div>
              )}
            </div>

            {isRaceComplete ? (
              <div className="flex flex-col items-end gap-2">
                <span className="status-auto px-3 py-1.5 rounded-lg text-xs font-bold">RACE COMPLETE</span>
                <Link href="/results" className="text-xs font-semibold hover:underline" style={{ color: "var(--f1-red)" }}>
                  View Results
                </Link>
              </div>
            ) : (
              <div className="flex gap-4 sm:gap-5">
                <CountdownUnit value={countdown.days} label="Days" />
                <span className="text-2xl font-black text-gray-600 self-start mt-0.5">:</span>
                <CountdownUnit value={countdown.hours} label="Hrs" />
                <span className="text-2xl font-black text-gray-600 self-start mt-0.5">:</span>
                <CountdownUnit value={countdown.mins} label="Min" />
                <span className="text-2xl font-black text-gray-600 self-start mt-0.5">:</span>
                <CountdownUnit value={countdown.secs} label="Sec" />
              </div>
            )}
          </div>
        </motion.div>
      )}

      {/* Prediction Cards */}
      {hasCachedData && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3"
        >
          {topDriver && (
            <PredictionCard
              title="Predicted Winner"
              subtitle={topDriver.asset_name}
              value={`${topDriver.expected_pts_mean.toFixed(1)} xPts`}
              color="var(--neon-green)"
              icon="M5 3l14 9-14 9V3z"
            />
          )}
          {bestValue && (
            <PredictionCard
              title="Best Value"
              subtitle={bestValue.asset_name}
              value={`${bestValue.points_per_million.toFixed(2)} PPM`}
              color="var(--neon-cyan)"
              icon="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"
            />
          )}
          {topDriver && (
            <PredictionCard
              title="DRS Pick"
              subtitle={topDriver.asset_name}
              value={`2x = ${(topDriver.expected_pts_mean * 2).toFixed(1)} xPts`}
              color="var(--neon-purple)"
              icon="M13 2L3 14h9l-1 8 10-12h-9l1-8z"
            />
          )}
          {mostVolatile && (
            <PredictionCard
              title="Danger Zone"
              subtitle={mostVolatile.asset_name}
              value={`${mostVolatile.expected_pts_p10.toFixed(1)} - ${mostVolatile.expected_pts_p90.toFixed(1)} range`}
              color="var(--f1-red)"
              icon="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
            />
          )}
        </motion.div>
      )}

      {/* Strategy Brief + Quick Predictions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Strategy Brief */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          <StrategyBrief raceId={nextRace?.id ?? null} compact />
        </motion.div>

        {/* Quick Predictions - Top 5 */}
        {hasCachedData && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
            className="glass-card p-5"
          >
            <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3">Top 5 Predictions</h3>
            <div className="space-y-2.5">
              {driverSims.slice(0, 5).map((sim: SimulationResult, i: number) => {
                const maxPts = driverSims[0]?.expected_pts_mean || 1;
                const pct = (sim.expected_pts_mean / maxPts) * 100;
                return (
                  <div key={sim.asset_id} className="flex items-center gap-3">
                    <span className={`text-[11px] font-bold w-5 text-center ${i === 0 ? "text-amber-400" : i === 1 ? "text-gray-400" : i === 2 ? "text-orange-600" : "text-gray-600"}`}>
                      {i + 1}
                    </span>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-semibold">{sim.asset_name}</span>
                        <span className="text-xs font-mono" style={{ color: "var(--neon-green)" }}>{sim.expected_pts_mean.toFixed(1)}</span>
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--surface)" }}>
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${pct}%` }}
                          transition={{ delay: 0.3 + i * 0.05, duration: 0.5 }}
                          className="h-full rounded-full"
                          style={{ background: i === 0 ? "var(--neon-green)" : i < 3 ? "var(--neon-cyan)" : "var(--f1-red)" }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <Link href="/" className="block mt-3 text-[11px] font-semibold text-center" style={{ color: "var(--f1-red)" }}>
              Open Team Calculator
            </Link>
          </motion.div>
        )}
      </div>

      {/* Circuit Info + Race Info */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {nextRace && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
            className="glass-card p-5"
          >
            <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3">Circuit Traits</h3>
            <div className="space-y-3">
              {[
                { label: "Overtake Difficulty", value: nextRace.overtake_difficulty, color: nextRace.overtake_difficulty > 0.6 ? "var(--f1-red)" : "var(--neon-green)" },
                { label: "Laps", value: nextRace.laps / 78, color: "var(--neon-cyan)", display: String(nextRace.laps) },
                { label: "DRS Zones", value: nextRace.drs_zones / 4, color: "var(--neon-purple)", display: String(nextRace.drs_zones) },
              ].map((trait) => (
                <div key={trait.label}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] text-gray-500">{trait.label}</span>
                    <span className="text-[11px] font-mono" style={{ color: trait.color }}>
                      {trait.display || `${(trait.value * 100).toFixed(0)}%`}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--surface)" }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${trait.value * 100}%`, background: trait.color }} />
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* My Team Summary */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
          className="glass-card p-5"
        >
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500">My Team</h3>
            {myTeam && (
              <span className="text-xs font-mono text-gray-400">${teamCost.toFixed(1)}M</span>
            )}
          </div>

          {!myTeam ? (
            <div className="text-center py-6">
              <p className="text-sm text-gray-500 font-medium">No team saved yet</p>
              <Link href="/my-team" className="text-xs font-semibold mt-1 inline-block" style={{ color: "var(--f1-red)" }}>
                Set up your team
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {teamDrivers.map((d) => (
                  <div key={d.id} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold"
                    style={{ background: `${d.constructor_color}12`, border: `1px solid ${d.constructor_color}25` }}
                  >
                    <div className="w-1.5 h-4 rounded-full" style={{ backgroundColor: d.constructor_color }} />
                    <span>{d.code}</span>
                    {d.id === myTeam.drs_driver_id && (
                      <span className="text-[9px] font-bold px-1 rounded" style={{ background: "var(--neon-purple)", color: "white" }}>DRS</span>
                    )}
                    <span className="text-gray-500 font-mono text-[10px]">${d.price}M</span>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {teamConstructors.map((c) => (
                  <div key={c.id} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold"
                    style={{ background: `${c.color}12`, border: `1px solid ${c.color}25`, color: c.color }}
                  >
                    {c.name}
                    <span className="text-gray-500 font-mono text-[10px]">${c.price}M</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </motion.div>
      </div>

      {/* Upcoming Races */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}
        className="glass-card p-5"
      >
        <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3">Upcoming Races</h3>
        <UpcomingRaces />
      </motion.div>
    </div>
  );
}

function UpcomingRaces() {
  const [races, setRaces] = useState<Race[]>([]);

  useEffect(() => {
    api.getRaces().then(setRaces).catch(() => {});
  }, []);

  const today = new Date().toISOString().split("T")[0];
  const upcoming = races.filter((r) => r.date >= today).slice(0, 5);

  if (upcoming.length === 0) {
    return <p className="text-xs text-gray-500">No upcoming races</p>;
  }

  return (
    <div className="space-y-2">
      {upcoming.map((race, i) => (
        <div key={race.id} className="flex items-center justify-between py-2 px-3 rounded-xl transition-colors"
          style={{ background: i === 0 ? "rgba(225,6,0,0.06)" : "transparent", border: i === 0 ? "1px solid rgba(225,6,0,0.15)" : "1px solid transparent" }}
        >
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-bold text-gray-600 w-6">R{race.round}</span>
            <div>
              <span className="text-sm font-semibold">{race.name.replace(" Grand Prix", " GP")}</span>
              {race.has_sprint && (
                <span className="ml-1.5 text-[9px] font-bold" style={{ color: "var(--timing-yellow)" }}>SPRINT</span>
              )}
            </div>
          </div>
          <span className="text-[11px] text-gray-500 font-mono">
            {new Date(race.date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </span>
        </div>
      ))}
    </div>
  );
}
