"use client";

/**
 * Home route. Client component that owns a single useShotTracker
 * instance for this page and props it down to ShotCanvas plus a
 * Phase 2 control strip. Lifting state here ensures all controls +
 * canvas share one tracker state machine (multiple useShotTracker
 * calls would each spawn isolated useState slots).
 *
 * Visual hierarchy mirrors legacy index.html top bar
 * (#globalGameRow at line 691): a horizontal control strip carries
 * Period + GameState + Utilities side by side, with HOME/AWAY toggle
 * sitting inside ShotCanvas as an overlay on rink chrome (matches
 * Phase 1 placement).
 *
 * Sizing: flex column fills available main area (between shell
 * TopBar and BottomNav). Controls row is fixed height; rink takes
 * remaining vertical space. 1000x425 aspect locked per NOMOS_AUDIT.
 */

import { useShotTracker } from "@/hooks/useShotTracker";
import ShotCanvas from "@/components/features/ShotCanvas";
import PeriodControls from "@/components/features/PeriodControls";
import GameStateControls from "@/components/features/GameStateControls";
import GameUtilities from "@/components/features/GameUtilities";

export default function Page() {
  const tracker = useShotTracker();

  return (
    <div
      style={{
        flex: 1,
        width: "100%",
        display: "flex",
        flexDirection: "column",
        boxSizing: "border-box",
        minHeight: 0,
      }}
    >
      <div
        role="region"
        aria-label="Game controls"
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          padding: "8px 12px",
          background: "#0F0F1A",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <PeriodControls tracker={tracker} />
        <GameStateControls tracker={tracker} />
        <GameUtilities tracker={tracker} />
      </div>

      <div
        style={{
          flex: 1,
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "8px",
          boxSizing: "border-box",
          minHeight: 0,
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth:
              "min(100%, calc((100dvh - 56px - 56px - 28px - 56px) * 1000 / 425))",
            aspectRatio: "1000 / 425",
          }}
        >
          <ShotCanvas tracker={tracker} />
        </div>
      </div>
    </div>
  );
}
