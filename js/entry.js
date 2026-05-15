// js/entry.js -- Entry Hub orchestrator (Create / Join / Rejoin / Practice)
//
// Renders above the locked welcome.js modals (z-index 9100 > 9000) on
// cold load. Auto-bypasses with confirmation when a resumable game is
// detected. Practice tile is visually present but disabled in this
// commit (data-state="disabled"); to be wired in a later commit.
//
// Reads:
//   NomosSyncReadOnly.peekResumable / pendingCount  (B2 helper)
//   FelixGame.{joinGame, resumeFromCache}           (locked, js/game.js)
//   FelixWelcome.showCreateGame                     (locked, js/welcome.js)
//   state.gameInfo.configured                       (script-scope from
//                                                    js/game-engine.js)
// Writes: nothing -- pure renderer + dispatcher.
//
// Sentinel: window.__felixEntryHubActive is set SYNCHRONOUSLY at IIFE
// parse time so the main inline cold-start routing at index.html:2628
// (which fires showLoadGame / joinGameBtn.click() ~200ms after parse)
// sees it before its setTimeout. The legacy auto-fires stay intact and
// become inert when the sentinel is true (defense-in-depth: if entry.js
// fails to load entirely, the legacy routing still happens).

(function () {
  // Set the sentinel as the very first statement of the IIFE -- before
  // any function definitions, so the main inline at line 2628 (which
  // runs LATER as part of script-tag execution order) sees it set.
  try { window.__felixEntryHubActive = true; } catch (_) {}

  function _warn(msg, err) {
    try { console.warn("[FelixEntry]", msg, err && err.message ? err.message : err); }
    catch (_) {}
  }

  function timeAgo(ms) {
    if (!ms || typeof ms !== "number") return null;
    const sec = Math.max(1, Math.floor((Date.now() - ms) / 1000));
    if (sec < 60) return sec + "s ago";
    const min = Math.floor(sec / 60);
    if (min < 60) return min + "m ago";
    const hr = Math.floor(min / 60);
    if (hr < 24) return hr + "h ago";
    return Math.floor(hr / 24) + "d ago";
  }

  function showHub(hub) { hub.hidden = false; }
  function hideHub(hub) { hub.hidden = true; }

  function setRejoinTileReady(hub, resumable) {
    const tile = hub.querySelector('.entry-tile[data-entry="rejoin"]');
    if (!tile) return;
    tile.dataset.state = "ready";
    const meta = tile.querySelector('[data-rejoin-meta]');
    if (meta) {
      const ago = timeAgo(resumable && resumable.last_active_at);
      meta.textContent = ago ? ("Last active " + ago) : "Resume your game";
    }
  }

  function updateStatusStrip(hub) {
    const footer = hub.querySelector('.entry-hub__status');
    const dot = hub.querySelector('.entry-hub__status .dot');
    const status = hub.querySelector('[data-sync-status]');
    if (!footer || !dot || !status) return;
    let pending = 0;
    if (typeof window.NomosSyncReadOnly !== "undefined") {
      try { pending = window.NomosSyncReadOnly.pendingCount(); }
      catch (e) { _warn("pendingCount failed", e); }
    }
    const online = (typeof navigator !== "undefined") ? navigator.onLine : true;
    if (pending > 0 || !online) {
      dot.dataset.net = online ? "online" : "offline";
      status.textContent = !online ? "Offline" : (pending + " unsynced");
      footer.hidden = false;
    } else {
      footer.hidden = true;
    }
  }

  // ---- tile dispatchers ----------------------------------------------------

  function handleCreate(hub) {
    if (typeof window.FelixWelcome === "undefined" || typeof FelixWelcome.showCreateGame !== "function") {
      _warn("FelixWelcome.showCreateGame unavailable");
      return;
    }
    hideHub(hub);
    try { FelixWelcome.showCreateGame(); }
    catch (e) { _warn("showCreateGame threw", e); showHub(hub); }
  }

  function handleJoin(hub) {
    let code = null;
    try { code = window.prompt("Enter game code (e.g., PLYM-0001):"); }
    catch (e) { _warn("prompt failed", e); return; }
    if (!code || !code.trim()) return;
    if (typeof window.FelixGame === "undefined" || typeof FelixGame.joinGame !== "function") {
      _warn("FelixGame.joinGame unavailable");
      return;
    }
    hideHub(hub);
    FelixGame.joinGame(code.trim()).catch((e) => {
      _warn("joinGame failed", e);
      try { alert("Could not join: " + (e && e.message ? e.message : "unknown error")); }
      catch (_) {}
      showHub(hub);
    });
  }

  function handleRejoin(hub) {
    const tile = hub.querySelector('.entry-tile[data-entry="rejoin"]');
    if (!tile || tile.dataset.state !== "ready") return;
    if (typeof window.FelixGame === "undefined" || typeof FelixGame.resumeFromCache !== "function") {
      _warn("FelixGame.resumeFromCache unavailable");
      return;
    }
    hideHub(hub);
    let p = null;
    try { p = FelixGame.resumeFromCache(); }
    catch (e) { _warn("resumeFromCache threw", e); showHub(hub); return; }
    Promise.resolve(p).then((g) => {
      if (!g) { _warn("resumeFromCache returned null"); showHub(hub); }
    }).catch((e) => {
      _warn("resumeFromCache rejected", e);
      showHub(hub);
    });
  }

  function wireTiles(hub) {
    hub.addEventListener("click", (e) => {
      const tile = e.target.closest(".entry-tile");
      if (!tile) return;
      const ds = tile.dataset.state;
      if (ds === "empty" || ds === "disabled") return;
      switch (tile.dataset.entry) {
        case "create": handleCreate(hub); break;
        case "join":   handleJoin(hub); break;
        case "rejoin": handleRejoin(hub); break;
        // 'practice' is permanently data-state="disabled" in this commit.
      }
    });
  }

  // ---- boot ----------------------------------------------------------------

  function _readConfigured() {
    // state is declared at script-scope (top-level let) in js/game-engine.js.
    // Wrap in try/catch in case of TDZ or unexpected access patterns.
    try {
      return (typeof state !== "undefined")
        && state && state.gameInfo
        && state.gameInfo.configured === true;
    } catch (_) { return false; }
  }

  function _hasGameUrlParam() {
    try { return new URLSearchParams(window.location.search).has("game"); }
    catch (_) { return false; }
  }

  async function boot() {
    // Share-link path: defer to FelixGame.detectGameFromURL (auto-join).
    // The legacy routing at index.html:2628 also bails on this -- both
    // layers correctly skip.
    if (_hasGameUrlParam()) return;

    const hub = document.getElementById("entryHub");
    if (!hub) { _warn("entryHub element missing"); return; }

    let resumable = null;
    if (typeof window.NomosSyncReadOnly !== "undefined") {
      try { resumable = await window.NomosSyncReadOnly.peekResumable(); }
      catch (e) { _warn("peekResumable failed", e); }
    }

    const configured = _readConfigured();

    // Auto-bypass with confirmation: only when the FelixDB session AND
    // the local state agree the game is live. Both blocker-3 failure
    // modes (throw + null return) re-show the hub.
    if (resumable && configured) {
      const opp = (resumable.opponent && resumable.opponent.trim()) || "your last game";
      let skip = false;
      try { skip = window.confirm("Resume game vs " + opp + "?"); }
      catch (_) {}
      if (skip) {
        let p = null;
        try { p = FelixGame.resumeFromCache(); }
        catch (e) {
          _warn("resumeFromCache threw on auto-bypass", e);
          setRejoinTileReady(hub, resumable);
          updateStatusStrip(hub);
          wireTiles(hub);
          showHub(hub);
          return;
        }
        Promise.resolve(p).then((g) => {
          if (g) return;  // success -- rink view takes over via FelixGame.onGameChange
          _warn("resumeFromCache returned null on auto-bypass");
          setRejoinTileReady(hub, resumable);
          updateStatusStrip(hub);
          wireTiles(hub);
          showHub(hub);
        }).catch((e) => {
          _warn("resumeFromCache rejected on auto-bypass", e);
          setRejoinTileReady(hub, resumable);
          updateStatusStrip(hub);
          wireTiles(hub);
          showHub(hub);
        });
        return;
      }
    }

    if (resumable) setRejoinTileReady(hub, resumable);
    updateStatusStrip(hub);
    wireTiles(hub);
    showHub(hub);
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => {
        boot().catch((e) => _warn("boot failed", e));
      });
    } else {
      boot().catch((e) => _warn("boot failed", e));
    }
  }
})();
