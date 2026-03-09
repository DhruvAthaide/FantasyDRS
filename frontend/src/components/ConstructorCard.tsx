"use client";

import { motion } from "framer-motion";
import type { Constructor } from "@/types";

interface ConstructorCardProps {
  constructor: Constructor;
  selected?: boolean;
  onSelect?: () => void;
  compact?: boolean;
}

export default function ConstructorCard({
  constructor,
  selected = false,
  onSelect,
  compact = false,
}: ConstructorCardProps) {
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
      <div
        className="absolute top-0 left-0 w-full h-[2px]"
        style={{ backgroundColor: constructor.color, opacity: selected ? 1 : 0.4 }}
      />

      <div className={compact ? "p-2.5" : "p-3.5"}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center"
              style={{
                backgroundColor: `${constructor.color}18`,
                border: `1px solid ${constructor.color}30`,
              }}
            >
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: constructor.color }} />
            </div>
            <div>
              <div className={`font-bold tracking-tight ${compact ? "text-xs" : "text-sm"}`}>
                {constructor.name}
              </div>
              {!compact && (
                <p className="text-[11px] text-gray-500 mt-0.5">
                  {constructor.driver_codes.join(" \u00B7 ")}
                </p>
              )}
            </div>
          </div>
          <div className="text-right">
            <div className={`font-mono font-semibold ${compact ? "text-xs" : "text-sm"}`}>
              ${constructor.price}M
            </div>
            {constructor.expected_pts !== null && constructor.expected_pts !== undefined && (
              <div className="text-[11px] font-mono text-emerald-400 mt-0.5">
                {constructor.expected_pts.toFixed(1)} pts
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
