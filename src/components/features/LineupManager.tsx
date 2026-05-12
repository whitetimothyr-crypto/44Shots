"use client";

/**
 * LineupManager
 *
 * Local-only roster + line combinations panel for Phase 5.
 * Persistence + Supabase wiring deferred.
 *
 * Scope vs legacy js/lineup.js (834 lines) + js/lineup-api.js
 * (408 lines, Supabase-backed):
 *   PORTED:
 *     - Roster per team (add / remove player)
 *     - Line combination grid (4 lines x 5 position slots)
 *     - Position labels matching legacy slot_position enum
 *       (LW, C, RW, LD, RD)
 *   DEFERRED:
 *     - Persistence to public.lineup_configs + public.lineup_slots
 *       via FelixLineupApi
 *     - Multi-config support (named lineups per team)
 *     - Drag-and-drop slot assignment from a SortableJS list
 *     - Group labels / group order (legacy lineup_slots schema)
 *     - Per-player handedness, position constraints, jersey assignment
 *
 * State lives in this component only. A future phase can lift it
 * to a tracker context or a Supabase-backed hook without changing
 * presentational shape.
 */

import { useCallback, useState } from "react";

type Team = "home" | "away";
type Slot = "lw" | "c" | "rw" | "ld" | "rd";

interface Player {
  id: string;
  num: string;
  name: string;
}

interface TeamState {
  roster: Player[];
  lines: Record<number, Partial<Record<Slot, string>>>; // line 1..4 -> slot -> playerId
}

const SLOTS: Slot[] = ["lw", "c", "rw", "ld", "rd"];
const SLOT_LABEL: Record<Slot, string> = {
  lw: "LW",
  c: "C",
  rw: "RW",
  ld: "LD",
  rd: "RD",
};
const LINES = [1, 2, 3, 4];
const HOME_COLOR = "#e63946";
const AWAY_COLOR = "#2d7dd2";
const ACCENT = "#C9A84C";

function makeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "p_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 9);
}

function emptyTeam(): TeamState {
  return {
    roster: [],
    lines: { 1: {}, 2: {}, 3: {}, 4: {} },
  };
}

interface RosterFormProps {
  onAdd: (num: string, name: string) => void;
  color: string;
}

function RosterForm({ onAdd, color }: RosterFormProps) {
  const [num, setNum] = useState("");
  const [name, setName] = useState("");
  const canAdd = name.trim().length > 0;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canAdd) return;
    onAdd(num.trim() || "?", name.trim());
    setNum("");
    setName("");
  };

  const inputBase: React.CSSProperties = {
    background: "#080810",
    color: "#E8E8E0",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 6,
    padding: "8px 10px",
    fontFamily: "var(--font-inter), system-ui, sans-serif",
    fontSize: 12,
    minHeight: 36,
    boxSizing: "border-box",
  };

  return (
    <form
      onSubmit={onSubmit}
      style={{ display: "grid", gridTemplateColumns: "80px 1fr 80px", gap: 6 }}
      aria-label="Add player"
    >
      <input
        type="text"
        value={num}
        onChange={(e) => setNum(e.target.value)}
        placeholder="#"
        aria-label="Jersey number"
        style={inputBase}
      />
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Player name"
        aria-label="Player name"
        style={inputBase}
      />
      <button
        type="submit"
        disabled={!canAdd}
        style={{
          background: canAdd ? color : "rgba(255,255,255,0.06)",
          color: canAdd ? "#080810" : "#444450",
          border: 0,
          borderRadius: 6,
          padding: "6px 8px",
          fontFamily: "var(--font-inter), system-ui, sans-serif",
          fontWeight: 800,
          fontSize: 10,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          cursor: canAdd ? "pointer" : "not-allowed",
          minHeight: 36,
        }}
      >
        Add
      </button>
    </form>
  );
}

interface TeamPanelProps {
  label: string;
  color: string;
  state: TeamState;
  onUpdate: (next: TeamState) => void;
}

function TeamPanel({ label, color, state, onUpdate }: TeamPanelProps) {
  const onAdd = useCallback(
    (num: string, name: string) => {
      const newPlayer: Player = { id: makeId(), num, name };
      onUpdate({ ...state, roster: [...state.roster, newPlayer] });
    },
    [state, onUpdate]
  );

  const onRemove = useCallback(
    (id: string) => {
      const roster = state.roster.filter((p) => p.id !== id);
      const lines: TeamState["lines"] = {};
      for (const line of LINES) {
        const cleaned: Partial<Record<Slot, string>> = {};
        for (const slot of SLOTS) {
          const v = state.lines[line]?.[slot];
          if (v && v !== id) cleaned[slot] = v;
        }
        lines[line] = cleaned;
      }
      onUpdate({ roster, lines });
    },
    [state, onUpdate]
  );

  const onAssign = useCallback(
    (line: number, slot: Slot, playerId: string) => {
      const lines: TeamState["lines"] = { ...state.lines };
      const current = { ...(lines[line] || {}) };
      if (playerId === "") {
        delete current[slot];
      } else {
        current[slot] = playerId;
      }
      lines[line] = current;
      onUpdate({ ...state, lines });
    },
    [state, onUpdate]
  );

  return (
    <section
      style={{
        background: "#0F0F1A",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 12,
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
      aria-label={`${label} team lineup`}
    >
      <header style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          aria-hidden="true"
          style={{ width: 10, height: 10, borderRadius: "50%", background: color }}
        />
        <h3
          style={{
            margin: 0,
            fontFamily: "var(--font-inter), system-ui, sans-serif",
            fontSize: 12,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: "#E8E8E0",
            fontWeight: 800,
          }}
        >
          {label}
        </h3>
        <span style={{ marginLeft: "auto", color: "#666677", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase" }}>
          {state.roster.length} player{state.roster.length === 1 ? "" : "s"}
        </span>
      </header>

      <RosterForm onAdd={onAdd} color={color} />

      {state.roster.length > 0 && (
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
            gap: 4,
          }}
          aria-label="Roster"
        >
          {state.roster.map((p) => (
            <li
              key={p.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 8px",
                background: "#080810",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 6,
                fontFamily: "var(--font-inter), system-ui, sans-serif",
                fontSize: 11,
              }}
            >
              <span style={{ color: color, fontWeight: 800, minWidth: 18, textAlign: "right" }}>
                #{p.num}
              </span>
              <span style={{ color: "#E8E8E0", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {p.name}
              </span>
              <button
                type="button"
                onClick={() => onRemove(p.id)}
                aria-label={`Remove ${p.name}`}
                style={{
                  background: "transparent",
                  border: "1px solid rgba(160,54,78,0.4)",
                  color: "#A0364E",
                  borderRadius: 4,
                  width: 20,
                  height: 20,
                  fontSize: 12,
                  cursor: "pointer",
                  padding: 0,
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto repeat(5, 1fr)",
          gap: 4,
          fontFamily: "var(--font-inter), system-ui, sans-serif",
        }}
        aria-label="Line combinations"
      >
        <div />
        {SLOTS.map((s) => (
          <div
            key={`hdr-${s}`}
            style={{
              fontSize: 9,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "#666677",
              fontWeight: 800,
              textAlign: "center",
              padding: "2px 0",
            }}
          >
            {SLOT_LABEL[s]}
          </div>
        ))}
        {LINES.map((line) => (
          <Row
            key={`line-${line}`}
            lineNum={line}
            slots={SLOTS}
            roster={state.roster}
            assignments={state.lines[line] || {}}
            onAssign={onAssign}
          />
        ))}
      </div>
    </section>
  );
}

interface RowProps {
  lineNum: number;
  slots: Slot[];
  roster: Player[];
  assignments: Partial<Record<Slot, string>>;
  onAssign: (line: number, slot: Slot, playerId: string) => void;
}

function Row({ lineNum, slots, roster, assignments, onAssign }: RowProps) {
  return (
    <>
      <div
        style={{
          fontSize: 10,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: ACCENT,
          fontWeight: 800,
          textAlign: "center",
          padding: "8px 4px",
          alignSelf: "center",
        }}
      >
        L{lineNum}
      </div>
      {slots.map((slot) => {
        const assignedId = assignments[slot] || "";
        return (
          <select
            key={`${lineNum}-${slot}`}
            value={assignedId}
            onChange={(e) => onAssign(lineNum, slot, e.target.value)}
            aria-label={`Line ${lineNum} ${SLOT_LABEL[slot]}`}
            style={{
              background: "#080810",
              color: "#E8E8E0",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 4,
              padding: "6px 4px",
              fontFamily: "var(--font-inter), system-ui, sans-serif",
              fontSize: 10,
              minHeight: 32,
              cursor: "pointer",
              appearance: "none",
              WebkitAppearance: "none",
            }}
          >
            <option value="">--</option>
            {roster.map((p) => (
              <option key={p.id} value={p.id}>
                #{p.num} {p.name}
              </option>
            ))}
          </select>
        );
      })}
    </>
  );
}

export default function LineupManager() {
  const [home, setHome] = useState<TeamState>(emptyTeam);
  const [away, setAway] = useState<TeamState>(emptyTeam);

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
      aria-label="Lineup manager"
    >
      <div
        style={{
          maxWidth: 1000,
          marginLeft: "auto",
          marginRight: "auto",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))",
          gap: 12,
        }}
      >
        <TeamPanel
          label="Home"
          color={HOME_COLOR}
          state={home}
          onUpdate={setHome}
        />
        <TeamPanel
          label="Away"
          color={AWAY_COLOR}
          state={away}
          onUpdate={setAway}
        />
      </div>
    </div>
  );
}
