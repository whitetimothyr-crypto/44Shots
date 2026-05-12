"use client";

/**
 * GameUtilities
 *
 * Header-style Undo + Reset Game controls. Ports:
 *   - Undo (index.html:701 DOM, index.html:2833-2837 handler):
 *     pops most-recent event via tracker.undoLastEvent. Always-visible
 *     in legacy header. Disabled when zero events.
 *   - Reset Game (index.html:974 DOM, index.html:2838-2880 handler):
 *     two-tap confirm pattern with a 3-second arm window. First tap
 *     swaps label to "Tap again to confirm" + red highlight; second
 *     tap within window calls tracker.resetGame (clears events,
 *     netEvents, faceoffs; preserves weAre, rinkRotation, goalies).
 *
 * Legacy clearBtn shipped with display:none in production (index.html:974)
 * because end-of-game flow takes over reset duty via archive + report.
 * Surfaced here as a visible coach utility while end-of-game flow has
 * not been ported.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { UseShotTrackerReturn } from "@/hooks/useShotTracker";

interface Props {
  tracker: UseShotTrackerReturn;
}

const RESET_ARM_MS = 3000;
const RED_DANGER = "#A0364E";
const RED_DANGER_BG = "rgba(160,54,78,0.18)";

export default function GameUtilities({ tracker }: Props) {
  const hasEvents = tracker.state.events.length > 0;
  const [resetArmed, setResetArmed] = useState(false);
  const armTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearArmTimer = useCallback(() => {
    if (armTimerRef.current) {
      clearTimeout(armTimerRef.current);
      armTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => clearArmTimer();
  }, [clearArmTimer]);

  const onUndoClick = useCallback(() => {
    tracker.undoLastEvent();
  }, [tracker]);

  const onResetClick = useCallback(() => {
    if (!resetArmed) {
      setResetArmed(true);
      clearArmTimer();
      armTimerRef.current = setTimeout(() => {
        setResetArmed(false);
        armTimerRef.current = null;
      }, RESET_ARM_MS);
      return;
    }
    clearArmTimer();
    setResetArmed(false);
    tracker.resetGame();
  }, [resetArmed, clearArmTimer, tracker]);

  const baseBtn: React.CSSProperties = {
    minHeight: 40,
    padding: "6px 12px",
    background: "transparent",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 8,
    fontFamily: "var(--font-inter), system-ui, sans-serif",
    fontWeight: 700,
    fontSize: 11,
    letterSpacing: "0.16em",
    textTransform: "uppercase",
    cursor: "pointer",
    touchAction: "manipulation",
  };

  return (
    <div
      role="group"
      aria-label="Game utilities"
      style={{ display: "inline-flex", gap: 6 }}
    >
      <button
        id="undoBtn"
        type="button"
        onClick={onUndoClick}
        disabled={!hasEvents}
        style={{
          ...baseBtn,
          color: hasEvents ? "#E8E8E0" : "#444450",
          cursor: hasEvents ? "pointer" : "not-allowed",
          opacity: hasEvents ? 1 : 0.45,
        }}
        aria-label="Undo last event"
      >
        Undo
      </button>
      <button
        id="clearBtn"
        type="button"
        onClick={onResetClick}
        style={{
          ...baseBtn,
          background: resetArmed ? RED_DANGER_BG : "transparent",
          borderColor: resetArmed ? RED_DANGER : "rgba(255,255,255,0.12)",
          color: resetArmed ? "#E8E8E0" : RED_DANGER,
        }}
        aria-label={
          resetArmed ? "Tap again to confirm reset" : "Reset game"
        }
        aria-pressed={resetArmed}
      >
        {resetArmed ? "Tap to Confirm" : "Reset"}
      </button>
    </div>
  );
}
