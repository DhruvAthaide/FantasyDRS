"use client";

import { motion } from "framer-motion";
import type { Driver } from "@/types";

interface DriverCardProps {
  driver: Driver;
  selected?: boolean;
  isDrsBoost?: boolean;
  onSelect?: () => void;
  onDrsBoost?: () => void;
  compact?: boolean;
}

export default function DriverCard({
  driver,
  selected = false,
  isDrsBoost = false,
  onSelect,
  onDrsBoost,
  compact = false,
}: DriverCardProps) {
  return (
    <motion.div
      onClick={onSelect}
      whileHover={{ scale: 1.02, y: -1 }}
      whileTap={{ scale: 0.98 }}
      transition={{ duration: 0.15 }}
      className={`relative rounded-xl cursor-pointer overflow-hidden ${selected ? "glow-red" : ""}`}
      style={{
        background: selected ? "var(--card-hover)" : "var(--card-bg)",
        border: `1px solid ${selected ? "var(--f1-red)" : "var(--card-border)"}`,
      }}
    >
      {/* Team color top accent */}
      <div
        className="absolute top-0 left-0 w-full h-[2px]"
        style={{ backgroundColor: driver.constructor_color, opacity: selected ? 1 : 0.4 }}
      />

      <div className={compact ? "p-2.5" : "p-3.5"}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center font-bold text-xs driver-number"
              style={{
                backgroundColor: `${driver.constructor_color}18`,
                color: driver.constructor_color,
                border: `1px solid ${driver.constructor_color}30`,
              }}
            >
              {driver.number}
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className={`font-bold tracking-tight ${compact ? "text-xs" : "text-sm"}`}>
                  {driver.code}
                </span>
                {isDrsBoost && (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-purple-600 text-white uppercase tracking-wider">
                    2x
                  </span>
                )}
              </div>
              {!compact && (
                <p className="text-[11px] text-gray-500 mt-0.5">
                  {driver.first_name} {driver.last_name}
                </p>
              )}
            </div>
          </div>
          <div className="text-right">
            <div className={`font-mono font-semibold ${compact ? "text-xs" : "text-sm"}`}>
              ${driver.price}M
            </div>
            {driver.expected_pts !== null && driver.expected_pts !== undefined && (
              <div className="text-[11px] font-mono text-emerald-400 mt-0.5">
                {driver.expected_pts.toFixed(1)} pts
              </div>
            )}
          </div>
        </div>

        {!compact && (
          <div className="flex items-center justify-between mt-3 pt-2.5" style={{ borderTop: "1px solid var(--card-border)" }}>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: driver.constructor_color }} />
              <span className="text-[11px] text-gray-500">{driver.constructor_name}</span>
            </div>
            {onDrsBoost && selected && (
              <motion.button
                onClick={(e) => { e.stopPropagation(); onDrsBoost(); }}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className={`text-[10px] font-semibold px-2.5 py-1 rounded-lg uppercase tracking-wider transition-colors ${
                  isDrsBoost
                    ? "bg-purple-600 text-white shadow-lg shadow-purple-600/30"
                    : "text-gray-500 hover:text-purple-400"
                }`}
                style={!isDrsBoost ? { background: "var(--card-bg)", border: "1px solid var(--card-border)" } : {}}
              >
                {isDrsBoost ? "DRS Active" : "Set DRS"}
              </motion.button>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
