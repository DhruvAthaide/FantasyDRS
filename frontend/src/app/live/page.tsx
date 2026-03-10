"use client";

import { motion } from "framer-motion";

export default function LiveScoringPage() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="glass-card p-8 text-center max-w-md"
      >
        <div className="text-4xl mb-4">🏎️</div>
        <h1 className="text-xl font-bold mb-2">Live Scoring</h1>
        <p className="text-sm" style={{ color: "rgba(255,255,255,0.5)" }}>
          Real-time race scoring is coming soon. Check back during a race weekend for live point tracking.
        </p>
      </motion.div>
    </div>
  );
}
