"use client";

/**
 * ShotCanvas
 *
 * Client component. SVG rink surface bound to useShotTracker.
 *
 * Interaction model (LOCKED per Phase 4 directive):
 *   - Single tap inside rink bounds logs a "shot" via tracker.logShot
 *   - No confirmation modal
 *   - After any shot lands, transient corner buttons appear:
 *       Goal  -> tracker.updateLastShotResult("goal")
 *       Miss  -> tracker.updateLastShotResult("miss")
 *       Undo  -> tracker.undoLastEvent()
 *
 * Coordinate space: 1000x425 viewBox per NOMOS_AUDIT. clientToViewBox()
 * from @/lib/rink-geometry handles pointer-to-SVG conversion.
 */

import { useRef, useCallback } from "react";
import { useShotTracker } from "@/hooks/useShotTracker";
import {
  clientToViewBox,
  isInsideRink,
  VIEWBOX_W,
  VIEWBOX_H,
} from "@/lib/rink-geometry";

const RINK_FILL = "#e8f1ff";
const RINK_OUTLINE = "#1a1a2e";
const LINE_RED = "#c8262b";
const LINE_BLUE = "#1f5fc4";
const CREASE_BLUE = "#1f5fc4";
const GOAL_GOLD = "#C9A84C";
const HOME_RED = "#e63946";
const AWAY_BLUE = "#2d7dd2";
const MUTED = "#888899";

export default function ShotCanvas() {
  const tracker = useShotTracker();
  const svgRef = useRef<SVGSVGElement | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (!svg) return;
      const p = clientToViewBox(svg, e.clientX, e.clientY);
      if (!p) return;
      if (!isInsideRink(p.x, p.y)) return;
      e.preventDefault();
      tracker.logShot({
        x: p.x,
        y: p.y,
        forOrAgainst: "for",
        result: "shot",
      });
    },
    [tracker]
  );

  const events = tracker.state.events;
  const activePeriod = tracker.state.period;
  const visibleEvents = events.filter((ev) => ev.period === activePeriod);
  const lastIdx = events.length - 1;
  const hasShot = lastIdx >= 0;

  return (
    <div className="relative w-full h-full select-none" style={{ background: "#080810", color: "#E8E8E0" }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={onPointerDown}
        className="block w-full h-full"
        style={{ touchAction: "none", WebkitUserSelect: "none", userSelect: "none" }}
        aria-label="Shot tracking rink"
      >
        {/* Ice surface */}
        <rect
          x={0}
          y={0}
          width={VIEWBOX_W}
          height={VIEWBOX_H}
          rx={60}
          ry={60}
          fill={RINK_FILL}
          stroke={RINK_OUTLINE}
          strokeWidth={4}
        />

        {/* Goal lines */}
        <line x1={60} y1={28} x2={60} y2={397} stroke={LINE_RED} strokeWidth={2} />
        <line x1={940} y1={28} x2={940} y2={397} stroke={LINE_RED} strokeWidth={2} />

        {/* Blue lines */}
        <line x1={370} y1={28} x2={370} y2={397} stroke={LINE_BLUE} strokeWidth={6} />
        <line x1={630} y1={28} x2={630} y2={397} stroke={LINE_BLUE} strokeWidth={6} />

        {/* Center red line + face-off circle + dot */}
        <line x1={500} y1={28} x2={500} y2={397} stroke={LINE_RED} strokeWidth={4} />
        <circle cx={500} cy={212} r={50} fill="none" stroke={LINE_BLUE} strokeWidth={2} />
        <circle cx={500} cy={212} r={3} fill={LINE_BLUE} />

        {/* Zone face-off circles */}
        <g stroke={LINE_RED} strokeWidth={2} fill="none">
          <circle cx={200} cy={120} r={55} />
          <circle cx={200} cy={305} r={55} />
          <circle cx={800} cy={120} r={55} />
          <circle cx={800} cy={305} r={55} />
        </g>

        {/* Crease semicircles */}
        <path
          d="M 60 191 A 40 21 0 0 1 60 234 Z"
          fill={CREASE_BLUE}
          fillOpacity={0.55}
          stroke={LINE_RED}
          strokeWidth={1.5}
        />
        <path
          d="M 940 191 A 40 21 0 0 0 940 234 Z"
          fill={CREASE_BLUE}
          fillOpacity={0.55}
          stroke={LINE_RED}
          strokeWidth={1.5}
        />

        {/* Goal frames */}
        <rect x={50} y={202} width={10} height={21} fill="#fff" stroke={LINE_RED} strokeWidth={1.5} />
        <rect x={940} y={202} width={10} height={21} fill="#fff" stroke={LINE_RED} strokeWidth={1.5} />

        {/* Shot markers (filtered to active period) */}
        <g aria-label="Shot markers">
          {visibleEvents.map((ev, i) => {
            const isGoal = ev.result === "goal";
            const isMiss = ev.result === "miss";
            const fill = isGoal
              ? GOAL_GOLD
              : isMiss
              ? "none"
              : ev.weAre === "home"
              ? HOME_RED
              : AWAY_BLUE;
            const stroke = isMiss ? MUTED : "#080810";
            const r = isGoal ? 10 : isMiss ? 6 : 7;
            return (
              <circle
                key={ev.client_event_id ?? `ev-${i}`}
                cx={ev.x}
                cy={ev.y}
                r={r}
                fill={fill}
                stroke={stroke}
                strokeWidth={isMiss ? 2 : 1.5}
                strokeDasharray={isMiss ? "2 3" : undefined}
              />
            );
          })}
        </g>
      </svg>

      {hasShot && (
        <div
          className="absolute bottom-4 right-4 flex gap-2 z-10"
          role="toolbar"
          aria-label="Last shot result"
        >
          <button
            type="button"
            onClick={() => tracker.updateLastShotResult("goal")}
            className="px-4 py-2 rounded-md font-bold uppercase text-xs"
            style={{
              background: GOAL_GOLD,
              color: "#080810",
              letterSpacing: "0.12em",
              border: "1px solid #C9A84C",
              minHeight: 44,
              minWidth: 64,
            }}
            aria-label="Mark as goal"
          >
            Goal
          </button>
          <button
            type="button"
            onClick={() => tracker.updateLastShotResult("miss")}
            className="px-4 py-2 rounded-md font-bold uppercase text-xs"
            style={{
              background: "#0c0c14",
              color: "#E8E8E0",
              letterSpacing: "0.12em",
              border: "1px solid #1a1a2e",
              minHeight: 44,
              minWidth: 64,
            }}
            aria-label="Mark as miss"
          >
            Miss
          </button>
          <button
            type="button"
            onClick={tracker.undoLastEvent}
            className="px-4 py-2 rounded-md font-bold uppercase text-xs"
            style={{
              background: "#0c0c14",
              color: "#A0364E",
              letterSpacing: "0.12em",
              border: "1px solid rgba(160,54,78,0.4)",
              minHeight: 44,
              minWidth: 64,
            }}
            aria-label="Undo last shot"
          >
            Undo
          </button>
        </div>
      )}
    </div>
  );
}
