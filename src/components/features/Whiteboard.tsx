"use client";

/**
 * Whiteboard
 *
 * Simplified drawing surface for Phase 5. Two tool modes (Pen, Eraser),
 * Clear All button. Local component state only; no persistence yet.
 *
 * Scope vs legacy js/whiteboard.js (468 lines, references):
 *   PORTED:
 *     - Pen mode (pointer drag → polyline)
 *     - Eraser as a toggle tool (legacy commit 098035e:
 *       "eraser is a toggle")
 *     - Clear All
 *     - Pointer-capture for smooth drawing (legacy commit d817e9b:
 *       "stroke pointerId filter + pointercancel")
 *   DEFERRED:
 *     - Color palette + swatches (multi-color strokes)
 *     - Marker shapes (F1/F2/F3/D1/D2/puck) from whiteboard-api
 *     - Variant strokes (skate/skate_stop/pass/loose_puck)
 *     - Brush size variants
 *     - Session persistence via Supabase whiteboard_sessions
 *     - Drill title metadata + video sync
 *
 * Eraser hit test: pointer-down on a stroke removes that stroke
 * (any point within HIT_PX of pointer). Drag-erase deferred to a
 * future phase to keep this transplant compact.
 */

import { useCallback, useRef, useState } from "react";

interface Point {
  x: number;
  y: number;
}

interface Stroke {
  id: string;
  points: Point[];
  color: string;
  size: number;
}

type Tool = "pen" | "eraser";

const VBW = 1000;
const VBH = 500;
const PEN_COLOR = "#E8E8E0";
const PEN_SIZE = 3;
const ERASER_HIT_PX = 12;
const ACCENT = "#C9A84C";
const ACCENT_DANGER = "#A0364E";
const BG_DARK = "#0F0F1A";

function makeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "stroke_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 9);
}

function svgPoint(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number
): Point | null {
  const rect = svg.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  return {
    x: ((clientX - rect.left) / rect.width) * VBW,
    y: ((clientY - rect.top) / rect.height) * VBH,
  };
}

function strokeContains(stroke: Stroke, p: Point): boolean {
  for (let i = 0; i < stroke.points.length; i++) {
    const dx = stroke.points[i].x - p.x;
    const dy = stroke.points[i].y - p.y;
    if (Math.sqrt(dx * dx + dy * dy) <= ERASER_HIT_PX + stroke.size) return true;
  }
  return false;
}

function pointsToPolyline(points: Point[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(" ");
}

export default function Whiteboard() {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [tool, setTool] = useState<Tool>("pen");
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [drafting, setDrafting] = useState<Stroke | null>(null);
  const activePointerRef = useRef<number | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (!svg) return;
      const p = svgPoint(svg, e.clientX, e.clientY);
      if (!p) return;
      e.preventDefault();

      if (tool === "eraser") {
        setStrokes((cur) => {
          for (let i = cur.length - 1; i >= 0; i--) {
            if (strokeContains(cur[i], p)) {
              return [...cur.slice(0, i), ...cur.slice(i + 1)];
            }
          }
          return cur;
        });
        return;
      }

      // Pen: start draft stroke + capture pointer
      activePointerRef.current = e.pointerId;
      try {
        svg.setPointerCapture(e.pointerId);
      } catch {
        // setPointerCapture can throw on legacy browsers; safe to ignore
      }
      setDrafting({
        id: makeId(),
        points: [p],
        color: PEN_COLOR,
        size: PEN_SIZE,
      });
    },
    [tool]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (tool !== "pen") return;
      if (activePointerRef.current !== e.pointerId) return;
      const svg = svgRef.current;
      if (!svg) return;
      const p = svgPoint(svg, e.clientX, e.clientY);
      if (!p) return;
      setDrafting((cur) => {
        if (!cur) return cur;
        return { ...cur, points: [...cur.points, p] };
      });
    },
    [tool]
  );

  const finishStroke = useCallback(() => {
    setDrafting((cur) => {
      if (cur && cur.points.length > 1) {
        setStrokes((prev) => [...prev, cur]);
      }
      return null;
    });
    activePointerRef.current = null;
  }, []);

  const onPointerUp = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (tool !== "pen") return;
      if (activePointerRef.current !== e.pointerId) return;
      const svg = svgRef.current;
      if (svg) {
        try {
          svg.releasePointerCapture(e.pointerId);
        } catch {
          // releasePointerCapture can throw if capture is already released
        }
      }
      finishStroke();
    },
    [tool, finishStroke]
  );

  const onPointerCancel = useCallback(() => {
    finishStroke();
  }, [finishStroke]);

  const onClear = useCallback(() => {
    setStrokes([]);
    setDrafting(null);
  }, []);

  const baseBtn: React.CSSProperties = {
    minHeight: 40,
    padding: "6px 14px",
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
      style={{
        flex: 1,
        width: "100%",
        display: "flex",
        flexDirection: "column",
        padding: "12px 16px",
        boxSizing: "border-box",
        gap: 10,
        color: "#E8E8E0",
      }}
      role="region"
      aria-label="Whiteboard drawing surface"
    >
      <div
        role="toolbar"
        aria-label="Whiteboard tools"
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        {(["pen", "eraser"] as Tool[]).map((t) => {
          const on = tool === t;
          return (
            <button
              key={t}
              type="button"
              onClick={() => setTool(t)}
              aria-pressed={on}
              style={{
                ...baseBtn,
                background: on ? ACCENT : "transparent",
                color: on ? "#080810" : "#E8E8E0",
                borderColor: on ? ACCENT : "rgba(255,255,255,0.12)",
              }}
            >
              {t === "pen" ? "Pen" : "Eraser"}
            </button>
          );
        })}
        <span
          style={{
            color: "#666677",
            fontSize: 10,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            marginLeft: 4,
          }}
        >
          {strokes.length} stroke{strokes.length === 1 ? "" : "s"}
        </span>
        <button
          type="button"
          onClick={onClear}
          disabled={strokes.length === 0 && !drafting}
          style={{
            ...baseBtn,
            marginLeft: "auto",
            color: ACCENT_DANGER,
            borderColor: "rgba(160,54,78,0.4)",
            opacity: strokes.length === 0 && !drafting ? 0.4 : 1,
            cursor:
              strokes.length === 0 && !drafting ? "not-allowed" : "pointer",
          }}
          aria-label="Clear whiteboard"
        >
          Clear
        </button>
      </div>

      <div
        style={{
          flex: 1,
          width: "100%",
          aspectRatio: `${VBW} / ${VBH}`,
          background: BG_DARK,
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VBW} ${VBH}`}
          preserveAspectRatio="xMidYMid meet"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          style={{
            width: "100%",
            height: "100%",
            display: "block",
            cursor: tool === "eraser" ? "crosshair" : "crosshair",
            touchAction: "none",
            userSelect: "none",
            WebkitUserSelect: "none",
          }}
          aria-label="Drawing surface"
        >
          {/* Subtle grid for spatial reference */}
          <g stroke="rgba(255,255,255,0.04)" strokeWidth={1}>
            {Array.from({ length: 19 }).map((_, i) => (
              <line
                key={`gx-${i}`}
                x1={(VBW * (i + 1)) / 20}
                y1={0}
                x2={(VBW * (i + 1)) / 20}
                y2={VBH}
              />
            ))}
            {Array.from({ length: 9 }).map((_, i) => (
              <line
                key={`gy-${i}`}
                x1={0}
                y1={(VBH * (i + 1)) / 10}
                x2={VBW}
                y2={(VBH * (i + 1)) / 10}
              />
            ))}
          </g>

          {strokes.map((s) => (
            <polyline
              key={s.id}
              points={pointsToPolyline(s.points)}
              fill="none"
              stroke={s.color}
              strokeWidth={s.size}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}

          {drafting && drafting.points.length > 0 && (
            <polyline
              points={pointsToPolyline(drafting.points)}
              fill="none"
              stroke={drafting.color}
              strokeWidth={drafting.size}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </svg>
      </div>
    </div>
  );
}
