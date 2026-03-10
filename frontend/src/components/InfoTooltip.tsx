"use client";

import { useState, useRef, useEffect } from "react";

interface InfoTooltipProps {
  text: string;
  children?: React.ReactNode;
}

export default function InfoTooltip({ text, children }: InfoTooltipProps) {
  const [show, setShow] = useState(false);
  const [position, setPosition] = useState<"top" | "bottom">("top");
  const triggerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (show && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPosition(rect.top < 100 ? "bottom" : "top");
    }
  }, [show]);

  return (
    <span
      ref={triggerRef}
      className="relative inline-flex items-center"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onClick={() => setShow(!show)}
    >
      {children || (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="ml-1 opacity-30 hover:opacity-60 transition-opacity cursor-help">
          <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
          <text x="8" y="12" textAnchor="middle" fill="currentColor" fontSize="10" fontWeight="bold">?</text>
        </svg>
      )}
      {show && (
        <span
          className="absolute z-50 px-3 py-2 rounded-lg text-[11px] leading-relaxed font-normal whitespace-normal w-56 pointer-events-none"
          style={{
            background: "rgba(16, 16, 24, 0.95)",
            border: "1px solid rgba(255,255,255,0.1)",
            backdropFilter: "blur(12px)",
            color: "rgba(255,255,255,0.8)",
            ...(position === "top"
              ? { bottom: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)" }
              : { top: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)" }),
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
}
