"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";

const dashboardItems = [
  {
    href: "/dashboard",
    label: "Race Hub",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
        <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
      </svg>
    ),
  },
];

const toolItems = [
  {
    href: "/",
    label: "Team Calculator",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    href: "/budget",
    label: "Budget Builder",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
    ),
  },
  {
    href: "/statistics",
    label: "Statistics",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 20V10M12 20V4M6 20v-6" />
      </svg>
    ),
  },
  {
    href: "/live",
    label: "Live Scoring",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polygon points="10 8 16 12 10 16 10 8" />
      </svg>
    ),
  },
];

const strategyItems = [
  {
    href: "/my-team",
    label: "My Team",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      </svg>
    ),
  },
  {
    href: "/drs-analysis",
    label: "DRS Analysis",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
      </svg>
    ),
  },
  {
    href: "/chips",
    label: "Chip Planner",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
      </svg>
    ),
  },
  {
    href: "/transfers",
    label: "Transfers",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="17 1 21 5 17 9" />
        <path d="M3 11V9a4 4 0 0 1 4-4h14" />
        <polyline points="7 23 3 19 7 15" />
        <path d="M21 13v2a4 4 0 0 1-4 4H3" />
      </svg>
    ),
  },
  {
    href: "/penalties",
    label: "Penalties",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    ),
  },
  {
    href: "/league",
    label: "Mini League",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5C7 4 6 9 6 9z" />
        <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5C17 4 18 9 18 9z" />
        <path d="M4 22h16" />
        <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
        <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
        <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
      </svg>
    ),
  },
];

const historyItems = [
  {
    href: "/results",
    label: "Results",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
      </svg>
    ),
  },
  {
    href: "/season",
    label: "Season Tracker",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
  },
  {
    href: "/what-if",
    label: "What If",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    ),
  },
];

interface SidebarProps {
  onClose?: () => void;
}

function NavItem({ item, pathname, onClose }: { item: typeof toolItems[0]; pathname: string; onClose?: () => void }) {
  const isActive = pathname === item.href;
  return (
    <Link href={item.href} className="block relative" onClick={onClose}>
      <motion.div
        className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] transition-colors relative ${
          isActive ? "text-white font-medium" : "text-gray-500 hover:text-gray-300"
        }`}
        whileHover={{ x: 2 }}
        transition={{ duration: 0.15 }}
      >
        {isActive && (
          <motion.div
            layoutId="sidebar-active"
            className="absolute inset-0 rounded-xl"
            style={{ background: "rgba(225, 6, 0, 0.12)", border: "1px solid rgba(225, 6, 0, 0.2)" }}
            transition={{ type: "spring", duration: 0.4, bounce: 0.15 }}
          />
        )}
        <span className={`relative z-10 ${isActive ? "text-red-400" : ""}`}>
          {item.icon}
        </span>
        <span className="relative z-10">{item.label}</span>
      </motion.div>
    </Link>
  );
}

export default function Sidebar({ onClose }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside
      className="w-[240px] sm:w-[280px] lg:w-[240px] h-full flex flex-col border-r"
      style={{ background: "var(--surface)", borderColor: "var(--card-border)" }}
    >
      {/* Logo */}
      <div className="p-6 pb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center font-black text-white text-[10px] tracking-tighter"
            style={{ background: "linear-gradient(135deg, #e10600, #b30500)" }}
          >
            PW
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-white">PitWall</h1>
            <p className="text-[10px] uppercase tracking-[0.2em] text-gray-500 font-medium">F1 Fantasy</p>
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} className="lg:hidden p-1.5 rounded-lg hover:bg-white/5 transition-colors">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto">
        {dashboardItems.map((item) => (
          <NavItem key={item.href} item={item} pathname={pathname} onClose={onClose} />
        ))}

        <div className="pt-3 pb-1">
          <p className="text-[10px] uppercase tracking-[0.15em] text-gray-600 font-semibold px-3 mb-2">
            Tools
          </p>
        </div>
        {toolItems.map((item) => (
          <NavItem key={item.href} item={item} pathname={pathname} onClose={onClose} />
        ))}

        <div className="pt-4 pb-1">
          <p className="text-[10px] uppercase tracking-[0.15em] text-gray-600 font-semibold px-3 mb-2">
            Strategy
          </p>
        </div>
        {strategyItems.map((item) => (
          <NavItem key={item.href} item={item} pathname={pathname} onClose={onClose} />
        ))}

        <div className="pt-4 pb-1">
          <p className="text-[10px] uppercase tracking-[0.15em] text-gray-600 font-semibold px-3 mb-2">
            History
          </p>
        </div>
        {historyItems.map((item) => (
          <NavItem key={item.href} item={item} pathname={pathname} onClose={onClose} />
        ))}
      </nav>

      {/* Footer */}
      <div className="p-4 m-3 mt-0 rounded-xl" style={{ background: "var(--card-bg)" }}>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-500 pulse-glow" />
          <span className="text-[11px] text-gray-400 font-medium">2026 Season</span>
        </div>
        <p className="text-[10px] text-gray-600 mt-1">
          R1: Australian GP - Mar 8
        </p>
      </div>
    </aside>
  );
}
