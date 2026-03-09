"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { api } from "@/lib/api";
import { getMyTeam } from "@/lib/storage";
import type { Race, Driver, Constructor } from "@/types";
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

const quickActions = [
  { href: "/", label: "Run Simulation", icon: "M13 10V3L4 14h7v7l9-11h-7z", color: "#e10600" },
  { href: "/transfers", label: "Check Transfers", icon: "M17 1l4 4-4 4M3 11V9a4 4 0 014-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 01-4 4H3", color: "#3b82f6" },
  { href: "/chips", label: "Review Chips", icon: "M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5", color: "#a855f7" },
  { href: "/my-team", label: "My Team", icon: "M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z", color: "#22c55e" },
];

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

  const countdown = useCountdown(nextRace?.date || "2026-03-08");
  const isRaceComplete = countdown.days === 0 && countdown.hours === 0 && countdown.mins === 0 && countdown.secs === 0;

  const teamDrivers = myTeam ? drivers.filter((d) => myTeam.driver_ids.includes(d.id)) : [];
  const teamConstructors = myTeam ? constructors.filter((c) => myTeam.constructor_ids.includes(c.id)) : [];
  const teamCost = teamDrivers.reduce((s, d) => s + d.price, 0) + teamConstructors.reduce((s, c) => s + c.price, 0);
  const drsDriver = myTeam ? drivers.find((d) => d.id === myTeam.drs_driver_id) : null;

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

      {/* Next Race + Countdown */}
      {nextRace && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
          className="rounded-2xl p-5 sm:p-6 relative overflow-hidden"
          style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}
        >
          <div className="absolute top-0 right-0 w-32 h-32 opacity-5" style={{ background: "radial-gradient(circle, var(--f1-red) 0%, transparent 70%)" }} />

          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold">Round {nextRace.round}</span>
                {nextRace.has_sprint && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-400">SPRINT</span>
                )}
              </div>
              <h2 className="text-xl sm:text-2xl font-black">{nextRace.name}</h2>
              <p className="text-sm text-gray-400 mt-0.5">{nextRace.circuit_name} — {nextRace.country}</p>
              <p className="text-xs text-gray-500 mt-1">{new Date(nextRace.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</p>
            </div>

            {isRaceComplete ? (
              <div className="flex flex-col items-end gap-2">
                <span className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                  RACE COMPLETE
                </span>
                <Link href="/results" className="text-xs font-semibold hover:underline" style={{ color: "var(--f1-red)" }}>
                  View Results →
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

      {/* Race Info + Quick Actions grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Race Info Card */}
        {nextRace && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
            className="rounded-2xl p-5" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}
          >
            <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3">Circuit Info</h3>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Laps", value: String(nextRace.laps) },
                { label: "DRS Zones", value: String(nextRace.drs_zones) },
                { label: "Overtake Difficulty", value: nextRace.overtake_difficulty <= 0.3 ? "Easy" : nextRace.overtake_difficulty <= 0.6 ? "Medium" : "Hard" },
                { label: "Circuit Type", value: nextRace.circuit_name.includes("Street") || nextRace.overtake_difficulty >= 0.8 ? "Street" : "Permanent" },
              ].map((item) => (
                <div key={item.label} className="rounded-xl p-3" style={{ background: "var(--surface)" }}>
                  <div className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold">{item.label}</div>
                  <div className="text-sm font-bold mt-0.5">{item.value}</div>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Quick Actions */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
          className="rounded-2xl p-5" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}
        >
          <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3">Quick Actions</h3>
          <div className="grid grid-cols-2 gap-2">
            {quickActions.map((action) => (
              <Link key={action.href} href={action.href}>
                <div className="rounded-xl p-3 flex items-center gap-2.5 transition-all hover:scale-[1.02] cursor-pointer"
                  style={{ background: "var(--surface)", border: "1px solid var(--card-border)" }}
                >
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${action.color}20` }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={action.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d={action.icon} />
                    </svg>
                  </div>
                  <span className="text-xs font-semibold">{action.label}</span>
                </div>
              </Link>
            ))}
          </div>
        </motion.div>
      </div>

      {/* My Team Summary */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
        className="rounded-2xl p-5" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}
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
              Set up your team →
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {teamDrivers.map((d) => (
                <div key={d.id} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold"
                  style={{ background: `${d.constructor_color}15`, border: `1px solid ${d.constructor_color}30` }}
                >
                  <div className="w-1.5 h-4 rounded-full" style={{ backgroundColor: d.constructor_color }} />
                  <span>{d.code}</span>
                  {d.id === myTeam.drs_driver_id && (
                    <span className="text-[9px] font-bold px-1 rounded" style={{ background: "var(--f1-red)", color: "white" }}>DRS</span>
                  )}
                  <span className="text-gray-500 font-mono text-[10px]">${d.price}M</span>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {teamConstructors.map((c) => (
                <div key={c.id} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold"
                  style={{ background: `${c.color}15`, border: `1px solid ${c.color}30`, color: c.color }}
                >
                  {c.name}
                  <span className="text-gray-500 font-mono text-[10px]">${c.price}M</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </motion.div>

      {/* Upcoming Races */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}
        className="rounded-2xl p-5" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}
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
                <span className="ml-1.5 text-[9px] font-bold text-amber-400">SPRINT</span>
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
