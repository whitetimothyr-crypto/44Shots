"use client";

/**
 * ShotFeed
 *
 * Reverse-chronological event list. Source-of-truth equivalent
 * does not exist in legacy: js/feed.js is a stub ("Coming soon").
 * Row format adapts legacy event-meta string from index.html:2704
 * (`P{period} · {forOrAgainst} · {result}`) to Tim's Phase 3 spec
 * (result + team + time + period).
 *
 * Team derivation uses isHomeTeamShot math from index.html:2787-2792:
 *   isHomeTeamShot = (weAreHome && isFor) || (!weAreHome && !isFor)
 *
 * Per-row delete (× button) ports legacy epDelete handler from
 * index.html:2742-2750. Long-press is replaced with an inline
 * action button for desktop+touch parity; same semantics
 * (splice by index, no linkedTo re-map).
 */

import { useCallback } from "react";
import type { UseShotTrackerReturn } from "@/hooks/useShotTracker";
import type { ShotEventPayload } from "@/types/hockey";

interface Props {
  tracker: UseShotTrackerReturn;
}

const RESULT_LABEL: Record<ShotEventPayload["result"], string> = {
  shot: "Save",
  goal: "Goal",
  miss: "Miss",
  block: "Block",
};

const RESULT_COLOR: Record<ShotEventPayload["result"], string> = {
  shot: "#E8E8E0",
  goal: "#C9A84C",
  miss: "#888899",
  block: "#8aa0b8",
};

function isHomeShot(ev: ShotEventPayload, fallbackWeAre: "home" | "away") {
  const weAreHome = (ev.weAre || fallbackWeAre) === "home";
  const isFor = ev.forOrAgainst === "for";
  return (weAreHome && isFor) || (!weAreHome && !isFor);
}

function formatTime(t: number): string {
  const d = new Date(t);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export default function ShotFeed({ tracker }: Props) {
  const events = tracker.state.events;
  const weAre = tracker.state.weAre;

  const onDelete = useCallback(
    (idx: number) => {
      tracker.deleteEventAt(idx);
    },
    [tracker]
  );

  if (events.length === 0) {
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          color: "#666677",
          fontFamily: "var(--font-inter), system-ui, sans-serif",
          fontSize: 12,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
        }}
      >
        No events logged yet
      </div>
    );
  }

  // Reverse-chronological: latest first. Indices preserved so
  // delete can target original event position.
  const rows = events
    .map((ev, idx) => ({ ev, idx }))
    .reverse();

  return (
    <div
      style={{
        flex: 1,
        width: "100%",
        overflowY: "auto",
        padding: "8px 12px",
        boxSizing: "border-box",
      }}
      role="feed"
      aria-label="Shot event feed"
    >
      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          maxWidth: 720,
          marginLeft: "auto",
          marginRight: "auto",
        }}
      >
        {rows.map(({ ev, idx }) => {
          const home = isHomeShot(ev, weAre);
          const resultLabel = RESULT_LABEL[ev.result];
          const resultColor = RESULT_COLOR[ev.result];
          const styleSuffix =
            ev.styles && ev.styles.length > 0
              ? ` · ${ev.styles.map((s) => s.toUpperCase()).join(" ")}`
              : "";
          return (
            <li
              key={ev.client_event_id ?? `ev-${idx}`}
              style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr auto auto auto",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                background: "#0F0F1A",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 8,
                marginBottom: 6,
                fontFamily: "var(--font-inter), system-ui, sans-serif",
                fontSize: 12,
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: resultColor,
                  boxShadow: "0 0 0 2px rgba(0,0,0,0.4)",
                }}
              />
              <span
                style={{
                  color: resultColor,
                  fontWeight: 700,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                }}
              >
                {resultLabel}
                <span style={{ color: "#666677", fontWeight: 500 }}>
                  {styleSuffix}
                </span>
              </span>
              <span
                style={{
                  color: home ? "#e63946" : "#2d7dd2",
                  fontWeight: 700,
                  fontSize: 10,
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                }}
              >
                {home ? "Home" : "Away"}
              </span>
              <span
                style={{
                  color: "#888899",
                  fontSize: 10,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                }}
              >
                P{ev.period} · {formatTime(ev.t)}
              </span>
              <button
                type="button"
                onClick={() => onDelete(idx)}
                aria-label={`Delete event ${idx + 1}`}
                style={{
                  background: "transparent",
                  border: "1px solid rgba(160,54,78,0.4)",
                  color: "#A0364E",
                  borderRadius: 6,
                  width: 28,
                  height: 28,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  fontSize: 14,
                  lineHeight: 1,
                  padding: 0,
                }}
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
