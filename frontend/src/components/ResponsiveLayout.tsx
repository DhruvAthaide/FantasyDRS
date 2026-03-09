"use client";

import { useState } from "react";
import Sidebar from "@/components/Sidebar";
import MobileDrawer from "@/components/MobileDrawer";

export default function ResponsiveLayout({ children }: { children: React.ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Desktop sidebar */}
      <div className="hidden lg:block">
        <Sidebar />
      </div>

      {/* Mobile drawer */}
      <MobileDrawer isOpen={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <Sidebar onClose={() => setDrawerOpen(false)} />
      </MobileDrawer>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        {/* Mobile header */}
        <div className="lg:hidden sticky top-0 z-30 flex items-center gap-3 px-4 py-3" style={{ background: "var(--surface)", borderBottom: "1px solid var(--card-border)" }}>
          <button
            onClick={() => setDrawerOpen(true)}
            className="p-2 rounded-lg hover:bg-white/5 transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md flex items-center justify-center font-black text-white text-[8px] tracking-tighter"
              style={{ background: "linear-gradient(135deg, #e10600, #b30500)" }}
            >
              PW
            </div>
            <span className="text-sm font-bold text-white">PitWall</span>
          </div>
        </div>
        <div className="p-4 md:p-6 lg:p-8 max-w-[1400px] mx-auto">{children}</div>
      </main>
    </div>
  );
}
