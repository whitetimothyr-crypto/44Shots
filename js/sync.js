// js/sync.js — 44 Shots / NOMOS offline-first sync
//
// Per-tap localStorage queue + background sync to nomos_event /
// nomos_submission. Anon scorers supported. Idempotent via
// client-generated event IDs (never-duplicate semantics on retry).
//
// Storage layout (key: nomos_sync_v1):
//   {
//     v: 1,
//     events:   { <client_id>: { client_id, game_id, submitter_id,
//                                event_type, team_side, period,
//                                timestamp_seconds, payload, submitted_at,
//                                status, attempts, last_error, synced_at } },
//     sessions: { "<game_id>__<submitter_id>": { submission_id, submitted_at } }
//   }
//
// Sync triggers:  app load, every 30s, online event, manual.
// Sync skips when: no user, no online, already syncing, no pending.

(function () {
  const SUPABASE_URL = "https://qshgschhudiryjnslzof.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_hdrc9mYaGocDhJVesn0FRw_wELl6Tnv";
  const STORAGE_KEY = "nomos_sync_v1";
  const SYNC_INTERVAL_MS = 30000;
  const DEFAULT_TRUST_WEIGHT = 0.4;

  let _client = null;
  let _syncing = false;
  let _intervalHandle = null;
  let _cachedUser = null;
  const _statusListeners = [];

  // ---------- helpers ----------
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { v: 1, events: {}, sessions: {} };
      const p = JSON.parse(raw);
      if (!p || typeof p !== "object") return { v: 1, events: {}, sessions: {} };
      if (!p.events) p.events = {};
      if (!p.sessions) p.sessions = {};
      return p;
    } catch (_) {
      return { v: 1, events: {}, sessions: {} };
    }
  }
  function saveState(state) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (_) {}
  }

  // Map legacy shape -> schema-allowed team_side. CHECK constraint on
  // nomos_event.team_side restricts to 'home' or 'away' (no null).
  function deriveTeamSide(ev) {
    let side = null;
    if (ev.weAre && ev.forOrAgainst) {
      side = ev.forOrAgainst === "for"
        ? ev.weAre
        : (ev.weAre === "home" ? "away" : "home");
    } else if (ev.weAre) {
      side = ev.weAre;
    }
    if (side !== "home" && side !== "away") side = "home";
    return side;
  }
  // Map legacy shape -> schema-allowed event_type. CHECK constraint on
  // nomos_event.event_type restricts to:
  //   'shot' | 'goal' | 'save' | 'miss' | 'faceoff_won' | 'faceoff_lost' | 'penalty'
  // Notes:
  //   - legacy result='shot' (default after tap) means "shot on goal, saved"
  //     by the goalie -> map to schema 'save'.
  //   - legacy result='block' (defender blocked) is not in the schema. Map
  //     to 'miss' (closest semantic: didn't reach the net) and preserve the
  //     original value in payload for analytics.
  //   - net zone taps mark where a goal entered -> 'goal'.
  //   - faceoffs split into faceoff_won / faceoff_lost based on
  //     ev.face_winner / ev.winner / ev.forOrAgainst.
  function deriveEventType(ev) {
    if (ev.zone) return "goal";
    if (ev.kind === "faceoff" || ev.face_winner !== undefined || ev.winner !== undefined) {
      const w = ev.face_winner || ev.winner;
      if (w === "us" || w === "for" || ev.forOrAgainst === "for") return "faceoff_won";
      return "faceoff_lost";
    }
    switch (ev.result) {
      case "shot":  return "save";
      case "goal":  return "goal";
      case "miss":  return "miss";
      case "block": return "miss";
      case "save":  return "save";
      case "penalty": return "penalty";
    }
    return "shot";
  }

  function getClient() {
    if (_client) return _client;
    if (typeof window.supabase === "undefined") return null;
    _client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
    return _client;
  }

  function emitStatus() {
    const status = getStatus();
    _statusListeners.forEach((fn) => { try { fn(status); } catch (_) {} });
  }

  // ---------- public: recordEvent ----------
  // Synchronous write to localStorage. Idempotent by client_id.
  // ev: the legacy event object (must include t, period, weAre, etc.)
  // ctx: { game_id, submitter_id, client_id }
  // If ctx.client_id is missing, one is generated and returned.
  // Returns the client_id used (caller can attach back to ev).
  function recordEvent(ev, ctx) {
    if (!ev || !ctx || !ctx.game_id) return null;
    const submitter_id = ctx.submitter_id || (_cachedUser && _cachedUser.id) || null;
    const client_id = ctx.client_id || ev._client_id || uuid();
    const state = loadState();
    const prior = state.events[client_id];
    const payloadJson = JSON.stringify(ev);
    // No-op if already synced AND payload unchanged
    if (prior && prior.status === "synced" && JSON.stringify(prior.payload) === payloadJson) {
      return client_id;
    }
    state.events[client_id] = {
      client_id,
      game_id: ctx.game_id,
      submitter_id,
      event_type: deriveEventType(ev),
      team_side: deriveTeamSide(ev),
      period: ev.period || null,
      timestamp_seconds: Math.floor((ev.t || Date.now()) / 1000),
      payload: ev,
      submitted_at: prior ? prior.submitted_at : Date.now(),
      status: "pending",
      attempts: prior ? prior.attempts || 0 : 0,
      last_error: null,
    };
    saveState(state);
    emitStatus();
    return client_id;
  }

  // ---------- internal: ensureSubmission (per session) ----------
  async function ensureSubmission(client, gameId, submitterId, weight) {
    const state = loadState();
    const key = gameId + "__" + submitterId;
    const existing = state.sessions[key];
    if (existing && existing.submission_id) return existing.submission_id;

    const { data, error } = await client
      .from("nomos_submission")
      .insert({
        game_id: gameId,
        submitter_id: submitterId,
        raw_stats: { source: "44shots-mesh", schema_v: 1 },
        weight_at_submission: weight,
        schema_v: 1,
      })
      .select("id")
      .single();
    if (error) throw new Error("nomos_submission insert: " + error.message);

    const fresh = loadState();
    fresh.sessions[key] = { submission_id: data.id, submitted_at: Date.now() };
    saveState(fresh);
    return data.id;
  }

  async function getTrustWeight(client, userId) {
    try {
      const { data } = await client
        .from("submitter_trust")
        .select("trust_score")
        .eq("submitter_id", userId)
        .single();
      return data && typeof data.trust_score === "number" ? data.trust_score : DEFAULT_TRUST_WEIGHT;
    } catch (_) {
      return DEFAULT_TRUST_WEIGHT;
    }
  }

  // ---------- public: syncPending ----------
  async function syncPending() {
    if (_syncing) return { skipped: "already_syncing" };
    if (!navigator.onLine) return { skipped: "offline" };

    let user = _cachedUser;
    if (!user && typeof FelixAuth !== "undefined") {
      try { user = await FelixAuth.getUser(); _cachedUser = user; } catch (_) {}
    }
    if (!user) return { skipped: "no_user" };

    const client = getClient();
    if (!client) return { skipped: "no_client" };

    _syncing = true;
    emitStatus();
    const result = { sent: 0, failed: 0, errors: [] };

    try {
      const state = loadState();
      const pending = Object.values(state.events).filter(
        (e) => e.status === "pending" && e.submitter_id === user.id,
      );
      if (!pending.length) {
        return { sent: 0, no_pending: true };
      }

      // Group pending by game_id so each (game, submitter) gets one submission.
      const byGame = {};
      for (const ev of pending) {
        if (!ev.game_id) continue;
        if (!byGame[ev.game_id]) byGame[ev.game_id] = [];
        byGame[ev.game_id].push(ev);
      }

      const trustWeight = await getTrustWeight(client, user.id);

      for (const gameId of Object.keys(byGame)) {
        const evs = byGame[gameId];
        let submissionId;
        try {
          submissionId = await ensureSubmission(client, gameId, user.id, trustWeight);
        } catch (e) {
          markFailed(evs, "submission: " + e.message);
          result.failed += evs.length;
          result.errors.push({ game_id: gameId, error: e.message });
          continue;
        }

        // Bulk insert events. payload includes client_event_id for replay safety.
        const rows = evs.map((ev) => ({
          submission_id: submissionId,
          event_type: ev.event_type,
          team_side: ev.team_side,
          period: ev.period,
          timestamp_seconds: ev.timestamp_seconds,
          payload: Object.assign({}, ev.payload, { client_event_id: ev.client_id }),
          schema_v: 1,
        }));
        const { error } = await client.from("nomos_event").insert(rows);
        if (error) {
          markFailed(evs, "event: " + error.message);
          result.failed += evs.length;
          result.errors.push({ game_id: gameId, error: error.message });
        } else {
          markSynced(evs);
          result.sent += evs.length;
        }
      }
    } finally {
      _syncing = false;
      emitStatus();
    }

    return result;
  }

  function markSynced(evs) {
    const state = loadState();
    const now = Date.now();
    for (const ev of evs) {
      const e = state.events[ev.client_id];
      if (!e) continue;
      e.status = "synced";
      e.synced_at = now;
      e.last_error = null;
    }
    saveState(state);
  }
  function markFailed(evs, errMsg) {
    const state = loadState();
    for (const ev of evs) {
      const e = state.events[ev.client_id];
      if (!e) continue;
      e.attempts = (e.attempts || 0) + 1;
      e.last_error = errMsg;
    }
    saveState(state);
  }

  // ---------- public: status ----------
  function getStatus() {
    const state = loadState();
    let pending = 0;
    let synced = 0;
    for (const k in state.events) {
      const e = state.events[k];
      if (e.status === "pending") pending++;
      else if (e.status === "synced") synced++;
    }
    return {
      online: typeof navigator !== "undefined" ? navigator.onLine : true,
      pending,
      synced,
      syncing: _syncing,
    };
  }
  function onStatusChange(fn) {
    _statusListeners.push(fn);
    return () => {
      const i = _statusListeners.indexOf(fn);
      if (i >= 0) _statusListeners.splice(i, 1);
    };
  }

  window.NomosSync = {
    recordEvent,
    syncPending,
    getStatus,
    onStatusChange,
    _loadState: loadState, // exposed for debugging only
  };

  // ---------- triggers ----------
  function start() {
    // Cache the auth user so recordEvent can resolve submitter_id synchronously.
    if (typeof FelixAuth !== "undefined" && FelixAuth.onAuthChange) {
      FelixAuth.onAuthChange((evt) => {
        _cachedUser = evt && evt.session ? evt.session.user : null;
        emitStatus();
      });
      // Initial cache
      FelixAuth.getUser().then((u) => { _cachedUser = u; emitStatus(); }).catch(() => {});
    }
    if (_intervalHandle) clearInterval(_intervalHandle);
    _intervalHandle = setInterval(() => {
      syncPending().catch((e) => console.warn("[NomosSync] timer:", e && e.message));
    }, SYNC_INTERVAL_MS);
    // Initial flush — give auth + game.js a beat to settle.
    setTimeout(() => {
      syncPending().catch((e) => console.warn("[NomosSync] load:", e && e.message));
    }, 1500);
  }

  window.addEventListener("online", () => {
    emitStatus();
    syncPending().catch((e) => console.warn("[NomosSync] online:", e && e.message));
  });
  window.addEventListener("offline", () => emitStatus());

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
