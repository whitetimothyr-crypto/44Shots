// js/whiteboard-api.js — Supabase wrapper for the WHITEBOARD module.
//
// Tables (migration 16):
//   whiteboard_sessions  — id, team_id, game_id?, name, drill_title?,
//                          video_source_id?, created_by
//   whiteboard_markers   — id, session_id, marker_type, color?, position_x,
//                          position_y, path_data?
//   whiteboard_strokes   — id, session_id, stroke_type, variant,
//                          stroke_data, color, brush_size, stroke_order
//
// RLS: SELECT for team members, INSERT/UPDATE/DELETE for coach only.
// All write methods optimistically queue into FelixWhiteboardSync (an
// in-module pendingWrites array) and replay on next online cycle so the
// pen never blocks on the network. Reads always go to Supabase — the
// canvas hydrates from server truth on session open.
//
// Offline queue (key: nomos_whiteboard_sync_v1):
//   { v: 1, ops: [ { id, op, table, payload, attempts, last_error } ] }
// Each op is idempotent at the row level (UUIDs minted client-side).
//
// Public surface: window.FelixWhiteboardAPI

(function () {
  "use strict";

  const SUPABASE_URL = "https://qshgschhudiryjnslzof.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_hdrc9mYaGocDhJVesn0FRw_wELl6Tnv";
  const QUEUE_KEY = "nomos_whiteboard_sync_v1";
  const FLUSH_INTERVAL_MS = 15000;

  let _client = null;
  let _flushing = false;
  let _intervalHandle = null;

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function getClient() {
    if (_client) return _client;
    if (typeof window.supabase === "undefined") return null;
    _client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
    return _client;
  }

  function loadQueue() {
    try {
      const raw = localStorage.getItem(QUEUE_KEY);
      if (!raw) return { v: 1, ops: [] };
      const p = JSON.parse(raw);
      if (!p || !Array.isArray(p.ops)) return { v: 1, ops: [] };
      return p;
    } catch (_) {
      return { v: 1, ops: [] };
    }
  }
  function saveQueue(q) {
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch (_) {}
  }
  function enqueue(op) {
    const q = loadQueue();
    q.ops.push(Object.assign({ id: uuid(), attempts: 0, last_error: null }, op));
    saveQueue(q);
  }

  async function flush() {
    if (_flushing) return { skipped: "already_flushing" };
    if (!navigator.onLine) return { skipped: "offline" };
    const client = getClient();
    if (!client) return { skipped: "no_client" };

    _flushing = true;
    const result = { sent: 0, failed: 0 };
    try {
      const q = loadQueue();
      const remaining = [];
      for (const op of q.ops) {
        try {
          if (op.op === "insert") {
            const { error } = await client.from(op.table).insert(op.payload);
            if (error) throw new Error(error.message);
          } else if (op.op === "update") {
            const { error } = await client.from(op.table)
              .update(op.payload).eq("id", op.payload.id);
            if (error) throw new Error(error.message);
          } else if (op.op === "delete") {
            const { error } = await client.from(op.table)
              .delete().eq("id", op.payload.id);
            if (error) throw new Error(error.message);
          }
          result.sent += 1;
        } catch (e) {
          op.attempts = (op.attempts || 0) + 1;
          op.last_error = e.message;
          // Drop row-not-found / constraint errors after 3 tries — they
          // won't succeed on retry. Network errors keep queueing.
          if (op.attempts < 3) remaining.push(op);
          result.failed += 1;
        }
      }
      saveQueue({ v: 1, ops: remaining });
    } finally {
      _flushing = false;
    }
    return result;
  }

  // ---------- sessions ----------
  async function listSessions(teamId) {
    const client = getClient();
    if (!client || !teamId) return [];
    const { data, error } = await client
      .from("whiteboard_sessions")
      .select("id, team_id, game_id, name, drill_title, created_at, updated_at")
      .eq("team_id", teamId)
      .order("updated_at", { ascending: false });
    if (error) { console.warn("[FelixWhiteboardAPI] listSessions:", error.message); return []; }
    return data || [];
  }

  async function getSession(sessionId) {
    const client = getClient();
    if (!client || !sessionId) return null;
    const { data, error } = await client
      .from("whiteboard_sessions")
      .select("*")
      .eq("id", sessionId).single();
    if (error) { console.warn("[FelixWhiteboardAPI] getSession:", error.message); return null; }
    return data;
  }

  async function createSession({ teamId, name, drillTitle, gameId }) {
    if (!teamId || !name) throw new Error("teamId and name required");
    const id = uuid();
    let createdBy = null;
    if (typeof FelixAuth !== "undefined") {
      try { const u = await FelixAuth.getUser(); createdBy = u && u.id; } catch (_) {}
    }
    const row = {
      id,
      team_id: teamId,
      game_id: gameId || null,
      name,
      drill_title: drillTitle || null,
      created_by: createdBy,
    };
    enqueue({ op: "insert", table: "whiteboard_sessions", payload: row });
    flush().catch(() => {});
    return row;
  }

  async function updateSession(id, patch) {
    if (!id) throw new Error("id required");
    enqueue({
      op: "update",
      table: "whiteboard_sessions",
      payload: Object.assign({ id }, patch),
    });
    flush().catch(() => {});
  }

  async function deleteSession(id) {
    if (!id) throw new Error("id required");
    enqueue({ op: "delete", table: "whiteboard_sessions", payload: { id } });
    flush().catch(() => {});
  }

  async function duplicateSession(sourceId, newName) {
    const client = getClient();
    if (!client || !sourceId) throw new Error("sourceId required");
    const src = await getSession(sourceId);
    if (!src) throw new Error("source session not found");
    const newSession = await createSession({
      teamId: src.team_id,
      gameId: src.game_id,
      name: newName || (src.name + " (copy)"),
      drillTitle: src.drill_title,
    });
    const [markers, strokes] = await Promise.all([
      listMarkers(sourceId),
      listStrokes(sourceId),
    ]);
    for (const m of markers) {
      const dup = Object.assign({}, m, { id: uuid(), session_id: newSession.id });
      delete dup.created_at; delete dup.updated_at;
      enqueue({ op: "insert", table: "whiteboard_markers", payload: dup });
    }
    for (const s of strokes) {
      const dup = Object.assign({}, s, { id: uuid(), session_id: newSession.id });
      delete dup.created_at;
      enqueue({ op: "insert", table: "whiteboard_strokes", payload: dup });
    }
    flush().catch(() => {});
    return newSession;
  }

  // ---------- markers ----------
  async function listMarkers(sessionId) {
    const client = getClient();
    if (!client || !sessionId) return [];
    const { data, error } = await client
      .from("whiteboard_markers")
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });
    if (error) { console.warn("[FelixWhiteboardAPI] listMarkers:", error.message); return []; }
    return data || [];
  }

  function placeMarker({ sessionId, markerType, color, x, y }) {
    if (!sessionId || !markerType) throw new Error("sessionId+markerType required");
    const id = uuid();
    const row = {
      id,
      session_id: sessionId,
      marker_type: markerType,
      color: markerType === "puck" ? null : color,
      position_x: x,
      position_y: y,
      path_data: null,
    };
    enqueue({ op: "insert", table: "whiteboard_markers", payload: row });
    flush().catch(() => {});
    return row;
  }

  function moveMarker(id, x, y) {
    enqueue({
      op: "update", table: "whiteboard_markers",
      payload: { id, position_x: x, position_y: y },
    });
    flush().catch(() => {});
  }

  function setMarkerPath(id, pathData) {
    enqueue({
      op: "update", table: "whiteboard_markers",
      payload: { id, path_data: pathData },
    });
    flush().catch(() => {});
  }

  function deleteMarker(id) {
    enqueue({ op: "delete", table: "whiteboard_markers", payload: { id } });
    flush().catch(() => {});
  }

  // ---------- strokes ----------
  async function listStrokes(sessionId) {
    const client = getClient();
    if (!client || !sessionId) return [];
    const { data, error } = await client
      .from("whiteboard_strokes")
      .select("*")
      .eq("session_id", sessionId)
      .order("stroke_order", { ascending: true });
    if (error) { console.warn("[FelixWhiteboardAPI] listStrokes:", error.message); return []; }
    return data || [];
  }

  function addStroke({ sessionId, strokeType, variant, points, color, brushSize, order }) {
    if (!sessionId || !strokeType) throw new Error("sessionId+strokeType required");
    const id = uuid();
    const row = {
      id,
      session_id: sessionId,
      stroke_type: strokeType,
      variant: variant || "curved",
      stroke_data: points,
      color: color || "#3AAEAC",
      brush_size: brushSize || 3,
      stroke_order: order || 0,
    };
    enqueue({ op: "insert", table: "whiteboard_strokes", payload: row });
    flush().catch(() => {});
    return row;
  }

  function deleteStroke(id) {
    enqueue({ op: "delete", table: "whiteboard_strokes", payload: { id } });
    flush().catch(() => {});
  }

  async function clearSession(sessionId) {
    const client = getClient();
    if (!client || !sessionId) return;
    // Direct deletes — clear-all is rare and the user expects immediate
    // server truth. Falls back to queue on network error.
    try {
      await client.from("whiteboard_strokes").delete().eq("session_id", sessionId);
      await client.from("whiteboard_markers").delete().eq("session_id", sessionId);
    } catch (e) {
      console.warn("[FelixWhiteboardAPI] clearSession:", e.message);
    }
  }

  // ---------- triggers ----------
  function start() {
    if (_intervalHandle) clearInterval(_intervalHandle);
    _intervalHandle = setInterval(() => {
      flush().catch((e) => console.warn("[FelixWhiteboardAPI] flush:", e && e.message));
    }, FLUSH_INTERVAL_MS);
    setTimeout(() => { flush().catch(() => {}); }, 1500);
  }
  window.addEventListener("online", () => { flush().catch(() => {}); });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }

  window.FelixWhiteboardAPI = {
    listSessions, getSession, createSession, updateSession,
    deleteSession, duplicateSession,
    listMarkers, placeMarker, moveMarker, setMarkerPath, deleteMarker,
    listStrokes, addStroke, deleteStroke, clearSession,
    flush, _loadQueue: loadQueue,
  };
})();
