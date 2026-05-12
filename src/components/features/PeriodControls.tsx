"use client";

/**
 * PeriodControls
 *
 * Ports legacy #periodSegGlobal segment from index.html:692-697 (DOM)
 * and index.html:1834-1866 (click handler).
 *
 * 4 buttons keyed data-period 1..4. P4 displays as "OT" per legacy
 * convention (index.html:696). Click on already-active period is a
 * no-op per legacy 1839.
 *
 * Note: legacy 1842-1865 fires showPeriodMiniReport + triggerCenterFaceoff
 * on period change. Both are out of scope for Phase 2; period switch
 * here just mutates state via tracker.setPeriod. P2 ends-swap inside
 * getOurDefendingSide picks up new period on next pointer tap.
 */

import type { UseShotTrackerReturn } from "@/hooks/useShotTracker";
import type { Period } from "@/types/hockey";

interface Props {
  tracker: UseShotTrackerReturn;
}

const PERIODS: { value: Period; label: string }[] = [
  { value: 1, label: "1" },
  { value: 2, label: "2" },
  { value: 3, label: "3" },
  { value: 4, label: "OT" },
];

const ACTIVE_COLOR = "#C9A84C";
const IDLE_COLOR = "#888899";
const BG_DARK = "#0c0c14";

export default function PeriodControls({ tracker }: Props) {
  const active = tracker.state.period;

  return (
    <div
      role="group"
      aria-label="Period selector"
      style={{
        display: "inline-flex",
        gap: 6,
        padding: "4px 6px",
        background: BG_DARK,
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 10,
      }}
    >
      {PERIODS.map(({ value, label }) => {
        const on = value === active;
        return (
          <button
            key={value}
            type="button"
            data-period={value}
            onClick={() => {
              if (value === active) return;
              tracker.setPeriod(value);
            }}
            aria-pressed={on}
            style={{
              minWidth: 36,
              minHeight: 40,
              padding: "4px 8px",
              background: "transparent",
              border: 0,
              cursor: on ? "default" : "pointer",
              color: on ? ACTIVE_COLOR : IDLE_COLOR,
              fontFamily: "var(--font-inter), system-ui, sans-serif",
              fontWeight: 700,
              fontSize: 11,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              touchAction: "manipulation",
              display: "inline-flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 3,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: on ? ACTIVE_COLOR : "rgba(255,255,255,0.18)",
              }}
            />
            <small style={{ fontSize: 10, lineHeight: 1 }}>{label}</small>
          </button>
        );
      })}
    </div>
  );
}
