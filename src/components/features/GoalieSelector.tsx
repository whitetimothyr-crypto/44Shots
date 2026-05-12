"use client";

/**
 * GoalieSelector
 *
 * Compact form for setting state.activeGoalie (name + number + hand).
 * Ports goalie-set flow scattered across legacy load-game modal
 * (index.html:3660-3669) and goalie-change modal
 * (index.html:3845-3879). Both legacy flows live in modals tied to
 * game-create / game-day substitution; Phase 4 surfaces this inline
 * inside NetPanel since net-zone label math depends on goalie.hand.
 *
 * Active goalie is shown with edit affordance. On submit, full
 * {name, num, hand} record is stored via tracker.setActiveGoalie.
 * Legacy startedAt / eventStartIdx fields are NOT tracked here
 * (substitution-spans logic not yet ported).
 */

import { useCallback, useState } from "react";
import type { UseShotTrackerReturn } from "@/hooks/useShotTracker";

interface Props {
  tracker: UseShotTrackerReturn;
}

export default function GoalieSelector({ tracker }: Props) {
  const active = tracker.state.activeGoalie;
  const [editing, setEditing] = useState<boolean>(!active);
  const [name, setName] = useState<string>(active?.name ?? "");
  const [num, setNum] = useState<string>(active ? String(active.num) : "");
  const [hand, setHand] = useState<"left" | "right">(active?.hand ?? "left");

  const onSave = useCallback(() => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    tracker.setActiveGoalie({
      name: trimmedName,
      num: num.trim() || "?",
      hand,
    });
    setEditing(false);
  }, [name, num, hand, tracker]);

  const onEdit = useCallback(() => setEditing(true), []);

  const inputBase: React.CSSProperties = {
    background: "#080810",
    color: "#E8E8E0",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 6,
    padding: "8px 10px",
    fontFamily: "var(--font-inter), system-ui, sans-serif",
    fontSize: 12,
    letterSpacing: "0.04em",
    minHeight: 36,
    boxSizing: "border-box",
  };

  if (!editing && active) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "10px 12px",
          background: "#0F0F1A",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 10,
          fontFamily: "var(--font-inter), system-ui, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              fontSize: 10,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "#666677",
              fontWeight: 700,
            }}
          >
            Active Goalie
          </span>
          <span
            style={{
              fontSize: 13,
              color: "#E8E8E0",
              fontWeight: 700,
              letterSpacing: "0.04em",
            }}
          >
            #{active.num} {active.name}
          </span>
          <span
            style={{
              fontSize: 10,
              color: "#888899",
              letterSpacing: "0.14em",
              textTransform: "uppercase",
            }}
          >
            {hand === "right" ? "Full Right" : "Regular"}
          </span>
        </div>
        <button
          type="button"
          onClick={onEdit}
          style={{
            minHeight: 36,
            padding: "6px 12px",
            background: "transparent",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 6,
            color: "#E8E8E0",
            fontFamily: "var(--font-inter), system-ui, sans-serif",
            fontSize: 10,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            fontWeight: 700,
            cursor: "pointer",
          }}
          aria-label="Edit goalie"
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
      style={{
        display: "grid",
        gap: 8,
        padding: "12px",
        background: "#0F0F1A",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 10,
      }}
      aria-label="Set active goalie"
    >
      <div
        style={{
          fontSize: 10,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "#C9A84C",
          fontWeight: 800,
        }}
      >
        Set Goalie
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 90px",
          gap: 8,
        }}
      >
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          aria-label="Goalie name"
          style={inputBase}
        />
        <input
          type="text"
          value={num}
          onChange={(e) => setNum(e.target.value)}
          placeholder="#"
          aria-label="Jersey number"
          style={inputBase}
        />
      </div>
      <div
        role="radiogroup"
        aria-label="Catch hand"
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0, borderRadius: 6, overflow: "hidden", border: "1px solid rgba(255,255,255,0.12)" }}
      >
        {(["left", "right"] as const).map((h) => {
          const on = hand === h;
          return (
            <button
              key={h}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setHand(h)}
              style={{
                padding: "8px 6px",
                background: on ? "#C9A84C" : "transparent",
                color: on ? "#080810" : "#888899",
                border: 0,
                fontFamily: "var(--font-inter), system-ui, sans-serif",
                fontWeight: 700,
                fontSize: 10,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                cursor: "pointer",
                minHeight: 36,
              }}
            >
              {h === "left" ? "Regular (L)" : "Full Right"}
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        {active ? (
          <button
            type="button"
            onClick={() => setEditing(false)}
            style={{
              minHeight: 36,
              padding: "6px 12px",
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 6,
              color: "#888899",
              fontFamily: "var(--font-inter), system-ui, sans-serif",
              fontSize: 10,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
        ) : null}
        <button
          type="submit"
          disabled={!name.trim()}
          style={{
            minHeight: 36,
            padding: "6px 14px",
            background: name.trim() ? "#C9A84C" : "rgba(201,168,76,0.3)",
            border: 0,
            borderRadius: 6,
            color: "#080810",
            fontFamily: "var(--font-inter), system-ui, sans-serif",
            fontSize: 10,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            fontWeight: 800,
            cursor: name.trim() ? "pointer" : "not-allowed",
          }}
        >
          Save
        </button>
      </div>
    </form>
  );
}
