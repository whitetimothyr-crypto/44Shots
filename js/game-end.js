// js/game-end.js — 44 Shots End Game wrapper
//
// Stamps Supabase nomos_game.status='completed' when the coach ends a
// game from the index.html End Game flow. NomosSync (js/sync.js) only
// queues nomos_event INSERTs and is byte-for-byte locked, so this
// module owns its own write path and a single-cell localStorage queue.
//
// Per V3.0 architecture (2026-05-15): the client writes 'completed'
// only. 'finalized' + finalized_at are reserved for the server-side
// reconciliation Edge Function (future). See migration 17 header for
// the full state machine.
//
// Public API (window.GameEnd):
//   GameEnd.finalize(ctx) -> Promise<{ status: 'sent'|'queued'|'noop' }>
//     ctx: { game_id?, client_game_id?, ended_at? }
//     Always broadcasts GAME_ENDED on the BroadcastChannel.
//     Tries direct UPDATE if online + game_id present; queues otherwise.
//     Fire-and-forget: caller does not need to await.
//   GameEnd.PENDING_KEY  -- localStorage key for the retry queue (B4)
//   GameEnd.CHANNEL_NAME -- BroadcastChannel name
//
// Reads SB_URL / SB_KEY from script-scope (declared in
// js/supabase-config.js, loads before main inline).

(function () {
  const PENDING_KEY = 'felix-finalize-pending-v1';
  const CHANNEL_NAME = '44shots_game_events';

  let _client = null;
  function getClient() {
    if (_client) return _client;
    if (typeof window.supabase === 'undefined') return null;
    try {
      _client = window.supabase.createClient(SB_URL, SB_KEY, {
        auth: { persistSession: true, autoRefreshToken: true }
      });
    } catch (_) { return null; }
    return _client;
  }

  // BroadcastChannel: undefined on Safari iOS < 15.4. Silent no-op there.
  function broadcastEnded(payload) {
    if (typeof BroadcastChannel !== 'function') return;
    let ch = null;
    try { ch = new BroadcastChannel(CHANNEL_NAME); } catch (_) { return; }
    try { ch.postMessage(Object.assign({ type: 'GAME_ENDED' }, payload)); }
    catch (_) {}
    try { ch.close(); } catch (_) {}
  }

  function savePending(payload) {
    try { localStorage.setItem(PENDING_KEY, JSON.stringify(payload)); } catch (_) {}
  }
  function clearPending() {
    try { localStorage.removeItem(PENDING_KEY); } catch (_) {}
  }
  function loadPending() {
    try {
      const raw = localStorage.getItem(PENDING_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  // Direct UPDATE. Resolves true on success, false on any failure
  // (network, RLS, missing client). Never throws -- callers reason on
  // a boolean.
  async function pushToSupabase(gameId) {
    const client = getClient();
    if (!client || !gameId) return false;
    try {
      const { error } = await client
        .from('nomos_game')
        .update({ status: 'completed' })
        .eq('id', gameId);
      return !error;
    } catch (_) { return false; }
  }

  async function finalize(ctx) {
    ctx = ctx || {};
    const payload = {
      game_id: ctx.game_id || null,
      client_game_id: ctx.client_game_id || null,
      ended_at: ctx.ended_at || Date.now()
    };

    // No mesh game in progress -- nothing to write to Supabase. Still
    // broadcast so any second open tab can react to the local end.
    if (!payload.game_id) {
      broadcastEnded({ client_game_id: payload.client_game_id });
      return { status: 'noop' };
    }

    if (typeof navigator !== 'undefined' && navigator.onLine) {
      const ok = await pushToSupabase(payload.game_id);
      if (ok) {
        clearPending();
        broadcastEnded({ client_game_id: payload.client_game_id });
        return { status: 'sent' };
      }
      // Fall through to queue: navigator.onLine can lie (captive portal,
      // proxied DNS, server 5xx), so a failed UPDATE while "online"
      // still belongs in the retry cell.
    }
    savePending(payload);
    broadcastEnded({ client_game_id: payload.client_game_id });
    return { status: 'queued' };
  }

  // Drain a queued finalization left by an offline End Game. Idempotent:
  //   - returns 'no_pending' if the cell is empty or malformed
  //   - returns 'offline' without touching Supabase if connectivity is gone
  //   - returns 'sent' on successful UPDATE; the cell is cleared and a
  //     GAME_ENDED rebroadcast fires (with drained:true) so other tabs
  //     that may have missed the original broadcast can react now
  //   - returns 'failed' on UPDATE failure; the cell is left in place so
  //     the next 'online' event triggers another attempt
  async function drainPending() {
    const payload = loadPending();
    if (!payload || !payload.game_id) {
      // Nothing to drain, or malformed cell -- drop it either way.
      if (payload) clearPending();
      return { status: 'no_pending' };
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return { status: 'offline' };
    }
    const ok = await pushToSupabase(payload.game_id);
    if (ok) {
      clearPending();
      broadcastEnded({ client_game_id: payload.client_game_id, drained: true });
      return { status: 'sent' };
    }
    return { status: 'failed' };
  }

  window.GameEnd = {
    finalize,
    drainPending,
    PENDING_KEY,
    CHANNEL_NAME
  };

  // Drain triggers. 'online' fires when the OS reconnects (rink wifi back,
  // mobile data resumed). One-shot 1500ms drain at load mirrors the
  // js/sync.js pattern -- gives FelixAuth + FelixGame a beat to settle so
  // the RLS-gated UPDATE on nomos_game has an authenticated session.
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      drainPending().catch(() => {});
    });
    setTimeout(() => {
      drainPending().catch(() => {});
    }, 1500);
  }
})();
