/**
 * useShotTracker
 *
 * Custom React hook for client-side shot tracking state.
 * Mirrors window.state mutations from legacy index.html monolith
 * (handleRinkTap at line 2146, undoBtn handler at line 2826, REB
 * arm/disarm at lines 2581-2625, save/persist at line 956).
 *
 * Responsibilities:
 *   1. Hold TrackerState (events, period, gameState, weAre, etc.)
 *   2. Append shots via logShot()
 *   3. Pop most recent event via undoLastEvent()
 *   4. Arm + disarm rebound mode
 *   5. Queue completed game submissions for later Supabase sync
 *
 * Non-responsibilities (out of scope by design):
 *   - DOM event binding (consumer components handle pointer plumbing)
 *   - Supabase calls (stub only; sync wires up in a later phase)
 *   - Rendering (zero JSX in this file)
 *
 * Coordinate space: shot inputs land in 1000x425 viewBox px per
 * NOMOS_AUDIT. logShot clamps inbound x/y to viewBox bounds and
 * derives attackingNet from x position relative to centre line.
 */

import { useState, useCallback, useRef } from "react";
import type {
  TrackerState,
  TrackerGameInfo,
  ShotEventPayload,
  NetEventPayload,
  FaceoffPayload,
  ShotResult,
  ShotStyle,
  ForOrAgainst,
  Period,
  GameState,
  TeamSide,
  GoalieRef,
  AttackingNet,
} from "@/types/hockey";

// === Constants ===================================================

const VIEWBOX_W = 1000;
const VIEWBOX_H = 425;

const DEFAULT_STATE: TrackerState = {
  events: [],
  netEvents: [],
  faceoffs: [],
  goalies: [],
  activeGoalie: null,
  armedForRebound: false,
  lastShotIdForRebound: null,
  armTimer: null,
  pendingNetGoalTeam: null,
  period: 1,
  gameState: "5v5",
  gameStateExpiresAt: null,
  weAre: "home",
  rinkRotation: 0,
};

// === Public input + queue types ==================================

export interface LogShotInput {
  x: number;
  y: number;
  forOrAgainst: ForOrAgainst;
  result?: ShotResult;
  styles?: ShotStyle[];
  attackingNet?: AttackingNet;
}

export interface QueuedSubmission {
  id: string;
  gameId: string | null;
  events: ShotEventPayload[];
  netEvents: NetEventPayload[];
  faceoffs: FaceoffPayload[];
  createdAt: number;
  status: "pending" | "syncing" | "synced" | "failed";
  retryCount: number;
  lastError: string | null;
}

// === Helpers (pure, module-scope) ================================

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function deriveAttackingNet(x: number): AttackingNet {
  return x < VIEWBOX_W / 2 ? "left" : "right";
}

function makeClientId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "wb_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 9);
}

// === Hook ========================================================

export function useShotTracker(initial?: Partial<TrackerState>) {
  const [state, setState] = useState<TrackerState>(() => ({
    ...DEFAULT_STATE,
    ...initial,
  }));
  const [queue, setQueue] = useState<QueuedSubmission[]>([]);

  // Ref mirrors latest state so queueSubmission can read without
  // re-creating its useCallback on every state change. Ref writes
  // during render are an accepted React pattern for non-state refs.
  const stateRef = useRef<TrackerState>(state);
  stateRef.current = state;

  // --- Shot logging ---

  const logShot = useCallback((input: LogShotInput) => {
    setState((prev) => {
      const x = clamp(input.x, 0, VIEWBOX_W);
      const y = clamp(input.y, 0, VIEWBOX_H);
      const now = Date.now();
      const attackingNet = input.attackingNet ?? deriveAttackingNet(x);

      let styles: ShotStyle[] = input.styles ? [...input.styles] : [];
      let linkedTo: number | null = null;
      if (
        prev.armedForRebound &&
        prev.lastShotIdForRebound != null &&
        prev.events[prev.lastShotIdForRebound]
      ) {
        if (!styles.includes("rebound")) styles = ["rebound", ...styles];
        linkedTo = prev.lastShotIdForRebound;
      }

      const ev: ShotEventPayload = {
        client_event_id: makeClientId(),
        x,
        y,
        result: input.result ?? "shot",
        styles,
        linkedTo,
        period: prev.period,
        attackingNet,
        forOrAgainst: input.forOrAgainst,
        gameState: prev.gameState,
        weAre: prev.weAre,
        goalie:
          input.forOrAgainst === "against" && prev.activeGoalie
            ? { name: prev.activeGoalie.name, num: prev.activeGoalie.num }
            : null,
        t: now,
      };

      return {
        ...prev,
        events: [...prev.events, ev],
        armedForRebound: false,
        lastShotIdForRebound: null,
        armTimer: null,
      };
    });
  }, []);

  // --- Undo ---

  const undoLastEvent = useCallback(() => {
    setState((prev) => {
      if (prev.events.length === 0) return prev;
      return { ...prev, events: prev.events.slice(0, -1) };
    });
  }, []);

  // Mutate result on most recent event (e.g. promote "shot" to "goal"
  // or demote to "miss"). Used by transient Goal/Miss buttons in
  // ShotCanvas after a single-tap shot lands as default "shot".
  const updateLastShotResult = useCallback((result: ShotResult) => {
    setState((prev) => {
      if (prev.events.length === 0) return prev;
      const updated = [...prev.events];
      const idx = updated.length - 1;
      updated[idx] = { ...updated[idx], result };
      return { ...prev, events: updated };
    });
  }, []);

  // --- Game context setters ---

  const setPeriod = useCallback((period: Period) => {
    setState((prev) => ({ ...prev, period }));
  }, []);

  const setGameState = useCallback((gameState: GameState) => {
    setState((prev) => ({ ...prev, gameState }));
  }, []);

  const setWeAre = useCallback((weAre: TeamSide) => {
    setState((prev) => ({ ...prev, weAre }));
  }, []);

  const setActiveGoalie = useCallback((activeGoalie: GoalieRef | null) => {
    setState((prev) => ({ ...prev, activeGoalie }));
  }, []);

  const setGameInfo = useCallback((gameInfo: TrackerGameInfo) => {
    setState((prev) => ({ ...prev, gameInfo }));
  }, []);

  // --- Rebound arming ---

  const armRebound = useCallback(() => {
    setState((prev) => {
      if (prev.events.length === 0) return prev;
      return {
        ...prev,
        armedForRebound: true,
        lastShotIdForRebound: prev.events.length - 1,
      };
    });
  }, []);

  const disarmRebound = useCallback(() => {
    setState((prev) => ({
      ...prev,
      armedForRebound: false,
      lastShotIdForRebound: null,
      armTimer: null,
    }));
  }, []);

  // --- Offline submission queue (stub) ---
  //
  // Stub for now. Wires to Supabase nomos_submission + nomos_event
  // INSERT in a later phase. Today it just snapshots current event
  // arrays into a QueuedSubmission row and pushes onto queue state.
  // Consumer can observe queue.length for a pending-badge UI.

  const queueSubmission = useCallback(
    (gameId: string | null = null) => {
      const cur = stateRef.current;
      if (
        cur.events.length === 0 &&
        cur.netEvents.length === 0 &&
        cur.faceoffs.length === 0
      ) {
        return null;
      }
      const submission: QueuedSubmission = {
        id: makeClientId(),
        gameId,
        events: cur.events,
        netEvents: cur.netEvents,
        faceoffs: cur.faceoffs,
        createdAt: Date.now(),
        status: "pending",
        retryCount: 0,
        lastError: null,
      };
      setQueue((q) => [...q, submission]);
      return submission;
    },
    []
  );

  const markSynced = useCallback((submissionId: string) => {
    setQueue((q) =>
      q.map((s) =>
        s.id === submissionId ? { ...s, status: "synced" as const } : s
      )
    );
  }, []);

  const markFailed = useCallback((submissionId: string, error: string) => {
    setQueue((q) =>
      q.map((s) =>
        s.id === submissionId
          ? {
              ...s,
              status: "failed" as const,
              retryCount: s.retryCount + 1,
              lastError: error,
            }
          : s
      )
    );
  }, []);

  const clearSyncedFromQueue = useCallback(() => {
    setQueue((q) => q.filter((s) => s.status !== "synced"));
  }, []);

  // --- Reset ---

  const resetGame = useCallback(() => {
    setState((prev) => ({
      ...DEFAULT_STATE,
      weAre: prev.weAre,
      rinkRotation: prev.rinkRotation,
      goalies: prev.goalies,
    }));
  }, []);

  return {
    state,
    queue,
    logShot,
    undoLastEvent,
    updateLastShotResult,
    setPeriod,
    setGameState,
    setWeAre,
    setActiveGoalie,
    setGameInfo,
    armRebound,
    disarmRebound,
    queueSubmission,
    markSynced,
    markFailed,
    clearSyncedFromQueue,
    resetGame,
  };
}

export type UseShotTrackerReturn = ReturnType<typeof useShotTracker>;
