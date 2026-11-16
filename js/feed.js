// js/feed.js — Feed tab module: live play-by-play for the current game.
//
// Sources (newest first):
//   - This device: state.events (shots / saves / goals / misses / blocks,
//     with REB / WRAP / TIP / BREAK and PP / PK tags), state.faceoffs,
//     state.goalies (goalie changes) and captured photos / videos
//     (FelixDB media for state.gameId).
//   - Other scorers: when this device has joined a mesh game (FelixGame),
//     their synced taps are read from nomos_submission / nomos_event every
//     20 s while the Feed is open, so a parent who is only following along
//     sees the game live. Own events are de-duplicated by client_event_id.
//   - Milestones computed on the fly: running score on every goal, every
//     10th save for a goalie.
// Empty state links to Calendar and lists recent saved games.
//
// Implements the tab module interface documented in js/nav.js.

(function () {
  "use strict";

  const POLL_MS = 20000;
  const LOCAL_TICK_MS = 2000;
  const ARCHIVE_KEY = "felix-archive-v1";

  let _root = null;
  let _tick = null;
  let _poll = null;
  let _sig = "";
  let _remote = [];
  let _remoteGameId = null;
  let _remoteErr = "";
  let _mode = null;            // 'device' | 'all'
  let _media = [];
  let _mediaUrls = [];
  let _mediaGameId = null;

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  // `state` is the app-wide game state (let-declared in js/game-engine.js,
  // shared script scope). Guarded so the Feed never throws if it is missing.
  function S() {
    try { return (typeof state !== "undefined" && state) ? state : null; } catch (_) { return null; }
  }
  function activeGame() {
    try { return (typeof FelixGame !== "undefined" && FelixGame.getActiveGame()) || null; } catch (_) { return null; }
  }
  function names() {
    const s = S() || {};
    const gi = s.gameInfo || {};
    const g = activeGame();
    const teamShort = (window.FelixTeam && FelixTeam.get().short) || "Us";
    return {
      us: gi.ourTeam || (g && g.home_team_name) || teamShort,
      them: gi.opponent || (g && g.away_team_name) || "Opponent",
    };
  }
  function pLabel(p) { return p === 4 ? "OT" : (p ? "P" + p : ""); }
  function clock(t) {
    if (!t) return "";
    try { return new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); } catch (_) { return ""; }
  }
  const STYLE_TAG = { rebound: "REB", wraparound: "WRAP", tip: "TIP", breakaway: "BREAK" };

  // ───────────── build timeline items ─────────────
  function shotItem(ev, n, src) {
    const ours = ev.forOrAgainst === "for";
    const team = ours ? n.us : n.them;
    const goalie = ev.goalie && (ev.goalie.num || ev.goalie.name)
      ? ((ev.goalie.num && ev.goalie.num !== "?" ? "#" + ev.goalie.num + " " : "") + (ev.goalie.name || "")).trim()
      : "";
    let title, kind;
    switch (ev.result) {
      case "goal":  kind = ours ? "goal-for" : "goal-against"; title = ours ? "GOAL · " + team : "Goal against · " + team; break;
      case "miss":  kind = "miss";  title = "Missed shot · " + team; break;
      case "block": kind = "block"; title = "Blocked shot · " + team; break;
      default:
        kind = ours ? "shot" : "save";
        title = ours ? "Shot on goal · " + team : "Save" + (goalie ? " · " + goalie : "") + " (" + team + " shot)";
    }
    const tags = [];
    (ev.styles || []).forEach((st) => { if (STYLE_TAG[st]) tags.push(STYLE_TAG[st]); });
    if (ev.gameState && ev.gameState !== "5v5") tags.push(ev.gameState);
    return { t: ev.t || 0, period: ev.period, kind, title, tags, src, ev };
  }

  function faceoffItem(f, n, src) {
    const weAre = (S() && S().weAre) || "home";
    let title;
    if (f.winner === "neutral" || !f.winner) title = "Faceoff · no clean winner";
    else title = "Faceoff won · " + (f.winner === weAre ? n.us : n.them);
    const tags = f.zone ? [String(f.zone).toUpperCase()] : [];
    return { t: f.t || 0, period: f.period, kind: "faceoff", title, tags, src };
  }

  function buildItems() {
    const s = S() || {};
    const n = names();
    const items = [];
    const localIds = new Set();
    const showDevice = _mode !== "all" || !_remote.length;

    (s.events || []).forEach((ev) => { if (ev._client_id) localIds.add(ev._client_id); });
    (s.faceoffs || []).forEach((f) => { if (f._client_id) localIds.add(f._client_id); });

    if (showDevice || _mode === "all") {
      (s.events || []).forEach((ev) => items.push(shotItem(ev, n, "device")));
      (s.faceoffs || []).forEach((f) => items.push(faceoffItem(f, n, "device")));
      (s.goalies || []).forEach((g) => {
        if (!g || !g.startedAt) return;
        const who = ((g.num && g.num !== "?" ? "#" + g.num + " " : "") + (g.name || "Goalie")).trim();
        items.push({ t: g.startedAt, kind: "goalie", title: "In net · " + who, tags: [], src: "device" });
      });
      _media.forEach((m, i) => items.push({
        t: m.captured_at || 0, period: m.period, kind: "media", title: m.type === "video" ? "Video clip" : "Photo",
        tags: [], src: "device", mediaIdx: i,
      }));
    }

    if (_mode === "all") {
      _remote.forEach((r) => {
        const p = r.payload || {};
        if (p.client_event_id && localIds.has(p.client_event_id)) return;
        if (p.zone && p.forOrAgainst && !p.result) return; // goal-net location, duplicates the goal
        if (p.winner !== undefined || p.dotId) items.push(faceoffItem(p, n, "remote"));
        else if (p.result) items.push(shotItem(p, n, "remote"));
      });
    }

    // Milestones: running score + every 10th save, computed oldest -> newest.
    items.sort((a, b) => a.t - b.t);
    let us = 0, them = 0;
    const saves = {};
    const out = [];
    items.forEach((it) => {
      out.push(it);
      if (it.kind === "goal-for") { us++; it.score = us + "–" + them; }
      if (it.kind === "goal-against") { them++; it.score = us + "–" + them; }
      if (it.kind === "save") {
        const g = (it.ev && it.ev.goalie && (it.ev.goalie.num || it.ev.goalie.name)) || "goalie";
        saves[g] = (saves[g] || 0) + 1;
        if (saves[g] % 10 === 0) {
          const label = it.ev && it.ev.goalie
            ? ((it.ev.goalie.num && it.ev.goalie.num !== "?" ? "#" + it.ev.goalie.num + " " : "") + (it.ev.goalie.name || "")).trim()
            : "Goalie";
          out.push({ t: it.t + 1, period: it.period, kind: "milestone", title: saves[g] + " saves · " + label, tags: [], src: it.src });
        }
      }
    });
    return { items: out.reverse(), us, them };
  }

  // ───────────── render ─────────────
  function signature() {
    const s = S() || {};
    const last = (arr) => (arr && arr.length ? (arr[arr.length - 1].t || arr[arr.length - 1].startedAt || 0) + ":" + (arr[arr.length - 1].result || "") : "");
    return [
      (s.events || []).length, last(s.events), (s.faceoffs || []).length, (s.goalies || []).length,
      s.period, s.gameInfo && s.gameInfo.configured, s.gameInfo && s.gameInfo.opponent,
      _remote.length, _mode, _media.length, (activeGame() || {}).id || "", _remoteErr,
    ].join("|");
  }

  function recentGamesHTML() {
    let arr = [];
    try { arr = JSON.parse(localStorage.getItem(ARCHIVE_KEY) || "[]"); } catch (_) {}
    if (!Array.isArray(arr) || !arr.length) return "";
    const rows = arr.slice(-5).reverse().map((g) => {
      const gi = g.gameInfo || {};
      const fs = g.finalScore || {};
      const d = gi.date ? new Date(gi.date + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
      const shots = (g.events || []).filter((e) => e.forOrAgainst === "against" && (e.result === "shot" || e.result === "goal")).length;
      return `<div class="feed-recent-row"><span>${esc(d)}</span><span>${esc(gi.ourTeam || "Us")} ${fs.ours ?? 0}–${fs.theirs ?? 0} ${esc(gi.opponent || "Opponent")}</span><span class="feed-muted">${shots} SA</span></div>`;
    }).join("");
    return `<div class="feed-section-title">Recent games on this device</div><div class="feed-recent">${rows}</div>`;
  }

  function render() {
    if (!_root) return;
    _sig = signature();
    const s = S() || {};
    const n = names();
    const g = activeGame();
    const { items, us, them } = buildItems();
    const configured = !!(s.gameInfo && s.gameInfo.configured);
    const hasAnything = items.length > 0 || configured || (g && g.id);

    const modeBar = (g && g.id) ? `
      <div class="feed-mode" role="tablist">
        <button type="button" data-mode="device" class="${_mode !== "all" ? "on" : ""}">This device</button>
        <button type="button" data-mode="all" class="${_mode === "all" ? "on" : ""}">All scorers${_remote.length ? " (" + _remote.length + ")" : ""}</button>
      </div>` : "";

    let body;
    if (!hasAnything) {
      body = `
        <div class="feed-empty">
          <div class="feed-empty-title">No game in progress</div>
          <p>When a game is being tracked, every shot, save, goal, faceoff and photo shows up here as it happens, including taps from other scorers in the same game.</p>
          <button type="button" class="feed-cta" data-go="calendar">Find a game on the Calendar</button>
        </div>
        ${recentGamesHTML()}`;
    } else if (!items.length) {
      body = `<div class="feed-empty"><p>Waiting for the first shot… Tap the rink to log one${g && g.id ? ", or switch to All scorers to see other trackers" : ""}.</p></div>`;
    } else {
      body = `<ol class="feed-list">${items.slice(0, 300).map((it) => {
        const tags = (it.tags || []).map((t) => `<span class="feed-tag">${esc(t)}</span>`).join("");
        const media = it.kind === "media" && _mediaUrls[it.mediaIdx]
          ? (_media[it.mediaIdx].type === "video"
              ? `<video class="feed-thumb" data-media="${it.mediaIdx}" src="${_mediaUrls[it.mediaIdx]}" muted playsinline preload="metadata"></video>`
              : `<img class="feed-thumb" data-media="${it.mediaIdx}" src="${_mediaUrls[it.mediaIdx]}" alt="Game photo">`)
          : "";
        return `<li class="feed-item k-${it.kind}${it.src === "remote" ? " remote" : ""}">
          <div class="feed-meta"><span>${esc(pLabel(it.period))}</span><span>${esc(clock(it.t))}</span></div>
          <div class="feed-main">
            <div class="feed-title">${esc(it.title)}${it.score ? ` <b class="feed-score">${it.score}</b>` : ""}</div>
            ${tags || it.src === "remote" ? `<div class="feed-tags">${tags}${it.src === "remote" ? '<span class="feed-tag ghost">other scorer</span>' : ""}</div>` : ""}
            ${media}
          </div>
        </li>`;
      }).join("")}</ol>`;
    }

    const sog = (side) => (s.events || []).filter((e) => e.forOrAgainst === side && (e.result === "shot" || e.result === "goal")).length;
    const head = hasAnything ? `
      <div class="feed-score-card">
        <div class="feed-team"><span>${esc(n.us)}</span><b>${us}</b></div>
        <div class="feed-mid">${esc(pLabel(s.period) || "P1")}${g && (g.code || g.client_game_id) ? `<small>${esc(g.code || g.client_game_id)}</small>` : ""}</div>
        <div class="feed-team right"><b>${them}</b><span>${esc(n.them)}</span></div>
      </div>
      <div class="feed-sub">Shots on goal ${sog("for")}–${sog("against")}${_remoteErr ? ` · <span class="feed-warn">${esc(_remoteErr)}</span>` : ""}</div>` : "";

    _root.innerHTML = `<div class="feed-root">
      <div class="feed-head"><span class="feed-heading">Live Feed</span></div>
      ${head}${modeBar}${body}
    </div>`;
  }

  // ───────────── data loaders ─────────────
  async function loadMedia() {
    const s = S();
    if (!s || !s.gameId || typeof FelixDB === "undefined" || !FelixDB.getMediaForGame) return;
    try {
      const rows = (await FelixDB.getMediaForGame(s.gameId)) || [];
      if (rows.length === _media.length && _mediaGameId === s.gameId) return;
      _mediaUrls.forEach((u) => { try { URL.revokeObjectURL(u); } catch (_) {} });
      _media = rows.sort((a, b) => (a.captured_at || 0) - (b.captured_at || 0));
      _mediaUrls = _media.map((m) => (m.blob ? URL.createObjectURL(m.blob) : ""));
      _mediaGameId = s.gameId;
    } catch (e) { console.warn("Feed media:", e && e.message); }
  }

  async function loadRemote() {
    const g = activeGame();
    if (!g || !g.id) { _remote = []; _remoteGameId = null; return; }
    if (typeof navigator !== "undefined" && navigator.onLine === false) { _remoteErr = "offline, showing this device"; return; }
    const c = window.FelixAuth && FelixAuth.client && FelixAuth.client();
    if (!c) return;
    try {
      const user = await FelixAuth.getUser();
      if (!user) { _remoteErr = ""; return; }
      const { data: subs, error: e1 } = await c.from("nomos_submission").select("id").eq("game_id", g.id);
      if (e1) throw e1;
      if (!subs || !subs.length) { _remote = []; _remoteGameId = g.id; _remoteErr = ""; return; }
      const { data: rows, error: e2 } = await c.from("nomos_event")
        .select("payload, timestamp_seconds")
        .in("submission_id", subs.map((x) => x.id))
        .order("timestamp_seconds", { ascending: false })
        .limit(400);
      if (e2) throw e2;
      _remote = rows || [];
      _remoteGameId = g.id;
      _remoteErr = "";
    } catch (e) {
      _remoteErr = "other scorers unavailable";
      console.warn("Feed remote:", e && e.message);
    }
  }

  async function refreshAll() {
    await Promise.all([loadMedia(), loadRemote()]);
    if (_mode === null) {
      const s = S() || {};
      _mode = ((s.events || []).length || !_remote.length) ? "device" : "all";
    }
    render();
  }

  function onClick(e) {
    const m = e.target.closest("[data-mode]");
    if (m) { _mode = m.dataset.mode; render(); return; }
    const go = e.target.closest("[data-go]");
    if (go && window.FelixNav) { FelixNav.activate(go.dataset.go); return; }
    const th = e.target.closest("[data-media]");
    if (th) {
      const i = parseInt(th.dataset.media, 10);
      if (typeof window.openLightbox === "function") window.openLightbox(_media[i], _mediaUrls[i]);
      else window.open(_mediaUrls[i], "_blank");
    }
  }

  window.FelixFeed = {
    label: "Feed",
    icon: '<svg viewBox="0 0 24 24"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>',

    init(root) {
      _root = root;
      root.addEventListener("click", onClick);
    },

    onActivate() {
      render();
      refreshAll();
      clearInterval(_tick); clearInterval(_poll);
      _tick = setInterval(() => {
        if (signature() !== _sig) render();
      }, LOCAL_TICK_MS);
      _poll = setInterval(refreshAll, POLL_MS);
    },

    onDeactivate() {
      clearInterval(_tick); clearInterval(_poll);
      _tick = _poll = null;
    },
  };
})();
