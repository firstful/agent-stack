"use client";

import { useEffect, useState } from "react";
import { formatTimeLeft } from "./group-detail-types";

interface AdaptiveTimerProps {
  remainingMs: number;
  totalMs: number;
  label?: string;
}

export function AdaptiveTimer({ remainingMs, totalMs, label }: AdaptiveTimerProps) {
  const [displayMs, setDisplayMs] = useState(remainingMs);

  useEffect(() => {
    setDisplayMs(remainingMs);
  }, [remainingMs]);

  // Fraction remaining for visual progress
  const fraction = totalMs > 0 ? Math.max(0, Math.min(1, displayMs / totalMs)) : 0;

  // Color: green → yellow → red as time runs out
  const hue = 120 * fraction; // 120 = green, 0 = red
  const color = `hsl(${hue}, 80%, ${fraction > 0.3 ? 50 : 45}%)`;

  // If expired, show differently
  const isExpired = displayMs <= 0;

  return (
    <div className={`adaptive-timer ${isExpired ? "adaptive-timer--expired" : ""}`}>
      {/* Circular timer ring */}
      <svg className="adaptive-timer-ring" viewBox="0 0 36 36" width="36" height="36">
        {/* Background ring */}
        <circle
          cx="18" cy="18" r="15.5"
          fill="none"
          stroke="var(--border)"
          strokeWidth="2.5"
        />
        {/* Progress ring */}
        <circle
          cx="18" cy="18" r="15.5"
          fill="none"
          stroke={isExpired ? "var(--danger)" : color}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={`${fraction * 97.4} ${97.4 - fraction * 97.4}`}
          strokeDashoffset="0"
          transform="rotate(-90, 18, 18)"
          className="adaptive-timer-ring-fill"
        />
      </svg>

      {/* Time display */}
      <div className="adaptive-timer-info">
        {label && <span className="adaptive-timer-label">{label}</span>}
        <span
          className="adaptive-timer-value"
          style={{ color: isExpired ? "var(--danger)" : color }}
        >
          {isExpired ? "Time expired" : formatTimeLeft(displayMs)}
        </span>
      </div>
    </div>
  );
}
