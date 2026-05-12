"use client";

/**
 * NetPanel
 *
 * Ports legacy panel-net (index.html:981-1020) + handleNetTap
 * (index.html:2911-2990). 3x3 zone grid drawn on a 600x400 SVG.
 * Goal frame x:80-520, y:60-340 (width 440, height 280) matches
 * legacy zoneOf math (index.html:2922-2929) exactly so future
 * stats over net markers stay byte-for-byte compatible.
 *
 * Zone label derivation ports legacy index.html:2932-2961:
 *   - vert band: high (y<yRow1) / mid (y<yRow2) / low (else)
 *   - col band: left (x<xCol1) / center (x<xCol2) / right (else)
 *   - center col: "Five hole" (low) / "Center mid" (mid) / "High center" (high)
 *   - side cols: Glove vs Blocker derived from goalie.hand
 *     ("left" regular = glove on shooter's right column;
 *      "right" full-right = glove on shooter's left column)
 *
 * Asset note: legacy backdrop image (assets/net-backdrop.jpg) does
 * not ship in Next.js public/. SVG primitives render goal frame +
 * crossbar + net mesh in its place. Coordinate space is identical
 * so zone math + marker positions stay 1:1 with legacy data.
 *
 * Contextual prompt ports legacy switchTab net-branch
 * (index.html:1731-1746): banner copy reflects pendingNetGoalTeam.
 *
 * Undo + Clear Net buttons port legacy handlers
 * (index.html:3007 undoNetBtn, index.html:1014 clearNetBtn intent).
 */

import { useCallback, useRef } from "react";
import type { UseShotTrackerReturn } from "@/hooks/useShotTracker";
import type { NetEventPayload } from "@/types/hockey";
import GoalieSelector from "@/components/features/GoalieSelector";

interface Props {
  tracker: UseShotTrackerReturn;
  onNetEventLogged?: () => void;
}

const VBW = 600;
const VBH = 400;
const NET_X_L = 80;
const NET_X_R = 520;
const NET_Y_T = 60;
const NET_Y_B = 340;
const NET_W = NET_X_R - NET_X_L; // 440
const NET_H = NET_Y_B - NET_Y_T; // 280
const X_COL1 = NET_X_L + NET_W / 3; // 226.67
const X_COL2 = NET_X_L + (2 * NET_W) / 3; // 373.33
const Y_ROW1 = NET_Y_T + NET_H / 3; // 153.33
const Y_ROW2 = NET_Y_T + (2 * NET_H) / 3; // 246.67

const NET_BG = "#0c0c14";
const FRAME_RED = "#c8262b";
const MESH = "rgba(255,255,255,0.08)";
const ZONE_STROKE = "rgba(255,255,255,0.06)";
const GOAL_GOLD = "#C9A84C";
const FOR_GOLD = "#C9A84C";
const AGAINST_ORANGE = "#FF5A1F";

const NET_TAP_DEBOUNCE_MS = 250;

function zoneLabel(
  x: number,
  y: number,
  hand: "left" | "right"
): string | null {
  if (x < NET_X_L || x > NET_X_R || y < NET_Y_T || y > NET_Y_B) return null;
  const vert: "high" | "mid" | "low" =
    y < Y_ROW1 ? "high" : y < Y_ROW2 ? "mid" : "low";
  const col: "left" | "center" | "right" =
    x < X_COL1 ? "left" : x < X_COL2 ? "center" : "right";
  if (col === "center") {
    if (vert === "low") return "Five hole";
    if (vert === "mid") return "Center mid";
    return "High center";
  }
  const isFullRight = hand === "right";
  const side =
    isFullRight
      ? col === "left"
        ? "Glove"
        : "Blocker"
      : col === "left"
      ? "Blocker"
      : "Glove";
  return side + " " + vert;
}

function svgPoint(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number
): { x: number; y: number } | null {
  const rect = svg.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  const x = ((clientX - rect.left) / rect.width) * VBW;
  const y = ((clientY - rect.top) / rect.height) * VBH;
  return { x, y };
}

interface NetMarkerEv extends NetEventPayload {
  _x?: number;
  _y?: number;
  _zoneLabel?: string;
}

export default function NetPanel({ tracker, onNetEventLogged }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const lastTapRef = useRef<number>(0);

  const pendingTeam = tracker.state.pendingNetGoalTeam;
  const period = tracker.state.period;
  const goalie = tracker.state.activeGoalie;
  const hand: "left" | "right" =
    (goalie && goalie.hand) || tracker.state.gameInfo?.goalieHandedness || "left";

  // Markers list mirrors legacy redrawAll filter (index.html:2829-2830):
  // show only markers for current pending team (or last-tap fallback).
  const allMarkers = (tracker.state.netEvents as NetMarkerEv[]).filter(
    (ev) => ev.period === period
  );
  const filterTeam =
    pendingTeam ??
    (allMarkers.length > 0
      ? allMarkers[allMarkers.length - 1].forOrAgainst
      : "against");
  const visibleMarkers = allMarkers.filter(
    (ev) => ev.forOrAgainst === filterTeam
  );

  const onSvgTap = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (!svg) return;
      const now = Date.now();
      if (now - lastTapRef.current < NET_TAP_DEBOUNCE_MS) return;
      lastTapRef.current = now;
      const p = svgPoint(svg, e.clientX, e.clientY);
      if (!p) return;
      const label = zoneLabel(p.x, p.y, hand);
      if (!label) return;
      tracker.logNetEvent({ x: p.x, y: p.y, zone: label });
      if (onNetEventLogged) onNetEventLogged();
    },
    [hand, tracker, onNetEventLogged]
  );

  const onUndo = useCallback(() => tracker.undoLastNetEvent(), [tracker]);
  const onClear = useCallback(() => tracker.clearNetEvents(), [tracker]);

  const ourTeamName =
    (tracker.state.gameInfo && tracker.state.gameInfo.ourTeam) || "Our Team";
  const oppTeamName =
    (tracker.state.gameInfo && tracker.state.gameInfo.opponent) || "Opponent";
  const goalieName = (goalie && goalie.name) || "Goalie";

  let prompt: React.ReactNode;
  if (pendingTeam === "for") {
    prompt = (
      <span>
        <strong style={{ color: FOR_GOLD }}>{ourTeamName.toUpperCase()} GOAL</strong>
        {" · tap where it went in"}
      </span>
    );
  } else if (pendingTeam === "against") {
    prompt = (
      <span>
        <strong style={{ color: AGAINST_ORANGE }}>
          GOAL AGAINST {goalieName.toUpperCase()}
        </strong>
        {" · tap where they scored"}
      </span>
    );
  } else {
    prompt = <span>Tap where a puck went in</span>;
  }

  const totalGoals = tracker.state.netEvents.length;

  return (
    <div
      style={{
        flex: 1,
        width: "100%",
        overflowY: "auto",
        padding: "12px 16px",
        boxSizing: "border-box",
        color: "#E8E8E0",
      }}
      role="region"
      aria-label="Net zone panel"
    >
      <div
        style={{
          maxWidth: 720,
          marginLeft: "auto",
          marginRight: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <GoalieSelector tracker={tracker} />

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 8,
            padding: "10px 12px",
            background: "#0F0F1A",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 10,
            fontFamily: "var(--font-inter), system-ui, sans-serif",
            fontSize: 12,
            letterSpacing: "0.08em",
            lineHeight: 1.3,
          }}
          aria-live="polite"
        >
          <span>{prompt}</span>
          <span
            style={{
              color: "#888899",
              fontSize: 10,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              fontWeight: 700,
            }}
          >
            {totalGoals} goal{totalGoals === 1 ? "" : "s"} logged
          </span>
        </div>

        <div
          style={{
            width: "100%",
            aspectRatio: `${VBW} / ${VBH}`,
            background: NET_BG,
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          <svg
            ref={svgRef}
            viewBox={`0 0 ${VBW} ${VBH}`}
            preserveAspectRatio="xMidYMid meet"
            onPointerDown={onSvgTap}
            style={{
              width: "100%",
              height: "100%",
              display: "block",
              touchAction: "none",
              userSelect: "none",
              WebkitUserSelect: "none",
            }}
            aria-label="Net zone grid"
          >
            {/* Net mesh */}
            <rect
              x={NET_X_L}
              y={NET_Y_T}
              width={NET_W}
              height={NET_H}
              fill="#1a1a2e"
            />
            <g stroke={MESH} strokeWidth={0.5}>
              {Array.from({ length: 18 }).map((_, i) => (
                <line
                  key={`v-${i}`}
                  x1={NET_X_L + (NET_W * i) / 18}
                  y1={NET_Y_T}
                  x2={NET_X_L + (NET_W * i) / 18}
                  y2={NET_Y_B}
                />
              ))}
              {Array.from({ length: 12 }).map((_, i) => (
                <line
                  key={`h-${i}`}
                  x1={NET_X_L}
                  y1={NET_Y_T + (NET_H * i) / 12}
                  x2={NET_X_R}
                  y2={NET_Y_T + (NET_H * i) / 12}
                />
              ))}
            </g>

            {/* 3x3 zone grid lines */}
            <g stroke={ZONE_STROKE} strokeWidth={1}>
              <line x1={X_COL1} y1={NET_Y_T} x2={X_COL1} y2={NET_Y_B} />
              <line x1={X_COL2} y1={NET_Y_T} x2={X_COL2} y2={NET_Y_B} />
              <line x1={NET_X_L} y1={Y_ROW1} x2={NET_X_R} y2={Y_ROW1} />
              <line x1={NET_X_L} y1={Y_ROW2} x2={NET_X_R} y2={Y_ROW2} />
            </g>

            {/* Goal frame (posts + crossbar) */}
            <g stroke={FRAME_RED} strokeWidth={4} fill="none">
              <line x1={NET_X_L} y1={NET_Y_T} x2={NET_X_L} y2={NET_Y_B} />
              <line x1={NET_X_R} y1={NET_Y_T} x2={NET_X_R} y2={NET_Y_B} />
              <line x1={NET_X_L} y1={NET_Y_T} x2={NET_X_R} y2={NET_Y_T} />
            </g>

            {/* Markers */}
            <g aria-label="Net markers">
              {visibleMarkers.map((ev, i) => {
                const cx = ev._x ?? 0;
                const cy = ev._y ?? 0;
                const isFor = ev.forOrAgainst === "for";
                return (
                  <circle
                    key={ev.client_event_id ?? `net-${i}`}
                    cx={cx}
                    cy={cy}
                    r={10}
                    fill={GOAL_GOLD}
                    stroke={isFor ? FOR_GOLD : AGAINST_ORANGE}
                    strokeWidth={3}
                  />
                );
              })}
            </g>
          </svg>
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onUndo}
            style={{
              minHeight: 40,
              padding: "6px 14px",
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 8,
              color: "#E8E8E0",
              fontFamily: "var(--font-inter), system-ui, sans-serif",
              fontWeight: 700,
              fontSize: 11,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
            aria-label="Undo last net event"
          >
            Undo
          </button>
          <button
            type="button"
            onClick={onClear}
            style={{
              minHeight: 40,
              padding: "6px 14px",
              background: "transparent",
              border: "1px solid rgba(160,54,78,0.4)",
              borderRadius: 8,
              color: "#A0364E",
              fontFamily: "var(--font-inter), system-ui, sans-serif",
              fontWeight: 700,
              fontSize: 11,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
            aria-label="Clear all net events"
          >
            Clear Net
          </button>
        </div>

        <p
          style={{
            margin: "0 4px",
            fontSize: 11,
            color: "#666677",
            letterSpacing: "0.06em",
            lineHeight: 1.5,
          }}
        >
          Tip: Log a goal on rink first, then tap here to mark where it
          went in. Net taps stand alone too.
        </p>
      </div>
    </div>
  );
}
