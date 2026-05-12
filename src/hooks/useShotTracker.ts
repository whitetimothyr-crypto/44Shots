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
 *   - Direct Supabase calls (delegated to sync-worker via startAutoSync)
 *   - Rendering (zero JSX in this file)
 *
 * Coordinate space: shot inputs land in 1000x425 viewBox px per
 * NOMOS_AUDIT. logShot clamps inbound x/y to viewBox bounds and
 * derives attackingNet from x position relative to centre line.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import {
  saveToQueue,
  getPendingQueue,
  markAsSynced,
} from "@/lib/indexed-db";
import { startAutoSync } from "@/lib/sync-worker";
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

// Ported from index.html:2030-2039 (rink-tap constants).
export const REBOUND_LINK_MAX_AGE_MS = 5000;
export const DOUBLE_TAP_MS = 280;
export const DOUBLE_TAP_MOVE_TOL = 40;
const JITTER_RADIUS = 8;
const JITTER_AMOUNT = 3;

// Ported from index.html:2042-2048 (settings defaults). For Phase 2
// transplant only reboundMode + reboundWindowSec matter; rest of
// legacy settings (seenWhatsNew, seenGestureHints) are UI-shell
// concerns not yet ported.
export type ReboundMode = "time" | "doubletap" | "both" | "off";
export interface TrackerSettings {
  reboundMode: ReboundMode;
  reboundWindowSec: 1 | 2 | 3;
}
const DEFAULT_SETTINGS: TrackerSettings = {
  reboundMode: "doubletap",
  reboundWindowSec: 3,
};

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

/**
 * Pure helper ported from index.html:1897-1904. Resolves which net
 * "our" goalie defends in a given period, accounting for ends-swap
 * at P2. Home defends left in P1/P3, right in P2.
 */
export function getOurDefendingSide(
  period: Period,
  weAre: TeamSide
): AttackingNet {
  const homeSide: AttackingNet = period === 2 ? "right" : "left";
  if (weAre === "home") return homeSide;
  return homeSide === "left" ? "right" : "left";
}

/**
 * Jitter helper ported from index.html:2071-2084. If new point lands
 * within JITTER_RADIUS of any same-period existing event, nudge it
 * JITTER_AMOUNT in a random direction so markers stay visually
 * distinct. Pure: no state mutation.
 */
function applyJitter(
  events: ShotEventPayload[],
  period: Period,
  x: number,
  y: number
): { x: number; y: number } {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.period !== period) continue;
    const dx = ev.x - x;
    const dy = ev.y - y;
    if (Math.sqrt(dx * dx + dy * dy) < JITTER_RADIUS) {
      const ang = Math.random() * Math.PI * 2;
      return {
        x: x + Math.cos(ang) * JITTER_AMOUNT,
        y: y + Math.sin(ang) * JITTER_AMOUNT,
      };
    }
  }
  return { x, y };
}

function makeClientId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "wb_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 9);
}

// === Persistence keys (match legacy js/db.js + index.html:2042) ===
const STATE_STORAGE_KEY = "felix-shot-tracker-v1";
const SETTINGS_STORAGE_KEY = "felix-settings-v6";

function hasLocalStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

// === Hook ========================================================

export function useShotTracker(initial?: Partial<TrackerState>) {
  const [state, setState] = useState<TrackerState>(() => ({
    ...DEFAULT_STATE,
    ...initial,
  }));
  const [queue, setQueue] = useState<QueuedSubmission[]>([]);
  const [settings, setSettings] = useState<TrackerSettings>(DEFAULT_SETTINGS);

  // Track whether localStorage hydration has completed. Persist
  // effects skip writing until hydrate finishes so a brief default-
  // state render doesn't overwrite stored data before load.
  const hydratedRef = useRef<boolean>(false);

  // Ref mirrors latest state so queueSubmission can read without
  // re-creating its useCallback on every state change. Ref writes
  // during render are an accepted React pattern for non-state refs.
  const stateRef = useRef<TrackerState>(state);
  stateRef.current = state;

  // Hydrate state + settings from localStorage on mount. Mirrors
  // legacy keys felix-shot-tracker-v1 (state) + felix-settings-v6
  // (settings) so a Next.js refresh after legacy use loads same
  // data shape. armTimer is non-serializable so any persisted value
  // is dropped on load.
  useEffect(() => {
    if (!hasLocalStorage()) {
      hydratedRef.current = true;
      return;
    }
    try {
      const raw = window.localStorage.getItem(STATE_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<TrackerState>;
        setState((prev) => ({ ...prev, ...parsed, armTimer: null }));
      }
    } catch (err) {
      console.warn("[useShotTracker] state hydrate failed", err);
    }
    try {
      const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<TrackerSettings>;
        setSettings((prev) => ({ ...prev, ...parsed }));
      }
    } catch (err) {
      console.warn("[useShotTracker] settings hydrate failed", err);
    }
    hydratedRef.current = true;
  }, []);

  // Persist state to localStorage on every change after hydrate.
  // Strips armTimer (setTimeout handle) since it cannot serialize.
  useEffect(() => {
    if (!hydratedRef.current || !hasLocalStorage()) return;
    try {
      const { armTimer: _armTimer, ...persistable } = state;
      window.localStorage.setItem(
        STATE_STORAGE_KEY,
        JSON.stringify(persistable)
      );
    } catch (err) {
      console.warn("[useShotTracker] state persist failed", err);
    }
  }, [state]);

  useEffect(() => {
    if (!hydratedRef.current || !hasLocalStorage()) return;
    try {
      window.localStorage.setItem(
        SETTINGS_STORAGE_KEY,
        JSON.stringify(settings)
      );
    } catch (err) {
      console.warn("[useShotTracker] settings persist failed", err);
    }
  }, [settings]);

  // Hydrate pending queue from IndexedDB on mount. Safe no-op on
  // SSR or unsupported browsers (indexed-db.ts returns []).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pending = await getPendingQueue();
        if (!cancelled && pending.length > 0) {
          setQueue((q) => {
            const known = new Set(q.map((s) => s.id));
            const fresh = pending.filter((s) => !known.has(s.id));
            return fresh.length === 0 ? q : [...q, ...fresh];
          });
        }
      } catch (err) {
        console.warn("[useShotTracker] hydrate failed", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-sync: drain pending submissions to Supabase on mount and
  // whenever navigator goes back online. Worker handles IDB row flip;
  // callback below mirrors that flip into React state so a "pending"
  // badge can disappear without a manual refresh.
  useEffect(() => {
    const detach = startAutoSync({
      onSubmissionSynced: (id: string) => {
        setQueue((q) =>
          q.map((s) => (s.id === id ? { ...s, status: "synced" as const } : s))
        );
      },
    });
    return detach;
  }, []);

  // --- Shot logging ---
  //
  // Ported from index.html:2206-2289 (post-double-tap branch of
  // handleRinkTap). Double-tap gesture detection itself lives in
  // ShotCanvas pointer handler because it needs DOM-event timestamps;
  // on a confirmed dbl-tap ShotCanvas calls markLastShotAsRebound
  // instead of logShot.
  //
  // Caller responsibilities (handled in ShotCanvas):
  //   - bounds check, zone-based attackingNet derivation
  //   - neutral-zone team chooser to resolve forOrAgainst
  //   - 80ms anti-jitter pointer gate
  //
  // Tracker responsibilities (this function):
  //   - armed-mode rebound link (REB button flow)
  //   - time-mode rebound auto-tag (settings.reboundMode time/both)
  //   - applyJitter to nudge if landing on existing same-period marker
  //   - push event, mirror lastPlacement in returned shape via lastShotIdForRebound disarm side-effect

  const logShot = useCallback((input: LogShotInput): number | null => {
    let newIdx: number | null = null;
    setState((prev) => {
      const cx = clamp(input.x, 0, VIEWBOX_W);
      const cy = clamp(input.y, 0, VIEWBOX_H);
      const now = Date.now();
      const attackingNet = input.attackingNet ?? deriveAttackingNet(cx);
      const period = prev.period;

      // Resolve rebound: armed mode wins. Otherwise time-mode walks
      // back recent events looking for a save on same net.
      let styles: ShotStyle[] = input.styles ? [...input.styles] : [];
      let linkedTo: number | null = null;
      let isRebound = false;

      const armedOk =
        prev.armedForRebound &&
        prev.lastShotIdForRebound != null &&
        prev.events[prev.lastShotIdForRebound] != null;

      if (armedOk) {
        isRebound = true;
        linkedTo = prev.lastShotIdForRebound;
      } else {
        const mode = settings.reboundMode;
        const checkTime = mode === "time" || mode === "both";
        if (checkTime) {
          const winMs = settings.reboundWindowSec * 1000;
          for (let i = prev.events.length - 1; i >= 0; i--) {
            const candidate = prev.events[i];
            if (candidate.period !== period) break;
            if (now - candidate.t > winMs) break;
            if (candidate.result !== "shot") break;
            if (candidate.attackingNet !== attackingNet) break;
            isRebound = true;
            linkedTo = i;
            break;
          }
        }
      }
      if (isRebound && !styles.includes("rebound")) {
        styles = ["rebound", ...styles];
      }

      // Apply jitter so same-spot taps stay visually distinct.
      const j = applyJitter(prev.events, period, cx, cy);

      const ev: ShotEventPayload = {
        client_event_id: makeClientId(),
        x: j.x,
        y: j.y,
        result: input.result ?? "shot",
        styles,
        linkedTo,
        period,
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

      newIdx = prev.events.length;
      return {
        ...prev,
        events: [...prev.events, ev],
        armedForRebound: false,
        lastShotIdForRebound: null,
        armTimer: null,
      };
    });
    return newIdx;
  }, [settings]);

  // Double-tap rebound dispatch. Ported from index.html:2169-2204.
  // ShotCanvas decides "this was a double-tap" via pointer-event
  // timestamps. On dispatch we mutate that just-placed marker into
  // a rebound, linked to a prior same-net same-period shot found
  // within REBOUND_LINK_MAX_AGE_MS. No new event is placed.
  //
  // Returns true if a rebound was applied; false if just-placed idx
  // is stale or out of bounds.
  const markLastShotAsRebound = useCallback(
    (justPlacedIdx: number): boolean => {
      let applied = false;
      setState((prev) => {
        const justPlaced = prev.events[justPlacedIdx];
        if (!justPlaced) return prev;

        // Find a prior shot in same period attacking same net,
        // within 5s of justPlaced. Bail (priorIdx stays -1) if none.
        let priorIdx = -1;
        for (let i = justPlacedIdx - 1; i >= 0; i--) {
          const candidate = prev.events[i];
          if (candidate.period !== prev.period) {
            if (candidate.period < prev.period) break;
            continue;
          }
          if (candidate.attackingNet !== justPlaced.attackingNet) continue;
          if (justPlaced.t - candidate.t > REBOUND_LINK_MAX_AGE_MS) break;
          priorIdx = i;
          break;
        }

        const styles: ShotStyle[] = justPlaced.styles
          ? [...justPlaced.styles]
          : [];
        if (!styles.includes("rebound")) styles.push("rebound");
        const updated = { ...justPlaced, styles, linkedTo: priorIdx >= 0 ? priorIdx : null };
        const events = [...prev.events];
        events[justPlacedIdx] = updated;
        applied = true;
        return { ...prev, events };
      });
      return applied;
    },
    []
  );

  // --- Delete by index ---
  //
  // Ports legacy epDelete handler (index.html:2742-2750). Splices a
  // single event out of state.events. Note legacy does NOT re-map
  // linkedTo references on subsequent events, so a delete can leave
  // stale linkedTo indices. Render-side guards in ShotCanvas
  // (origin == null check) keep this from drawing wrong link lines.
  const deleteEventAt = useCallback((idx: number) => {
    setState((prev) => {
      if (idx < 0 || idx >= prev.events.length) return prev;
      const events = [...prev.events.slice(0, idx), ...prev.events.slice(idx + 1)];
      return { ...prev, events };
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
  //
  // Ports legacy edit-popover goal branch (index.html:2645-2649):
  // when result becomes "goal", auto-set pendingNetGoalTeam so a
  // Net panel switch can tag where it went in. Preserves existing
  // pendingNetGoalTeam value on other results.
  const updateLastShotResult = useCallback((result: ShotResult) => {
    setState((prev) => {
      if (prev.events.length === 0) return prev;
      const updated = [...prev.events];
      const idx = updated.length - 1;
      const next = { ...updated[idx], result };
      updated[idx] = next;
      const pendingNetGoalTeam =
        result === "goal"
          ? next.forOrAgainst || "against"
          : prev.pendingNetGoalTeam;
      return { ...prev, events: updated, pendingNetGoalTeam };
    });
  }, []);

  // --- Net events (Phase 4) ---
  //
  // Ports handleNetTap (index.html:2965-2988): pushes a NetEventPayload
  // tagged with team derived from pendingNetGoalTeam (or "against" as
  // default per legacy 2972). Clears pendingNetGoalTeam after.
  const logNetEvent = useCallback(
    (input: {
      x: number;
      y: number;
      zone: string;
    }): NetEventPayload | null => {
      let pushed: NetEventPayload | null = null;
      setState((prev) => {
        const team: ForOrAgainst = prev.pendingNetGoalTeam || "against";
        const ev: NetEventPayload = {
          client_event_id: makeClientId(),
          zone: 0, // unused numeric slot in payload type; zone label below
          result: "goal",
          period: prev.period,
          forOrAgainst: team,
          gameState: prev.gameState,
          weAre: prev.weAre,
          goalie: prev.activeGoalie
            ? { name: prev.activeGoalie.name, num: prev.activeGoalie.num }
            : null,
          t: Date.now(),
          // Carry geometry + zone label as payload extras. Type's
          // numeric zone field stays as 0 placeholder; consumers read
          // these instead.
          ...{ _x: input.x, _y: input.y, _zoneLabel: input.zone },
        } as NetEventPayload;
        pushed = ev;
        return {
          ...prev,
          netEvents: [...prev.netEvents, ev],
          pendingNetGoalTeam: null,
        };
      });
      return pushed;
    },
    []
  );

  // Ports legacy undoNetBtn handler (index.html:3007). Pops most-recent
  // net event.
  const undoLastNetEvent = useCallback(() => {
    setState((prev) => {
      if (prev.netEvents.length === 0) return prev;
      return { ...prev, netEvents: prev.netEvents.slice(0, -1) };
    });
  }, []);

  // Ports legacy clearNetBtn intent (index.html:1014). Wipes all net
  // events for current game.
  const clearNetEvents = useCallback(() => {
    setState((prev) => ({ ...prev, netEvents: [] }));
  }, []);

  // Manual setter for pendingNetGoalTeam. Lets a coach pre-arm a net
  // tap without going through a goal-result toggle (matches legacy
  // "Net taps stand alone too" tip at index.html:1017).
  const setPendingNetGoalTeam = useCallback(
    (team: ForOrAgainst | null) => {
      setState((prev) => ({ ...prev, pendingNetGoalTeam: team }));
    },
    []
  );

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

  // --- Offline submission queue ---
  //
  // Snapshots current event arrays into a QueuedSubmission row,
  // persists to IndexedDB via saveToQueue, then pushes onto local
  // queue state. Background sync-worker drains pending rows to
  // nomos_submission + nomos_event whenever connectivity allows.
  // Consumer can observe queue.length for a pending-badge UI.

  const queueSubmission = useCallback(
    async (gameId: string | null = null): Promise<QueuedSubmission | null> => {
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
      try {
        await saveToQueue(submission);
      } catch (err) {
        console.warn("[useShotTracker] saveToQueue threw", err);
      }
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
    void markAsSynced(submissionId).catch((err) => {
      console.warn("[useShotTracker] markAsSynced threw", err);
    });
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
    settings,
    setSettings,
    queue,
    logShot,
    markLastShotAsRebound,
    deleteEventAt,
    logNetEvent,
    undoLastNetEvent,
    clearNetEvents,
    setPendingNetGoalTeam,
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
