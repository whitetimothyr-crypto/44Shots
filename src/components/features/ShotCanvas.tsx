"use client";

/**
 * ShotCanvas
 *
 * Client component. SVG rink surface bound to useShotTracker.
 *
 * Pointer handling is a 1:1 port of legacy handleRinkTap
 * (index.html:2146-2289):
 *   - 80ms anti-jitter gate
 *   - bounds check x in [60,940], y in [28,397]
 *   - double-tap rebound gesture (settings.reboundMode "doubletap" or "both")
 *   - zone-based attackingNet: x<370 left, x>630 right, else neutral
 *   - neutral-zone team chooser modal (replaces legacy confirm() dialog)
 *   - non-neutral forOrAgainst auto-derives from ourSide vs attackingNet
 *
 * Tracker owns post-resolve work (armed mode, time-mode rebound,
 * jitter, push, disarm). markLastShotAsRebound handles dbl-tap dispatch.
 *
 * Marker rendering mirrors legacy index.html:2778-2810 including
 * isHomeTeamShot color math and dashed style ring for rebound.
 * Rebound link dashed line mirrors index.html:2815-2826.
 *
 * Coordinate space: 1000x425 viewBox per NOMOS_AUDIT.
 */

import { useCallback, useRef, useState } from "react";
import {
  getOurDefendingSide,
  DOUBLE_TAP_MS,
  DOUBLE_TAP_MOVE_TOL,
  type UseShotTrackerReturn,
} from "@/hooks/useShotTracker";
import {
  clientToViewBox,
  isInsideRink,
  VIEWBOX_W,
  VIEWBOX_H,
} from "@/lib/rink-geometry";
import type {
  AttackingNet,
  ForOrAgainst,
  Period,
  TeamSide,
} from "@/types/hockey";

interface ShotCanvasProps {
  tracker: UseShotTrackerReturn;
}

const RINK_FILL = "#e8f1ff";
const RINK_OUTLINE = "#1a1a2e";
const LINE_RED = "#c8262b";
const LINE_BLUE = "#1f5fc4";
const CREASE_BLUE = "#1f5fc4";
const GOAL_GOLD = "#C9A84C";
const HOME_COLOR = "#e63946";
const AWAY_COLOR = "#2d7dd2";
const MUTED = "#888899";
const REBOUND_LINK_STROKE = "rgba(255,90,31,.7)";
const REBOUND_RING_STROKE = "#C9A84C";

const ANTI_JITTER_MS = 80;

interface NeutralChoice {
  x: number;
  y: number;
}

interface LastPlacement {
  t: number;
  x: number;
  y: number;
  idx: number;
  period: Period;
}

function deriveForAgainstFromZone(
  attackingNet: AttackingNet,
  ourSide: AttackingNet
): ForOrAgainst {
  return attackingNet === ourSide ? "against" : "for";
}

export default function ShotCanvas({ tracker }: ShotCanvasProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const lastHandledRef = useRef<number>(0);
  const lastPlacementRef = useRef<LastPlacement | null>(null);
  const [chooser, setChooser] = useState<NeutralChoice | null>(null);

  const placeShot = useCallback(
    (
      x: number,
      y: number,
      attackingNet: AttackingNet,
      forOrAgainst: ForOrAgainst,
      now: number
    ) => {
      const period = tracker.state.period;
      const idx = tracker.logShot({ x, y, attackingNet, forOrAgainst });
      if (idx !== null) {
        lastPlacementRef.current = { t: now, x, y, idx, period };
      }
    },
    [tracker]
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (chooser) return;
      const svg = svgRef.current;
      if (!svg) return;
      const p = clientToViewBox(svg, e.clientX, e.clientY);
      if (!p) return;
      if (!isInsideRink(p.x, p.y)) return;
      e.preventDefault();

      const now = Date.now();
      if (now - lastHandledRef.current < ANTI_JITTER_MS) return;
      lastHandledRef.current = now;

      // Double-tap rebound gesture. Detected at pointer layer because
      // it depends on real-time dt + cursor distance; on confirmed
      // dbl-tap we mutate that just-placed marker instead of placing
      // a new one. Mirrors index.html:2169-2204.
      const mode = tracker.settings.reboundMode;
      const dtAllowed = mode === "doubletap" || mode === "both";
      const lp = lastPlacementRef.current;
      if (dtAllowed && lp) {
        const justPlaced = tracker.state.events[lp.idx];
        if (justPlaced) {
          const dt = now - lp.t;
          const ddx = lp.x - p.x;
          const ddy = lp.y - p.y;
          const near = Math.sqrt(ddx * ddx + ddy * ddy) <= DOUBLE_TAP_MOVE_TOL;
          if (
            dt <= DOUBLE_TAP_MS &&
            near &&
            justPlaced.period === tracker.state.period
          ) {
            tracker.markLastShotAsRebound(lp.idx);
            lastPlacementRef.current = null; // prevent triple-tap loop
            return;
          }
        }
      }

      // Zone detection. Same thresholds as legacy index.html:2216-2227.
      if (p.x < 370) {
        const attackingNet: AttackingNet = "left";
        const ourSide = getOurDefendingSide(
          tracker.state.period,
          tracker.state.weAre
        );
        placeShot(
          p.x,
          p.y,
          attackingNet,
          deriveForAgainstFromZone(attackingNet, ourSide),
          now
        );
      } else if (p.x > 630) {
        const attackingNet: AttackingNet = "right";
        const ourSide = getOurDefendingSide(
          tracker.state.period,
          tracker.state.weAre
        );
        placeShot(
          p.x,
          p.y,
          attackingNet,
          deriveForAgainstFromZone(attackingNet, ourSide),
          now
        );
      } else {
        // Neutral zone: defer until user picks team in chooser modal.
        setChooser({ x: p.x, y: p.y });
      }
    },
    [chooser, placeShot, tracker]
  );

  const onChooserPick = useCallback(
    (forOrAgainst: ForOrAgainst) => {
      if (!chooser) return;
      const period = tracker.state.period;
      const ourSide = getOurDefendingSide(period, tracker.state.weAre);
      // Legacy mapping (index.html:2225-2226):
      //   "for"     -> attackingNet = opposite of ourSide
      //   "against" -> attackingNet = ourSide
      const attackingNet: AttackingNet =
        forOrAgainst === "for"
          ? ourSide === "left"
            ? "right"
            : "left"
          : ourSide;
      const now = Date.now();
      placeShot(chooser.x, chooser.y, attackingNet, forOrAgainst, now);
      setChooser(null);
    },
    [chooser, placeShot, tracker.state.period, tracker.state.weAre]
  );

  const onWeAreToggle = useCallback(
    (next: TeamSide) => {
      tracker.setWeAre(next);
    },
    [tracker]
  );

  const events = tracker.state.events;
  const activePeriod = tracker.state.period;
  const visibleEvents = events
    .map((ev, i) => ({ ev, idx: i }))
    .filter((e) => e.ev.period === activePeriod);
  const hasShot = events.length > 0;
  const weAre = tracker.state.weAre;

  // Team names for chooser button labels. Fall back to "Our Team" /
  // "Opponent" when gameInfo not set, mirroring legacy 2213-2214.
  const ourTeamName =
    (tracker.state.gameInfo && tracker.state.gameInfo.ourTeam) || "Our Team";
  const oppTeamName =
    (tracker.state.gameInfo && tracker.state.gameInfo.opponent) || "Opponent";

  return (
    <div
      className="relative w-full h-full select-none"
      style={{ background: "#080810", color: "#E8E8E0" }}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={onPointerDown}
        className="block w-full h-full"
        style={{
          touchAction: "none",
          WebkitUserSelect: "none",
          userSelect: "none",
        }}
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

        {/* Rebound link lines. Rendered first so they sit behind
            markers. Mirrors legacy redrawAll (index.html:2815-2826). */}
        <g aria-label="Rebound links">
          {visibleEvents.map(({ ev, idx }) => {
            if (ev.linkedTo == null) return null;
            const origin = events[ev.linkedTo];
            if (!origin) return null;
            if (origin.period !== ev.period) return null;
            return (
              <line
                key={`link-${idx}`}
                x1={origin.x}
                y1={origin.y}
                x2={ev.x}
                y2={ev.y}
                stroke={REBOUND_LINK_STROKE}
                strokeWidth={2}
                strokeDasharray="4 3"
              />
            );
          })}
        </g>

        {/* Shot markers. Color math mirrors index.html:2784-2795:
            isHomeTeamShot = (weAreHome && isFor) || (!weAreHome && !isFor).
            Rebound style adds a dashed outer ring (line 2799-2808). */}
        <g aria-label="Shot markers">
          {visibleEvents.map(({ ev, idx }) => {
            const isGoal = ev.result === "goal";
            const isMiss = ev.result === "miss";
            const isFor = ev.forOrAgainst === "for";
            const weAreHome = (ev.weAre || weAre) === "home";
            const isHomeTeamShot = (weAreHome && isFor) || (!weAreHome && !isFor);

            let fill: string;
            let strokeColor = "#080810";
            let r = 7;
            if (isGoal) {
              fill = GOAL_GOLD;
              r = 10;
            } else if (isMiss) {
              fill = "none";
              strokeColor = MUTED;
              r = 6;
            } else {
              fill = isHomeTeamShot ? HOME_COLOR : AWAY_COLOR;
            }

            const hasStyle = ev.styles && ev.styles.length > 0;

            return (
              <g key={ev.client_event_id ?? `ev-${idx}`}>
                <circle
                  cx={ev.x}
                  cy={ev.y}
                  r={r}
                  fill={fill}
                  stroke={strokeColor}
                  strokeWidth={isMiss ? 2 : 1.5}
                  strokeDasharray={isMiss ? "2 3" : undefined}
                />
                {hasStyle && (
                  <circle
                    cx={ev.x}
                    cy={ev.y}
                    r={r + 4}
                    fill="none"
                    stroke={REBOUND_RING_STROKE}
                    strokeWidth={1.5}
                    strokeDasharray="3 2"
                  />
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {/* HOME / AWAY toggle (weAre). Ports legacy #weAreSeg (index.html:790-792)
          + click handler (index.html:1910-1920). Legacy hides this segment
          during play (display:none on #weAreRow) and sets it from a load-game
          modal not yet ported, so surface a flip control here for now.
          Top-left of canvas. */}
      <div
        className="absolute left-2 top-2 flex gap-0 z-10"
        role="group"
        aria-label="We are toggle"
        style={{ borderRadius: 8, overflow: "hidden", border: "1px solid rgba(255,255,255,0.12)" }}
      >
        {(["home", "away"] as TeamSide[]).map((side) => {
          const active = weAre === side;
          return (
            <button
              key={side}
              type="button"
              data-we={side}
              onClick={() => onWeAreToggle(side)}
              aria-pressed={active}
              style={{
                padding: "6px 12px",
                background: active ? (side === "home" ? HOME_COLOR : AWAY_COLOR) : "#0c0c14",
                color: active ? "#080810" : "#888899",
                border: 0,
                fontFamily: "var(--font-inter), system-ui, sans-serif",
                fontWeight: 700,
                fontSize: 11,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                cursor: active ? "default" : "pointer",
                minHeight: 32,
                touchAction: "manipulation",
              }}
            >
              {side}
            </button>
          );
        })}
      </div>

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

      {/* Neutral-zone team chooser. Replaces legacy blocking confirm()
          dialog (index.html:2224) with a real modal. Same semantics:
          choice for ourTeam -> forOrAgainst="for"; opponent -> "against".
          Buttons are wide-touch (44px) for rink-side use. */}
      {chooser && (
        <div
          className="absolute inset-0 z-20 flex items-center justify-center"
          style={{ background: "rgba(8,8,16,0.78)" }}
          role="dialog"
          aria-modal="true"
          aria-label="Neutral zone team chooser"
        >
          <div
            style={{
              background: "#0F0F1A",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 12,
              padding: "20px 24px",
              maxWidth: 360,
              width: "calc(100% - 32px)",
              fontFamily: "var(--font-inter), system-ui, sans-serif",
              color: "#E8E8E0",
            }}
          >
            <p
              style={{
                margin: "0 0 16px",
                fontSize: 13,
                letterSpacing: "0.04em",
                lineHeight: 1.5,
              }}
            >
              Neutral zone shot. Who took it?
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <button
                type="button"
                onClick={() => onChooserPick("for")}
                style={{
                  padding: "12px 8px",
                  background: weAre === "home" ? HOME_COLOR : AWAY_COLOR,
                  color: "#080810",
                  border: 0,
                  borderRadius: 8,
                  fontWeight: 700,
                  fontSize: 12,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  minHeight: 48,
                  cursor: "pointer",
                }}
              >
                {ourTeamName}
              </button>
              <button
                type="button"
                onClick={() => onChooserPick("against")}
                style={{
                  padding: "12px 8px",
                  background: weAre === "home" ? AWAY_COLOR : HOME_COLOR,
                  color: "#080810",
                  border: 0,
                  borderRadius: 8,
                  fontWeight: 700,
                  fontSize: 12,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  minHeight: 48,
                  cursor: "pointer",
                }}
              >
                {oppTeamName}
              </button>
            </div>
            <button
              type="button"
              onClick={() => setChooser(null)}
              style={{
                marginTop: 12,
                width: "100%",
                padding: "8px",
                background: "transparent",
                color: "#888899",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 8,
                fontSize: 10,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                fontWeight: 600,
                minHeight: 36,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
