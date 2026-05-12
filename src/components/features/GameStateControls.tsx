"use client";

/**
 * GameStateControls
 *
 * Ports legacy #gameStateSeg PP/PK toggle pair (DOM index.html:698-700,
 * click handler index.html:1944-1957). Mirrors legacy semantics:
 *   - 5v5 is implicit default
 *   - clicking active PP or PK button reverts to 5v5
 *   - PP and PK are mutually exclusive (state.gameState holds one)
 *
 * Legacy CSS pulse animation (gs-pp / gs-pk body class, index.html:391)
 * and gameStateHint copy (index.html:1967-1968) are NOT ported in
 * Phase 2; visual reminder is just an active button highlight.
 *
 * Empty Net ("en") + 4v4 / 3v3 exist in TrackerState type union but
 * legacy never wired UI; not added here per strict 1:1 transplant.
 */

import type { UseShotTrackerReturn } from "@/hooks/useShotTracker";
import type { GameState } from "@/types/hockey";

interface Props {
  tracker: UseShotTrackerReturn;
}

const TOGGLES: { value: Extract<GameState, "pp" | "pk">; label: string }[] = [
  { value: "pp", label: "PP" },
  { value: "pk", label: "PK" },
];

const ACTIVE_COLOR = "#FF5A1F";
const IDLE_COLOR = "#888899";
const BG_DARK = "#0c0c14";

export default function GameStateControls({ tracker }: Props) {
  const current = tracker.state.gameState;

  return (
    <div
      role="group"
      aria-label="Game state"
      style={{
        display: "inline-flex",
        gap: 4,
        padding: "4px 6px",
        background: BG_DARK,
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 10,
      }}
    >
      {TOGGLES.map(({ value, label }) => {
        const on = current === value;
        return (
          <button
            key={value}
            type="button"
            data-gs={value}
            onClick={() => {
              // Legacy 1955 toggle semantics: pressing active mode
              // reverts to 5v5; pressing inactive switches to it.
              const next: GameState = current === value ? "5v5" : value;
              tracker.setGameState(next);
            }}
            aria-pressed={on}
            style={{
              minWidth: 44,
              minHeight: 40,
              padding: "6px 10px",
              background: on ? ACTIVE_COLOR : "transparent",
              border: 0,
              color: on ? "#080810" : IDLE_COLOR,
              fontFamily: "var(--font-inter), system-ui, sans-serif",
              fontWeight: 700,
              fontSize: 11,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              cursor: "pointer",
              borderRadius: 6,
              touchAction: "manipulation",
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
