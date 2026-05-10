// js/whiteboard.js — WHITEBOARD module (44 Shots / NOMOS)
//
// Tactical planning surface for coaches. Replaces the PR 1 stub.
//
// Architecture (per spec lock):
//   js/whiteboard.js      — UI controller, canvas rendering, input
//   js/whiteboard-api.js  — Supabase calls (offline-first queue)
//   css/whiteboard.css    — scoped to #whiteboard-root
//   index.html            — single <div id="whiteboard-root"></div>
//
// Layers (4 stacked canvases):
//   wb-rink     — USA Hockey regulation rink (static, redrawn on resize)
//   wb-strokes  — committed strokes
//   wb-markers  — placed markers + path overlays
//   wb-overlay  — input capture + ephemeral feedback (in-progress stroke,
//                 path-draw guide, drag ghost). Pointer Events only.
//
// Coordinate system:
//   All marker positions and stroke points stored as NORMALIZED 0..1
//   floats relative to the rink width/height. Resolution-independent —
//   resize, device-pixel-ratio, and device differences all just remap.
//
// Vanilla Canvas only — no Konva/Fabric/etc. per CONSTRAINTS.

(function () {
  "use strict";

  // ── Constants ───────────────────────────────────────────────────
  // Rink regulation = 200ft × 85ft. We render to a logical buffer of
  // RINK_W × RINK_H pixels then scale the canvas up via CSS.
  const RINK_FT_W = 200;
  const RINK_FT_H = 85;
  const RINK_W = 2000;
  const RINK_H = 850;
  const FT = RINK_W / RINK_FT_W; // pixels per foot

  const MARKER_TYPES = [
    { type: "F1", color: "red"  }, { type: "F1", color: "blue" },
    { type: "F2", color: "red"  }, { type: "F2", color: "blue" },
    { type: "F3", color: "red"  }, { type: "F3", color: "blue" },
    { type: "D1", color: "red"  }, { type: "D1", color: "blue" },
    { type: "D2", color: "red"  }, { type: "D2", color: "blue" },
    { type: "puck", color: null },
  ];

  const STROKE_TOOLS = [
    { id: "skate",       label: "Skate",       icon: svgSkate(),       end: "none"   },
    { id: "skate_stop",  label: "Skate Stop",  icon: svgSkateStop(),   end: "stop"   },
    { id: "skate_shot",  label: "Skate Shot",  icon: svgSkateShot(),   end: "arrow"  },
    { id: "pass",        label: "Pass",        icon: svgPass(),        end: "arrow", dash: [16, 12] },
    { id: "shot",        label: "Shot",        icon: svgShot(),        end: "arrow"  },
    { id: "loose_puck",  label: "Loose Puck",  icon: svgLoosePuck(),   end: "none",  dash: [4, 8] },
  ];

  // 5 NOMOS color tokens for stroke palette.
  const COLOR_SWATCHES = [
    { token: "--accent",   value: "#3AAEAC" },
    { token: "--gold",     value: "#C9A84C" },
    { token: "--stat",     value: "#C08CFF" },
    { token: "--home",     value: "#e63946" },
    { token: "--text",     value: "#E8E8E0" },
  ];

  const LONG_PRESS_MS = 300;
  const ANIM_DURATIONS = [1000, 2000, 5000];

  // ── Module state (singleton) ────────────────────────────────────
  let _root = null;
  let _inited = false;
  let _role = "user";
  let _teamId = null;
  let _sessionId = null;
  let _sessionName = "";
  let _drillTitle = "";

  let _markers = []; // [{ id, type, color, x, y, path:[{x,y}]|null }]
  let _strokes = []; // [{ id, type, variant, points:[{x,y,p}], color, size, order }]
  let _undo = [];
  let _redo = [];

  // Tool state
  let _activeTool = "move"; // move | marker | stroke | path-draw
  let _armedMarker = null;  // { type, color }
  let _armedStroke = null;  // { id, variant }
  let _strokeColor = COLOR_SWATCHES[0].value;
  let _strokeSize = 3;
  let _penOnly = false;

  // In-flight gestures
  let _drawingStroke = null;     // { type, variant, points:[], color, size }
  let _dragMarker = null;        // { marker, startX, startY }
  let _longPressTimer = null;
  let _markerMenuFor = null;     // marker id with open menu
  let _pathDrawForMarkerId = null;

  // Animation playback
  let _animPlaying = false;
  let _animDuration = 2000;
  let _animStart = 0;
  let _animRaf = null;

  // DOM refs
  let _rinkCanvas, _strokeCanvas, _markerCanvas, _overlayCanvas;
  let _rinkCtx, _strokeCtx, _markerCtx, _overlayCtx;
  let _wrapEl;

  // ── Public tab module interface ─────────────────────────────────
  window.FelixWhiteboard = {
    label: "Whiteboard",
    icon: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="14" rx="1.5"/><line x1="3" y1="20" x2="21" y2="20"/><line x1="7" y1="9" x2="13" y2="9"/><line x1="7" y1="13" x2="17" y2="13"/></svg>',

    init(root) {
      _root = root;
      root.innerHTML = '<div id="whiteboard-root"><div class="wb-coach-gate"><h2>Whiteboard</h2><p>Loading…</p></div></div>';
      _inited = false;
    },

    async onActivate() {
      if (typeof FelixAuth !== "undefined") {
        try {
          _role = await FelixAuth.getRole();
          const user = await FelixAuth.getUser();
          _teamId = await resolveTeamId(user);
        } catch (_) {}
      }
      if (_role !== "coach") {
        renderCoachGate();
        return;
      }
      if (!_inited) {
        await renderShell();
        _inited = true;
      }
      window.addEventListener("resize", _onResize);
      requestAnimationFrame(() => { sizeCanvases(); drawAll(); });
    },

    onDeactivate() {
      window.removeEventListener("resize", _onResize);
      cancelAnim();
    },
  };

  // ── Coach gate ──────────────────────────────────────────────────
  function renderCoachGate() {
    const host = _root.querySelector("#whiteboard-root") || _root;
    host.innerHTML =
      '<div class="wb-coach-gate"><h2>Coach Only</h2>' +
      '<p>The whiteboard is restricted to coaches. Sign in with the email on your team roster to unlock.</p></div>';
  }

  async function resolveTeamId(user) {
    // Prefer the team the coach is rostered to. Falls back to the
    // first team_members row for this user. Hardcoded seed UUIDs from
    // migration 15 are NOT relied on here — query is generic.
    if (!user || typeof window.supabase === "undefined") return null;
    try {
      const SUPABASE_URL = "https://qshgschhudiryjnslzof.supabase.co";
      const KEY = "sb_publishable_hdrc9mYaGocDhJVesn0FRw_wELl6Tnv";
      const c = window.supabase.createClient(SUPABASE_URL, KEY, {
        auth: { persistSession: true, autoRefreshToken: true },
      });
      const { data } = await c.from("team_members")
        .select("team_id").eq("user_id", user.id)
        .in("team_role", ["head_coach", "assistant_coach"]).limit(1);
      return data && data[0] ? data[0].team_id : null;
    } catch (_) { return null; }
  }

  // ── Shell render ────────────────────────────────────────────────
  async function renderShell() {
    const host = _root.querySelector("#whiteboard-root") || _root;
    host.innerHTML = `
      <div class="wb-topbar">
        <select class="wb-presets" aria-label="Drill preset"></select>
        <button class="wb-btn" data-act="new-session">New</button>
        <button class="wb-btn" data-act="save-preset">Save Preset</button>
        <input type="text" class="wb-session-name" placeholder="Session name" value="" />
        <button class="wb-btn primary" data-act="share">Share</button>
        <label class="wb-pen-only"><input type="checkbox" /> Pen only</label>
      </div>
      <div class="wb-marker-bar"></div>
      <div class="wb-stage">
        <div class="wb-canvas-wrap">
          <canvas class="wb-rink"></canvas>
          <canvas class="wb-strokes"></canvas>
          <canvas class="wb-markers"></canvas>
          <canvas class="wb-overlay"></canvas>
        </div>
      </div>
      <div class="wb-tool-bar"></div>
      <div class="wb-anim-bar" hidden>
        <span>Animate</span>
        <button data-anim="1000">1s</button>
        <button data-anim="2000" class="armed">2s</button>
        <button data-anim="5000">5s</button>
        <button data-anim-play>Play</button>
      </div>
      <div class="wb-action-bar">
        <button class="wb-action armed" data-act="move" title="Move"><svg viewBox="0 0 24 24"><path d="M5 9l-2 3 2 3M9 5l3-2 3 2M9 19l3 2 3-2M19 9l2 3-2 3M5 12h14M12 5v14"/></svg></button>
        <button class="wb-action" data-act="undo" title="Undo" disabled><svg viewBox="0 0 24 24"><path d="M9 14l-4-4 4-4"/><path d="M5 10h9a5 5 0 0 1 0 10h-3"/></svg></button>
        <button class="wb-action" data-act="redo" title="Redo" disabled><svg viewBox="0 0 24 24"><path d="M15 14l4-4-4-4"/><path d="M19 10h-9a5 5 0 0 0 0 10h3"/></svg></button>
        <button class="wb-action" data-act="duplicate" title="Duplicate"><svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="1.5"/><rect x="4" y="4" width="12" height="12" rx="1.5"/></svg></button>
        <button class="wb-action danger" data-act="trash" title="Clear all"><svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg></button>
        <input type="text" class="wb-drill-title" placeholder="Drill title (saves with session)" />
      </div>`;

    _wrapEl       = host.querySelector(".wb-canvas-wrap");
    _rinkCanvas   = host.querySelector("canvas.wb-rink");
    _strokeCanvas = host.querySelector("canvas.wb-strokes");
    _markerCanvas = host.querySelector("canvas.wb-markers");
    _overlayCanvas= host.querySelector("canvas.wb-overlay");
    _rinkCtx     = _rinkCanvas.getContext("2d");
    _strokeCtx   = _strokeCanvas.getContext("2d");
    _markerCtx   = _markerCanvas.getContext("2d");
    _overlayCtx  = _overlayCanvas.getContext("2d");

    renderMarkerBar(host);
    renderToolBar(host);
    bindShellHandlers(host);
    bindCanvasInput();

    await ensureSession();
    await hydrateSession();
    await refreshPresetDropdown();
    drawAll();
  }

  function renderMarkerBar(host) {
    const bar = host.querySelector(".wb-marker-bar");
    bar.innerHTML = "";
    MARKER_TYPES.forEach((m) => {
      const btn = document.createElement("button");
      btn.className = "wb-marker " + (m.color || "puck");
      btn.dataset.marker = m.type;
      if (m.color) btn.dataset.color = m.color;
      btn.textContent = m.type === "puck" ? "PUCK" : m.type;
      btn.addEventListener("click", () => armMarker(m, btn));
      bar.appendChild(btn);
    });
  }

  function renderToolBar(host) {
    const bar = host.querySelector(".wb-tool-bar");
    bar.innerHTML = "";
    STROKE_TOOLS.forEach((t) => {
      const btn = document.createElement("button");
      btn.className = "wb-tool";
      btn.dataset.tool = t.id;
      btn.dataset.variant = "curved";
      btn.title = t.label + " — long-press for straight";
      btn.innerHTML = t.icon;
      let pressTimer = null;
      const press = () => {
        pressTimer = setTimeout(() => {
          btn.dataset.variant = btn.dataset.variant === "curved" ? "straight" : "curved";
          if (_armedStroke && _armedStroke.id === t.id) {
            _armedStroke.variant = btn.dataset.variant;
          }
          pressTimer = null;
        }, LONG_PRESS_MS);
      };
      const release = () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } };
      btn.addEventListener("pointerdown", press);
      btn.addEventListener("pointerup",   () => { release(); armStroke(t.id, btn); });
      btn.addEventListener("pointerleave",release);
      btn.addEventListener("pointercancel",release);
      bar.appendChild(btn);
    });
    // Color swatches
    const sw = document.createElement("div");
    sw.className = "wb-color-swatches";
    COLOR_SWATCHES.forEach((c, i) => {
      const dot = document.createElement("button");
      dot.className = "wb-color-swatch" + (i === 0 ? " active" : "");
      dot.style.background = c.value;
      dot.dataset.color = c.value;
      dot.addEventListener("click", () => {
        _strokeColor = c.value;
        sw.querySelectorAll(".wb-color-swatch").forEach((s) => s.classList.remove("active"));
        dot.classList.add("active");
      });
      sw.appendChild(dot);
    });
    bar.appendChild(sw);

    const sizeWrap = document.createElement("input");
    sizeWrap.type = "range";
    sizeWrap.className = "wb-brush-size";
    sizeWrap.min = "1"; sizeWrap.max = "12"; sizeWrap.value = String(_strokeSize);
    sizeWrap.addEventListener("input", () => { _strokeSize = parseInt(sizeWrap.value, 10) || 3; });
    bar.appendChild(sizeWrap);
  }

  function bindShellHandlers(host) {
    host.querySelector('[data-act="new-session"]').addEventListener("click", onNewSession);
    host.querySelector('[data-act="save-preset"]').addEventListener("click", onSavePreset);
    host.querySelector('[data-act="share"]').addEventListener("click", onShare);
    host.querySelector('[data-act="undo"]').addEventListener("click", onUndo);
    host.querySelector('[data-act="redo"]').addEventListener("click", onRedo);
    host.querySelector('[data-act="duplicate"]').addEventListener("click", onDuplicate);
    host.querySelector('[data-act="trash"]').addEventListener("click", onTrash);
    host.querySelector('[data-act="move"]').addEventListener("click", onPickMove);
    host.querySelector(".wb-drill-title").addEventListener("change", (e) => {
      _drillTitle = e.target.value;
      if (_sessionId) FelixWhiteboardAPI.updateSession(_sessionId, { drill_title: _drillTitle });
    });
    host.querySelector(".wb-session-name").addEventListener("change", (e) => {
      _sessionName = e.target.value || _sessionName;
      if (_sessionId) FelixWhiteboardAPI.updateSession(_sessionId, { name: _sessionName });
    });
    host.querySelector(".wb-presets").addEventListener("change", (e) => {
      const id = e.target.value;
      if (id) loadSession(id);
    });
    host.querySelector(".wb-pen-only input").addEventListener("change", (e) => {
      _penOnly = !!e.target.checked;
    });
    host.querySelectorAll("[data-anim]").forEach((b) =>
      b.addEventListener("click", () => {
        _animDuration = parseInt(b.dataset.anim, 10) || 2000;
        host.querySelectorAll("[data-anim]").forEach((x) => x.classList.toggle("armed", x === b));
      })
    );
    host.querySelector("[data-anim-play]").addEventListener("click", playAnimation);
  }

  // ── Session lifecycle ───────────────────────────────────────────
  async function ensureSession() {
    if (!_teamId) return;
    const sessions = await FelixWhiteboardAPI.listSessions(_teamId);
    if (sessions && sessions.length > 0) {
      await loadSession(sessions[0].id);
      return;
    }
    const s = await FelixWhiteboardAPI.createSession({
      teamId: _teamId,
      name: "Untitled Session",
    });
    _sessionId = s.id;
    _sessionName = s.name;
    syncSessionInputs();
  }

  async function loadSession(id) {
    _sessionId = id;
    const s = await FelixWhiteboardAPI.getSession(id);
    if (s) {
      _sessionName = s.name || "";
      _drillTitle = s.drill_title || "";
    }
    await hydrateSession();
    syncSessionInputs();
    drawAll();
  }

  async function hydrateSession() {
    if (!_sessionId) return;
    const [markers, strokes] = await Promise.all([
      FelixWhiteboardAPI.listMarkers(_sessionId),
      FelixWhiteboardAPI.listStrokes(_sessionId),
    ]);
    _markers = (markers || []).map((m) => ({
      id: m.id,
      type: m.marker_type,
      color: m.color,
      x: m.position_x, y: m.position_y,
      path: Array.isArray(m.path_data) ? m.path_data : null,
    }));
    _strokes = (strokes || []).map((s) => ({
      id: s.id,
      type: s.stroke_type,
      variant: s.variant,
      points: Array.isArray(s.stroke_data) ? s.stroke_data : [],
      color: s.color,
      size: s.brush_size,
      order: s.stroke_order,
    }));
    _undo.length = 0; _redo.length = 0;
    refreshUndoRedoButtons();
    refreshAnimBar();
  }

  function syncSessionInputs() {
    const host = _root.querySelector("#whiteboard-root");
    if (!host) return;
    const nameInput = host.querySelector(".wb-session-name");
    const drillInput = host.querySelector(".wb-drill-title");
    if (nameInput) nameInput.value = _sessionName || "";
    if (drillInput) drillInput.value = _drillTitle || "";
  }

  async function refreshPresetDropdown() {
    const host = _root.querySelector("#whiteboard-root");
    if (!host || !_teamId) return;
    const sel = host.querySelector(".wb-presets");
    const sessions = await FelixWhiteboardAPI.listSessions(_teamId);
    sel.innerHTML = '<option value="">— Presets —</option>' +
      (sessions || []).map((s) => {
        const label = s.drill_title
          ? `${s.name} — ${s.drill_title}`
          : s.name;
        return `<option value="${s.id}"${s.id === _sessionId ? " selected" : ""}>${escapeHtml(label)}</option>`;
      }).join("");
  }

  // ── Marker arming + stroke arming ───────────────────────────────
  function armMarker(m, btn) {
    _activeTool = "marker";
    _armedMarker = m;
    _armedStroke = null;
    const host = _root.querySelector("#whiteboard-root");
    host.querySelectorAll(".wb-marker").forEach((b) => b.classList.toggle("armed", b === btn));
    host.querySelectorAll(".wb-tool").forEach((b) => b.classList.remove("armed"));
    setActionArmed("move", false);
  }
  function armStroke(toolId, btn) {
    _activeTool = "stroke";
    _armedStroke = { id: toolId, variant: btn.dataset.variant };
    _armedMarker = null;
    const host = _root.querySelector("#whiteboard-root");
    host.querySelectorAll(".wb-tool").forEach((b) => b.classList.toggle("armed", b === btn));
    host.querySelectorAll(".wb-marker").forEach((b) => b.classList.remove("armed"));
    setActionArmed("move", false);
  }
  function onPickMove() {
    _activeTool = "move";
    _armedMarker = null;
    _armedStroke = null;
    const host = _root.querySelector("#whiteboard-root");
    host.querySelectorAll(".wb-marker, .wb-tool").forEach((b) => b.classList.remove("armed"));
    setActionArmed("move", true);
  }
  function setActionArmed(act, on) {
    const btn = _root.querySelector(`#whiteboard-root [data-act="${act}"]`);
    if (btn) btn.classList.toggle("armed", !!on);
  }

  // ── Canvas sizing ───────────────────────────────────────────────
  function sizeCanvases() {
    if (!_wrapEl) return;
    const r = _wrapEl.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    [_rinkCanvas, _strokeCanvas, _markerCanvas, _overlayCanvas].forEach((c) => {
      c.width = Math.round(r.width * dpr);
      c.height = Math.round(r.height * dpr);
    });
    [_rinkCtx, _strokeCtx, _markerCtx, _overlayCtx].forEach((ctx) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
    });
  }
  function _onResize() { sizeCanvases(); drawAll(); }

  // ── Canvas dimensions helper (CSS px) ───────────────────────────
  function dim() {
    if (!_wrapEl) return { w: 1, h: 1 };
    const r = _wrapEl.getBoundingClientRect();
    return { w: r.width, h: r.height };
  }
  function nrm(clientX, clientY) {
    const r = _overlayCanvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (clientY - r.top) / r.height)),
    };
  }

  // ── Draw: full ──────────────────────────────────────────────────
  function drawAll() { drawRink(); drawStrokes(); drawMarkers(); }

  function clearCtx(ctx) {
    const { w, h } = dim();
    ctx.clearRect(0, 0, w, h);
  }

  // ── Draw: USA Hockey regulation rink ────────────────────────────
  function drawRink() {
    const ctx = _rinkCtx;
    const { w, h } = dim();
    clearCtx(ctx);
    const sx = w / RINK_W;
    const sy = h / RINK_H;
    ctx.save();
    ctx.scale(sx, sy);

    // Ice
    ctx.fillStyle = "#e8f1ff";
    roundRectPath(ctx, 0, 0, RINK_W, RINK_H, 28 * FT);
    ctx.fill();

    // Boards (outline)
    ctx.lineWidth = 4;
    ctx.strokeStyle = "#1a1a2e";
    ctx.stroke();

    // Goal lines (red, 11 ft from end boards)
    ctx.strokeStyle = "#c8262b";
    ctx.lineWidth = 3;
    drawVerticalLineWithRink(ctx, 11 * FT);
    drawVerticalLineWithRink(ctx, RINK_W - 11 * FT);

    // Blue lines (75 ft from goal lines → 86 ft from end boards)
    ctx.strokeStyle = "#1f5fc4";
    ctx.lineWidth = 12;
    drawVerticalLine(ctx, 75 * FT + 11 * FT, RINK_H);
    drawVerticalLine(ctx, RINK_W - (75 * FT + 11 * FT), RINK_H);

    // Center red line
    ctx.strokeStyle = "#c8262b";
    ctx.lineWidth = 12;
    drawVerticalLine(ctx, RINK_W / 2, RINK_H);

    // Center face-off circle (15 ft radius)
    ctx.strokeStyle = "#1f5fc4";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(RINK_W / 2, RINK_H / 2, 15 * FT, 0, Math.PI * 2);
    ctx.stroke();
    // Center face-off dot (blue)
    ctx.fillStyle = "#1f5fc4";
    ctx.beginPath();
    ctx.arc(RINK_W / 2, RINK_H / 2, 6, 0, Math.PI * 2);
    ctx.fill();

    // 4 zone face-off circles (15 ft radius). Per USA Hockey: 20 ft from
    // goal line, 22 ft from rink centerline (top↔bottom).
    const zoneCircleX1 = 11 * FT + 20 * FT;
    const zoneCircleX2 = RINK_W - (11 * FT + 20 * FT);
    const zoneCircleY1 = RINK_H / 2 - 22 * FT;
    const zoneCircleY2 = RINK_H / 2 + 22 * FT;
    [
      [zoneCircleX1, zoneCircleY1], [zoneCircleX1, zoneCircleY2],
      [zoneCircleX2, zoneCircleY1], [zoneCircleX2, zoneCircleY2],
    ].forEach(([cx, cy]) => {
      ctx.strokeStyle = "#c8262b";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 15 * FT, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#c8262b";
      ctx.beginPath();
      ctx.arc(cx, cy, 6, 0, Math.PI * 2);
      ctx.fill();
    });

    // Neutral-zone face-off dots (4 dots, 5 ft inside blue line, 22 ft
    // from centerline top↔bottom). Red, no circle.
    const nzX1 = 75 * FT + 11 * FT - 5 * FT;
    const nzX2 = RINK_W - (75 * FT + 11 * FT) + 5 * FT;
    [
      [nzX1, zoneCircleY1], [nzX1, zoneCircleY2],
      [nzX2, zoneCircleY1], [nzX2, zoneCircleY2],
    ].forEach(([cx, cy]) => {
      ctx.fillStyle = "#c8262b";
      ctx.beginPath();
      ctx.arc(cx, cy, 6, 0, Math.PI * 2);
      ctx.fill();
    });

    // Goal creases (4 ft radius semicircle, light blue tint)
    const goalLine1 = 11 * FT;
    const goalLine2 = RINK_W - 11 * FT;
    ctx.fillStyle = "rgba(122,179,255,0.28)";
    ctx.strokeStyle = "#c8262b";
    ctx.lineWidth = 2;
    // Left crease (opens right)
    ctx.beginPath();
    ctx.arc(goalLine1, RINK_H / 2, 4 * FT, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(goalLine1, RINK_H / 2 + 4 * FT);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(goalLine1, RINK_H / 2, 4 * FT, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
    // Right crease (opens left)
    ctx.beginPath();
    ctx.arc(goalLine2, RINK_H / 2, 4 * FT, Math.PI / 2, -Math.PI / 2);
    ctx.lineTo(goalLine2, RINK_H / 2 - 4 * FT);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(goalLine2, RINK_H / 2, 4 * FT, Math.PI / 2, -Math.PI / 2);
    ctx.stroke();

    // Trapezoids (USA Hockey: 8 ft from goal post each side at end
    // boards; 11 ft from each goal post at the goal line). 6 ft goal
    // mouth means goal posts are 3 ft from rink center each side.
    ctx.strokeStyle = "#c8262b";
    ctx.lineWidth = 2;
    // Goal posts at y = RINK_H/2 ± 3 ft
    const post1 = RINK_H / 2 - 3 * FT;
    const post2 = RINK_H / 2 + 3 * FT;
    // Left trapezoid
    ctx.beginPath();
    ctx.moveTo(goalLine1, post1);
    ctx.lineTo(0, post1 - 8 * FT);
    ctx.moveTo(goalLine1, post2);
    ctx.lineTo(0, post2 + 8 * FT);
    ctx.stroke();
    // Right trapezoid
    ctx.beginPath();
    ctx.moveTo(goalLine2, post1);
    ctx.lineTo(RINK_W, post1 - 8 * FT);
    ctx.moveTo(goalLine2, post2);
    ctx.lineTo(RINK_W, post2 + 8 * FT);
    ctx.stroke();

    // Referee crease (semicircle on center red line, opens up, 10 ft radius)
    ctx.strokeStyle = "#c8262b";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(RINK_W / 2, RINK_H, 10 * FT, Math.PI, 0);
    ctx.stroke();

    ctx.restore();
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function drawVerticalLine(ctx, x, h) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  function drawVerticalLineWithRink(ctx, x) {
    // Goal line clips to crease arc curves — draw straight, the crease
    // overlay covers the small overlap. This is a tactical board, not a
    // refereed broadcast graphic.
    drawVerticalLine(ctx, x, RINK_H);
  }

  // ── Draw: strokes ───────────────────────────────────────────────
  function drawStrokes() {
    const ctx = _strokeCtx;
    const { w, h } = dim();
    clearCtx(ctx);
    _strokes.forEach((s) => drawStroke(ctx, s, w, h));
  }
  function drawStroke(ctx, s, w, h) {
    const def = STROKE_TOOLS.find((t) => t.id === s.type);
    if (!def || !s.points || s.points.length < 1) return;
    ctx.save();
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.setLineDash(def.dash || []);

    const pts = s.variant === "straight" && s.points.length >= 2
      ? [s.points[0], s.points[s.points.length - 1]]
      : s.points;

    // Draw with variable width if pressure data present.
    const hasPressure = pts.some((p) => p.pressure && p.pressure !== 0.5);
    if (hasPressure && pts.length >= 2 && s.variant !== "straight") {
      // Segmented variable-width path
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        ctx.lineWidth = (s.size || 3) * (0.5 + ((a.pressure || 0.5) + (b.pressure || 0.5)));
        ctx.beginPath();
        ctx.moveTo(a.x * w, a.y * h);
        ctx.lineTo(b.x * w, b.y * h);
        ctx.stroke();
      }
    } else {
      ctx.lineWidth = s.size || 3;
      ctx.beginPath();
      ctx.moveTo(pts[0].x * w, pts[0].y * h);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x * w, pts[i].y * h);
      }
      ctx.stroke();
    }

    // End cap
    if (pts.length >= 2) {
      const last = pts[pts.length - 1];
      const prev = pts[pts.length - 2];
      const ang = Math.atan2((last.y - prev.y) * h, (last.x - prev.x) * w);
      const lx = last.x * w, ly = last.y * h;
      ctx.setLineDash([]);
      if (def.end === "arrow") drawArrowHead(ctx, lx, ly, ang, Math.max(8, (s.size || 3) * 3));
      if (def.end === "stop")  drawStopCap(ctx, lx, ly, ang, Math.max(10, (s.size || 3) * 3));
    }
    ctx.restore();
  }
  function drawArrowHead(ctx, x, y, ang, size) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - size * Math.cos(ang - Math.PI / 7), y - size * Math.sin(ang - Math.PI / 7));
    ctx.lineTo(x - size * Math.cos(ang + Math.PI / 7), y - size * Math.sin(ang + Math.PI / 7));
    ctx.closePath();
    ctx.fill();
  }
  function drawStopCap(ctx, x, y, ang, size) {
    const px = -Math.sin(ang), py = Math.cos(ang);
    const offsets = [-2, 2];
    offsets.forEach((o) => {
      const cx = x + o * Math.cos(ang);
      const cy = y + o * Math.sin(ang);
      ctx.beginPath();
      ctx.moveTo(cx + px * size, cy + py * size);
      ctx.lineTo(cx - px * size, cy - py * size);
      ctx.stroke();
    });
  }

  // ── Draw: markers ───────────────────────────────────────────────
  function drawMarkers(animPos) {
    const ctx = _markerCtx;
    const { w, h } = dim();
    clearCtx(ctx);
    _markers.forEach((m) => {
      // Path overlay (drawn first, beneath marker)
      if (Array.isArray(m.path) && m.path.length > 1) {
        ctx.save();
        ctx.strokeStyle = m.color === "blue" ? "#2d7dd2" : (m.color === "red" ? "#e63946" : "#888899");
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.moveTo(m.x * w, m.y * h);
        m.path.forEach((p) => ctx.lineTo(p.x * w, p.y * h));
        ctx.stroke();
        ctx.restore();
      }

      // Position (animated or static)
      let px = m.x, py = m.y;
      if (animPos && animPos[m.id]) {
        px = animPos[m.id].x;
        py = animPos[m.id].y;
      }
      drawMarkerSymbol(ctx, m, px * w, py * h);
    });
  }
  function drawMarkerSymbol(ctx, m, x, y) {
    const r = 18;
    ctx.save();
    if (m.type === "puck") {
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = "#080810";
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, r * 0.6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    } else {
      const fill = m.color === "blue" ? "#2d7dd2" : "#e63946";
      ctx.fillStyle = fill;
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.font = "bold 13px Outfit, sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(m.type, x, y + 0.5);
    }
    ctx.restore();
  }

  // ── Pointer input (overlay canvas) ──────────────────────────────
  function bindCanvasInput() {
    const c = _overlayCanvas;
    c.addEventListener("pointerdown", onPointerDown);
    c.addEventListener("pointermove", onPointerMove);
    c.addEventListener("pointerup",   onPointerUp);
    c.addEventListener("pointercancel", onPointerUp);
  }
  function isPenAllowed(e) {
    if (!_penOnly) return true;
    return e.pointerType === "pen";
  }

  function onPointerDown(e) {
    if (!isPenAllowed(e)) return;
    e.preventDefault();
    const p = nrm(e.clientX, e.clientY);
    closeMarkerMenu();

    // 1) Drawing-a-path mode: single-stroke capture, save to active marker.
    if (_pathDrawForMarkerId) {
      _drawingStroke = { kind: "path", points: [p] };
      _overlayCanvas.setPointerCapture(e.pointerId);
      return;
    }
    // 2) Marker placement
    if (_activeTool === "marker" && _armedMarker) {
      placeMarkerAt(p);
      return;
    }
    // 3) Stroke drawing
    if (_activeTool === "stroke" && _armedStroke) {
      _drawingStroke = {
        kind: "stroke",
        type: _armedStroke.id,
        variant: _armedStroke.variant,
        points: [{ x: p.x, y: p.y, pressure: e.pressure || 0.5 }],
        color: _strokeColor,
        size: _strokeSize,
      };
      _overlayCanvas.setPointerCapture(e.pointerId);
      return;
    }
    // 4) Move tool — try long-press on an existing marker for drag/menu.
    const hit = hitMarker(p);
    if (hit) {
      _longPressTimer = setTimeout(() => {
        _longPressTimer = null;
        _dragMarker = { marker: hit, startX: hit.x, startY: hit.y };
      }, LONG_PRESS_MS);
      _overlayCanvas.setPointerCapture(e.pointerId);
      _dragCandidate = hit;
    }
  }
  let _dragCandidate = null;

  function onPointerMove(e) {
    if (!isPenAllowed(e)) return;
    const p = nrm(e.clientX, e.clientY);

    if (_drawingStroke) {
      _drawingStroke.points.push(_drawingStroke.kind === "stroke"
        ? { x: p.x, y: p.y, pressure: e.pressure || 0.5 }
        : { x: p.x, y: p.y });
      drawOverlayInProgress();
      return;
    }
    if (_dragMarker) {
      _dragMarker.marker.x = p.x;
      _dragMarker.marker.y = p.y;
      drawMarkers();
      return;
    }
    // Cancel long-press if user moved before timer fired.
    if (_longPressTimer && _dragCandidate) {
      const dx = (p.x - _dragCandidate.x);
      const dy = (p.y - _dragCandidate.y);
      if (Math.hypot(dx, dy) > 0.01) {
        clearTimeout(_longPressTimer);
        _longPressTimer = null;
        _dragCandidate = null;
      }
    }
  }

  function onPointerUp(e) {
    if (_longPressTimer) {
      clearTimeout(_longPressTimer);
      _longPressTimer = null;
      // Tap (no long-press) on an existing marker → open mini menu
      if (_dragCandidate && _activeTool === "move") {
        openMarkerMenu(_dragCandidate, e.clientX, e.clientY);
      }
      _dragCandidate = null;
    }

    if (_drawingStroke) {
      try { _overlayCanvas.releasePointerCapture(e.pointerId); } catch (_) {}
      finishDrawing();
      return;
    }
    if (_dragMarker) {
      try { _overlayCanvas.releasePointerCapture(e.pointerId); } catch (_) {}
      const m = _dragMarker.marker;
      pushUndo({ type: "move", id: m.id, fromX: _dragMarker.startX, fromY: _dragMarker.startY, toX: m.x, toY: m.y });
      FelixWhiteboardAPI.moveMarker(m.id, m.x, m.y);
      _dragMarker = null;
      drawMarkers();
    }
    _dragCandidate = null;
  }

  function drawOverlayInProgress() {
    clearCtx(_overlayCtx);
    if (!_drawingStroke) return;
    const { w, h } = dim();
    if (_drawingStroke.kind === "stroke") {
      drawStroke(_overlayCtx, {
        type: _drawingStroke.type,
        variant: _drawingStroke.variant,
        points: _drawingStroke.points,
        color: _drawingStroke.color,
        size: _drawingStroke.size,
      }, w, h);
    } else if (_drawingStroke.kind === "path") {
      _overlayCtx.save();
      _overlayCtx.strokeStyle = "#3AAEAC";
      _overlayCtx.lineWidth = 2;
      _overlayCtx.setLineDash([6, 6]);
      _overlayCtx.beginPath();
      const pts = _drawingStroke.points;
      _overlayCtx.moveTo(pts[0].x * w, pts[0].y * h);
      pts.forEach((p) => _overlayCtx.lineTo(p.x * w, p.y * h));
      _overlayCtx.stroke();
      _overlayCtx.restore();
    }
  }

  function finishDrawing() {
    const ds = _drawingStroke;
    _drawingStroke = null;
    clearCtx(_overlayCtx);
    if (!ds) return;

    if (ds.kind === "path" && _pathDrawForMarkerId) {
      const m = _markers.find((x) => x.id === _pathDrawForMarkerId);
      if (m) {
        const prev = m.path;
        m.path = ds.points.map((p) => ({ x: p.x, y: p.y }));
        pushUndo({ type: "path", id: m.id, prev, next: m.path });
        FelixWhiteboardAPI.setMarkerPath(m.id, m.path);
      }
      _pathDrawForMarkerId = null;
      onPickMove();
      drawMarkers();
      refreshAnimBar();
      return;
    }
    if (ds.kind === "stroke" && ds.points.length >= 2) {
      const order = _strokes.length;
      const row = FelixWhiteboardAPI.addStroke({
        sessionId: _sessionId,
        strokeType: ds.type,
        variant: ds.variant,
        points: ds.points,
        color: ds.color,
        brushSize: ds.size,
        order,
      });
      _strokes.push({
        id: row.id, type: row.stroke_type, variant: row.variant,
        points: row.stroke_data, color: row.color, size: row.brush_size,
        order: row.stroke_order,
      });
      pushUndo({ type: "stroke", id: row.id });
      drawStrokes();
    }
  }

  // ── Marker placement / drag / menu ──────────────────────────────
  function placeMarkerAt(p) {
    if (!_armedMarker || !_sessionId) return;
    // Single-instance markers: replace if same type+color already placed.
    const existing = _markers.find((m) =>
      m.type === _armedMarker.type && m.color === _armedMarker.color);
    if (existing) {
      const prevX = existing.x, prevY = existing.y;
      existing.x = p.x; existing.y = p.y;
      pushUndo({ type: "move", id: existing.id, fromX: prevX, fromY: prevY, toX: p.x, toY: p.y });
      FelixWhiteboardAPI.moveMarker(existing.id, p.x, p.y);
      drawMarkers();
      return;
    }
    const row = FelixWhiteboardAPI.placeMarker({
      sessionId: _sessionId,
      markerType: _armedMarker.type,
      color: _armedMarker.color,
      x: p.x, y: p.y,
    });
    _markers.push({
      id: row.id, type: row.marker_type, color: row.color,
      x: row.position_x, y: row.position_y, path: null,
    });
    pushUndo({ type: "place", id: row.id });
    drawMarkers();
  }
  function hitMarker(p) {
    const { w, h } = dim();
    for (let i = _markers.length - 1; i >= 0; i--) {
      const m = _markers[i];
      const dx = (m.x - p.x) * w;
      const dy = (m.y - p.y) * h;
      if (Math.hypot(dx, dy) <= 22) return m;
    }
    return null;
  }
  function openMarkerMenu(m, clientX, clientY) {
    closeMarkerMenu();
    const host = _root.querySelector("#whiteboard-root");
    const wrap = host.querySelector(".wb-stage");
    const wrapR = wrap.getBoundingClientRect();
    const menu = document.createElement("div");
    menu.className = "wb-marker-menu";
    menu.style.left = (clientX - wrapR.left) + "px";
    menu.style.top  = (clientY - wrapR.top)  + "px";
    menu.innerHTML = `
      <button data-mm="animate">Animate Path</button>
      <button data-mm="clear-path">Clear Path</button>
      <button data-mm="delete" class="danger">Delete</button>`;
    menu.querySelector('[data-mm="animate"]').addEventListener("click", () => {
      _pathDrawForMarkerId = m.id;
      _activeTool = "path-draw";
      _armedMarker = null; _armedStroke = null;
      host.querySelectorAll(".wb-marker, .wb-tool").forEach((b) => b.classList.remove("armed"));
      setActionArmed("move", false);
      closeMarkerMenu();
    });
    menu.querySelector('[data-mm="clear-path"]').addEventListener("click", () => {
      const prev = m.path;
      m.path = null;
      pushUndo({ type: "path", id: m.id, prev, next: null });
      FelixWhiteboardAPI.setMarkerPath(m.id, null);
      drawMarkers();
      refreshAnimBar();
      closeMarkerMenu();
    });
    menu.querySelector('[data-mm="delete"]').addEventListener("click", () => {
      const idx = _markers.findIndex((x) => x.id === m.id);
      if (idx >= 0) {
        const removed = _markers.splice(idx, 1)[0];
        pushUndo({ type: "delete", marker: removed });
        FelixWhiteboardAPI.deleteMarker(m.id);
        drawMarkers();
      }
      closeMarkerMenu();
    });
    wrap.appendChild(menu);
    _markerMenuFor = m.id;
    setTimeout(() => { document.addEventListener("pointerdown", _maybeCloseMenu, true); }, 0);
  }
  function _maybeCloseMenu(e) {
    if (e.target.closest(".wb-marker-menu")) return;
    closeMarkerMenu();
  }
  function closeMarkerMenu() {
    _markerMenuFor = null;
    document.removeEventListener("pointerdown", _maybeCloseMenu, true);
    _root && _root.querySelectorAll(".wb-marker-menu").forEach((m) => m.remove());
  }

  // ── Animation playback ──────────────────────────────────────────
  function refreshAnimBar() {
    const host = _root.querySelector("#whiteboard-root");
    if (!host) return;
    const bar = host.querySelector(".wb-anim-bar");
    const has = _markers.some((m) => Array.isArray(m.path) && m.path.length > 1);
    bar.hidden = !has;
  }
  function playAnimation() {
    if (_animPlaying) { cancelAnim(); return; }
    const anims = _markers
      .filter((m) => Array.isArray(m.path) && m.path.length > 1)
      .map((m) => ({ id: m.id, from: { x: m.x, y: m.y }, path: m.path }));
    if (anims.length === 0) return;
    _animPlaying = true;
    _animStart = performance.now();
    const loop = () => {
      if (!_animPlaying) return;
      const t = Math.min(1, (performance.now() - _animStart) / _animDuration);
      const pos = {};
      anims.forEach((a) => {
        const segs = [a.from].concat(a.path);
        const totalSegs = segs.length - 1;
        const localT = t * totalSegs;
        const i = Math.min(totalSegs - 1, Math.floor(localT));
        const f = localT - i;
        const a0 = segs[i], a1 = segs[i + 1];
        pos[a.id] = { x: a0.x + (a1.x - a0.x) * f, y: a0.y + (a1.y - a0.y) * f };
      });
      drawMarkers(pos);
      if (t >= 1) { _animPlaying = false; drawMarkers(); return; }
      _animRaf = requestAnimationFrame(loop);
    };
    _animRaf = requestAnimationFrame(loop);
  }
  function cancelAnim() {
    _animPlaying = false;
    if (_animRaf) cancelAnimationFrame(_animRaf);
    _animRaf = null;
    drawMarkers();
  }

  // ── Undo / Redo ─────────────────────────────────────────────────
  function pushUndo(op) {
    _undo.push(op);
    if (_undo.length > 50) _undo.shift();
    _redo.length = 0;
    refreshUndoRedoButtons();
  }
  function refreshUndoRedoButtons() {
    const host = _root.querySelector("#whiteboard-root");
    if (!host) return;
    host.querySelector('[data-act="undo"]').toggleAttribute("disabled", _undo.length === 0);
    host.querySelector('[data-act="redo"]').toggleAttribute("disabled", _redo.length === 0);
  }
  function onUndo() {
    const op = _undo.pop();
    if (!op) return;
    applyOpReverse(op);
    _redo.push(op);
    refreshUndoRedoButtons();
    drawAll();
    refreshAnimBar();
  }
  function onRedo() {
    const op = _redo.pop();
    if (!op) return;
    applyOpForward(op);
    _undo.push(op);
    refreshUndoRedoButtons();
    drawAll();
    refreshAnimBar();
  }
  function applyOpReverse(op) {
    if (op.type === "place") {
      const idx = _markers.findIndex((m) => m.id === op.id);
      if (idx >= 0) { const m = _markers.splice(idx, 1)[0]; FelixWhiteboardAPI.deleteMarker(m.id); op._restore = m; }
    } else if (op.type === "delete") {
      _markers.push(op.marker);
      FelixWhiteboardAPI.placeMarker({
        sessionId: _sessionId, markerType: op.marker.type, color: op.marker.color,
        x: op.marker.x, y: op.marker.y,
      });
    } else if (op.type === "move") {
      const m = _markers.find((x) => x.id === op.id);
      if (m) { m.x = op.fromX; m.y = op.fromY; FelixWhiteboardAPI.moveMarker(m.id, m.x, m.y); }
    } else if (op.type === "stroke") {
      const idx = _strokes.findIndex((s) => s.id === op.id);
      if (idx >= 0) { const s = _strokes.splice(idx, 1)[0]; FelixWhiteboardAPI.deleteStroke(s.id); op._restore = s; }
    } else if (op.type === "path") {
      const m = _markers.find((x) => x.id === op.id);
      if (m) { m.path = op.prev; FelixWhiteboardAPI.setMarkerPath(m.id, op.prev); }
    }
  }
  function applyOpForward(op) {
    if (op.type === "place" && op._restore) {
      _markers.push(op._restore);
      FelixWhiteboardAPI.placeMarker({
        sessionId: _sessionId, markerType: op._restore.type, color: op._restore.color,
        x: op._restore.x, y: op._restore.y,
      });
    } else if (op.type === "delete") {
      const idx = _markers.findIndex((m) => m.id === op.marker.id);
      if (idx >= 0) { _markers.splice(idx, 1); FelixWhiteboardAPI.deleteMarker(op.marker.id); }
    } else if (op.type === "move") {
      const m = _markers.find((x) => x.id === op.id);
      if (m) { m.x = op.toX; m.y = op.toY; FelixWhiteboardAPI.moveMarker(m.id, m.x, m.y); }
    } else if (op.type === "stroke" && op._restore) {
      _strokes.push(op._restore);
      FelixWhiteboardAPI.addStroke({
        sessionId: _sessionId, strokeType: op._restore.type, variant: op._restore.variant,
        points: op._restore.points, color: op._restore.color, brushSize: op._restore.size,
        order: op._restore.order,
      });
    } else if (op.type === "path") {
      const m = _markers.find((x) => x.id === op.id);
      if (m) { m.path = op.next; FelixWhiteboardAPI.setMarkerPath(m.id, op.next); }
    }
  }

  // ── Top-bar actions ─────────────────────────────────────────────
  async function onNewSession() {
    if (!_teamId) return;
    const s = await FelixWhiteboardAPI.createSession({ teamId: _teamId, name: "Untitled Session" });
    _sessionId = s.id;
    _sessionName = s.name;
    _drillTitle = "";
    _markers = []; _strokes = []; _undo = []; _redo = [];
    syncSessionInputs();
    refreshUndoRedoButtons();
    refreshAnimBar();
    drawAll();
    refreshPresetDropdown();
  }
  async function onSavePreset() {
    if (!_sessionId) return;
    const title = _drillTitle || _sessionName || "Drill preset";
    await FelixWhiteboardAPI.updateSession(_sessionId, {
      drill_title: title, name: title,
    });
    refreshPresetDropdown();
  }
  async function onDuplicate() {
    if (!_sessionId || !_teamId) return;
    const dup = await FelixWhiteboardAPI.duplicateSession(_sessionId, (_sessionName || "Session") + " (copy)");
    await loadSession(dup.id);
    refreshPresetDropdown();
  }
  function onTrash() {
    const host = _root.querySelector("#whiteboard-root");
    const m = document.createElement("div");
    m.className = "wb-modal";
    m.innerHTML = `
      <div class="wb-modal-card">
        <h3>Clear board?</h3>
        <p>Removes every marker and stroke from this session. Cannot be undone.</p>
        <div class="wb-modal-actions">
          <button class="wb-btn" data-mod="cancel">Cancel</button>
          <button class="wb-btn primary" data-mod="ok">Clear</button>
        </div>
      </div>`;
    m.querySelector('[data-mod="cancel"]').addEventListener("click", () => m.remove());
    m.querySelector('[data-mod="ok"]').addEventListener("click", async () => {
      m.remove();
      await FelixWhiteboardAPI.clearSession(_sessionId);
      _markers = []; _strokes = []; _undo = []; _redo = [];
      refreshUndoRedoButtons();
      refreshAnimBar();
      drawAll();
    });
    host.appendChild(m);
  }
  async function onShare() {
    const blob = await flattenToBlob();
    if (!blob) return;
    const file = new File([blob], "whiteboard.png", { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: _sessionName || "Whiteboard",
          text:  _drillTitle || "44 Shots whiteboard",
        });
        return;
      } catch (_) { /* user canceled or unsupported — fall through */ }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = (_sessionName || "whiteboard") + ".png";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  function flattenToBlob() {
    const { w, h } = dim();
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const out = document.createElement("canvas");
    out.width = Math.round(w * dpr); out.height = Math.round(h * dpr);
    const ctx = out.getContext("2d");
    ctx.drawImage(_rinkCanvas, 0, 0, out.width, out.height);
    ctx.drawImage(_strokeCanvas, 0, 0, out.width, out.height);
    ctx.drawImage(_markerCanvas, 0, 0, out.width, out.height);
    return new Promise((res) => out.toBlob((b) => res(b), "image/png"));
  }

  // ── Tool icons (inline SVG fragments) ───────────────────────────
  function svgSkate()      { return '<svg viewBox="0 0 24 24"><path d="M3 17 C 7 5, 17 19, 21 7"/></svg>'; }
  function svgSkateStop()  { return '<svg viewBox="0 0 24 24"><path d="M3 17 C 7 5, 17 19, 21 7"/><line x1="20" y1="4" x2="22.5" y2="9"/><line x1="22.5" y1="5" x2="19" y2="8"/></svg>'; }
  function svgSkateShot()  { return '<svg viewBox="0 0 24 24"><path d="M3 17 C 7 5, 17 19, 21 7"/><polygon points="21,7 17,7 19,11" fill="currentColor"/></svg>'; }
  function svgPass()       { return '<svg viewBox="0 0 24 24"><line x1="3" y1="17" x2="20" y2="7" stroke-dasharray="3,3"/><polygon points="21,7 16,6 18,11" fill="currentColor"/></svg>'; }
  function svgShot()       { return '<svg viewBox="0 0 24 24"><line x1="3" y1="17" x2="20" y2="7"/><polygon points="21,7 16,6 18,11" fill="currentColor"/></svg>'; }
  function svgLoosePuck()  { return '<svg viewBox="0 0 24 24"><line x1="3" y1="17" x2="20" y2="7" stroke-dasharray="1,4"/></svg>'; }

  // ── Util ────────────────────────────────────────────────────────
  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({
      "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;",
    }[c]));
  }
})();
