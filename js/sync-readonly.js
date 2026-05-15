// js/sync-readonly.js — read-only consumer of locked sync/db modules
//
// Source-of-truth modules (all locked byte-for-byte; this file does
// NOT modify them):
//   - js/sync.js (NomosSync.getStatus -> { online, pending, synced, syncing })
//   - js/db.js   (FelixDB.getSession -> Promise<sessionObj | null>;
//                 sessionObj fields set in js/game.js: active_game_id,
//                 active_game_code)
//   - localStorage felix-shot-tracker-v1 (state shape per game-engine.js):
//       { events: [ { t, ... } ], netEvents, gameInfo: { opponent,
//         configured, ... }, status?, ... }
//
// No writes anywhere (no IndexedDB writes, no localStorage writes,
// no Supabase writes). Used by js/entry.js (B3) to populate the
// Hub's Rejoin tile and status strip.

(function () {
  const SHOT_TRACKER_KEY = "felix-shot-tracker-v1";

  function _warn(msg, err) {
    try { console.warn("[NomosSyncReadOnly]", msg, err && err.message ? err.message : err); }
    catch (_) {}
  }

  function _readShotTracker() {
    try {
      const raw = localStorage.getItem(SHOT_TRACKER_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      // Defensive: a state still flagged 'completed'/'finalized' is the
      // residue of an aborted End Game flow (see game-engine.js B3
      // hydration guard). Treat as no resumable game.
      if (parsed && (parsed.status === "completed" || parsed.status === "finalized")) {
        return null;
      }
      return parsed;
    } catch (e) {
      _warn("readShotTracker parse failed", e);
      return null;
    }
  }

  function _maxEventTimestamp(state) {
    if (!state || !Array.isArray(state.events) || state.events.length === 0) return null;
    let max = 0;
    for (let i = 0; i < state.events.length; i++) {
      const t = state.events[i] && state.events[i].t;
      if (typeof t === "number" && t > max) max = t;
    }
    return max > 0 ? max : null;
  }

  async function peekResumable() {
    if (typeof window === "undefined" || typeof window.FelixDB === "undefined") {
      return null;
    }
    let session = null;
    try {
      session = await window.FelixDB.getSession();
    } catch (e) {
      _warn("FelixDB.getSession failed", e);
      return null;
    }
    if (!session || !session.active_game_id) return null;

    const local = _readShotTracker();
    const rawOpp = local && local.gameInfo && local.gameInfo.opponent;
    const opponent = (typeof rawOpp === "string" && rawOpp.trim())
      ? rawOpp.trim()
      : "your last game";

    return {
      id: session.active_game_id,
      code: session.active_game_code || null,
      opponent: opponent,
      last_active_at: _maxEventTimestamp(local)
    };
  }

  function pendingCount() {
    if (typeof window === "undefined"
        || typeof window.NomosSync === "undefined"
        || typeof window.NomosSync.getStatus !== "function") {
      return 0;
    }
    try {
      const s = window.NomosSync.getStatus();
      return (s && typeof s.pending === "number") ? s.pending : 0;
    } catch (e) {
      _warn("NomosSync.getStatus failed", e);
      return 0;
    }
  }

  window.NomosSyncReadOnly = {
    peekResumable: peekResumable,
    pendingCount: pendingCount
  };
})();
