"use client";

/**
 * Home route. Client component that owns:
 *   - a single useShotTracker instance props down to every view
 *   - activeTab state for top-level navigation (rink / feed / stats)
 *   - BottomNav (moved from shell layout so it can read activeTab)
 *
 * Lifting useShotTracker here keeps one tracker state machine across
 * all tabs (multiple useShotTracker calls would each spawn isolated
 * useState slots). Lifting BottomNav into page lets it share state
 * with conditional view switching without introducing a context.
 *
 * Visual hierarchy mirrors legacy index.html top bar
 * (#globalGameRow at line 691): a horizontal control strip carries
 * Period + GameState + Utilities side by side. Strip stays visible
 * across all tabs because legacy global header is always visible.
 *
 * Sizing: flex column fills available main area (between shell
 * TopBar and Footer). Controls row is fixed height. Active tab
 * content takes remaining vertical space. Rink view locks 1000x425
 * aspect per NOMOS_AUDIT; feed and stats scroll vertically.
 */

import { useState } from "react";
import { useShotTracker } from "@/hooks/useShotTracker";
import ShotCanvas from "@/components/features/ShotCanvas";
import PeriodControls from "@/components/features/PeriodControls";
import GameStateControls from "@/components/features/GameStateControls";
import GameUtilities from "@/components/features/GameUtilities";
import ShotFeed from "@/components/features/ShotFeed";
import QuickStats from "@/components/features/QuickStats";
import BottomNav, { type TabId } from "@/components/shell/BottomNav";

export default function Page() {
  const tracker = useShotTracker();
  const [activeTab, setActiveTab] = useState<TabId>("rink");

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
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        {activeTab === "rink" && (
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
        )}

        {activeTab === "feed" && <ShotFeed tracker={tracker} />}
        {activeTab === "stats" && <QuickStats tracker={tracker} />}
      </div>

      <BottomNav activeTab={activeTab} onSelect={setActiveTab} />
    </div>
  );
}
