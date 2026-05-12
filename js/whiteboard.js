// js/whiteboard.js — Whiteboard tab module (44 Shots / NOMOS).
// LOCKED 2026-05-11. Layout mirrors Rink screen (#panel-rink + #leftRail).
//
// DOM emitted on first activation (no #whiteboard-root wrapper — direct
// children of #panel-whiteboard per 2026-05-11 locked spec):
//   body > #wbLeftRail            (empty tonight; reserved for animation)
//   #panel-whiteboard
//     > .wb-rink-wrap
//         > svg.wb-rink (viewBox 1000x425, regulation NHL 200ft×85ft)
//             > <g class="wb-strokes">  pen strokes
//             > <g class="wb-markers">  dragged red/blue player tokens
//     > #wbRightRail
//         > .wb-tray         (red + blue tray-dots, drag sources)
//         > .wb-divider
//         > .wb-tool[pen]    (active by default)
//         > .wb-colors       (black / blue / red swatches)
//         > .wb-slider-wrap  (SIZE label + range slider 1..12)
//         > .wb-divider
//         > .wb-tool[eraser] (tap a stroke to remove it)
//         > .wb-tool.danger[clear]
//
// In-memory only tonight. Persistence (FelixWhiteboardAPI) untouched on
// disk and not imported here. Tuesday 2026-05-12 audit decides re-wire.

(function () {
  "use strict";

  const COLOR_HEX = { black: "#000000", blue: "#1f5fc4", red: "#c8262b" };
  // ViewBox 1000 × 425 — regulation NHL aspect 200ft × 85ft (~2.353:1).
  // y-coords rescaled from prior 1000×600 by factor 425/600 = 0.7083.
  const RINK_W = 1000, RINK_H = 425;
  // Placed marker radius. Tray drag-source size lives in CSS (.wb-tray-dot).
  // Visual hierarchy: rink shot markers r=7 < swatches 22px < placed r=12
  // < tray 32px. Reduced 18→12 (2026-05-11).
  const MARKER_R = 12;
  const SVGNS = "http://www.w3.org/2000/svg";

  let _root = null;
  let _inited = false;
  let _svg = null;
  let _strokeLayer = null;
  let _markerLayer = null;
  let _rightRail = null;

  const _state = {
    tool:  "pen",          // "pen" | "eraser"
    color: COLOR_HEX.black,
    size:  3,
    strokes: [],           // [{ id, color, size, points: [{x,y}], el }]
    markers: [],           // [{ id, color: "red"|"blue", x, y, el }]
  };

  let _drawing = null;
  let _dragMarker = null;
  let _nid = 1;
  const uid = () => "wb_" + (_nid++) + "_" + Date.now().toString(36);

  // ── Public tab module interface ─────────────────────────────────
  window.FelixWhiteboard = {
    label: "Whiteboard",
    icon:
      '<svg viewBox="0 0 24 24">' +
      '<rect x="3" y="4" width="18" height="14" rx="1.5"/>' +
      '<line x1="3" y1="20" x2="21" y2="20"/>' +
      '<line x1="7" y1="9" x2="13" y2="9"/>' +
      '<line x1="7" y1="13" x2="17" y2="13"/>' +
      '</svg>',

    init(root) {
      _root = root;
      injectLeftRail();
    },

    onActivate() {
      if (!_inited) {
        renderShell();
        bindShellHandlers();
        bindRinkHandlers();
        _inited = true;
      }
    },

    onDeactivate() {
      cancelDrawing();
      cancelDragging();
    },
  };

  // ── Left rail (body-direct, hidden until body.on-whiteboard) ────
  function injectLeftRail() {
    if (document.getElementById("wbLeftRail")) return;
    const rail = document.createElement("div");
    rail.id = "wbLeftRail";
    rail.setAttribute("aria-label", "Whiteboard animation tools");
    document.body.appendChild(rail);
  }

  // ── Shell: SVG rink + right rail ────────────────────────────────
  function renderShell() {
    _root.innerHTML = SHELL_HTML;
    _svg         = _root.querySelector("svg.wb-rink");
    _strokeLayer = _svg.querySelector("g.wb-strokes");
    _markerLayer = _svg.querySelector("g.wb-markers");
    _rightRail   = _root.querySelector("#wbRightRail");
  }

  // Rink graphic — y-coords rescaled by 425/600 (0.7083) from #rinkSvg.
  // x-coords unchanged. Crease: regulation 6ft radius (rx=ry=30 viewBox
  // units at 5 units/ft); endpoints 182/242 bracket the net (y=202..223).
  const RINK_GRAPHICS = `
    <defs>
      <pattern id="wbIceTexture" width="6" height="6" patternUnits="userSpaceOnUse">
        <rect width="6" height="6" fill="#e8f1ff"/>
        <circle cx="3" cy="3" r=".4" fill="#cfe0f5" opacity=".5"/>
      </pattern>
    </defs>
    <rect x="0" y="0" width="1000" height="425" rx="60" ry="60" fill="url(#wbIceTexture)" stroke="#1a1a1a" stroke-width="4"/>
    <line x1="60"  y1="28" x2="60"  y2="397" stroke="#c8262b" stroke-width="2"/>
    <line x1="940" y1="28" x2="940" y2="397" stroke="#c8262b" stroke-width="2"/>
    <line x1="370" y1="28" x2="370" y2="397" stroke="#1f5fc4" stroke-width="6"/>
    <line x1="630" y1="28" x2="630" y2="397" stroke="#1f5fc4" stroke-width="6"/>
    <line x1="500" y1="28" x2="500" y2="397" stroke="#c8262b" stroke-width="4" stroke-dasharray="2 0"/>
    <circle cx="500" cy="212" r="50" fill="none" stroke="#1f5fc4" stroke-width="2"/>
    <circle cx="500" cy="212" r="3"  fill="#1f5fc4"/>
    <g stroke="#c8262b" stroke-width="2" fill="none">
      <circle cx="200" cy="120" r="55"/>
      <circle cx="200" cy="305" r="55"/>
      <circle cx="800" cy="120" r="55"/>
      <circle cx="800" cy="305" r="55"/>
    </g>
    <g fill="#c8262b">
      <circle cx="200" cy="120" r="3"/>
      <circle cx="200" cy="305" r="3"/>
      <circle cx="800" cy="120" r="3"/>
      <circle cx="800" cy="305" r="3"/>
    </g>
    <g fill="#c8262b">
      <circle cx="396" cy="120" r="3"/>
      <circle cx="396" cy="305" r="3"/>
      <circle cx="604" cy="120" r="3"/>
      <circle cx="604" cy="305" r="3"/>
    </g>
    <path d="M 60 182 A 30 30 0 0 1 60 242 Z" fill="#1f5fc4" opacity=".55" stroke="#c8262b" stroke-width="1.5"/>
    <path d="M 940 182 A 30 30 0 0 0 940 242 Z" fill="#1f5fc4" opacity=".55" stroke="#c8262b" stroke-width="1.5"/>
    <rect x="50"  y="202" width="10" height="21" fill="#fff" stroke="#c8262b" stroke-width="1.5"/>
    <rect x="940" y="202" width="10" height="21" fill="#fff" stroke="#c8262b" stroke-width="1.5"/>
    <g>
      <circle cx="80"  cy="212" r="14" fill="#c8262b" stroke="#fff" stroke-width="2"/>
      <text   x="80"  y="216" text-anchor="middle" fill="#fff" font-family="var(--sans)" font-size="13" font-weight="700">H</text>
    </g>
    <g>
      <circle cx="920" cy="212" r="14" fill="#1f5fc4" stroke="#fff" stroke-width="2"/>
      <text   x="920" y="216" text-anchor="middle" fill="#fff" font-family="var(--sans)" font-size="13" font-weight="700">A</text>
    </g>`;

  // SHELL_HTML — direct children of #panel-whiteboard. The prior
  // #whiteboard-root wrapper was stripped 2026-05-11 — locked spec.
  const SHELL_HTML = `
    <div class="wb-rink-wrap">
      <svg class="wb-rink" viewBox="0 0 ${RINK_W} ${RINK_H}" preserveAspectRatio="xMidYMid meet">
        ${RINK_GRAPHICS}
        <g class="wb-strokes"></g>
        <g class="wb-markers"></g>
      </svg>
    </div>
    <div id="wbRightRail" role="toolbar" aria-label="Whiteboard tools">
      <div class="wb-tray" role="group" aria-label="Player markers">
        <button class="wb-tray-dot red"  data-tray="red"  aria-label="Drag red player onto rink"></button>
        <button class="wb-tray-dot blue" data-tray="blue" aria-label="Drag blue player onto rink"></button>
      </div>
      <div class="wb-divider"></div>
      <button class="wb-tool active" data-tool="pen">PEN</button>
      <div class="wb-colors" role="group" aria-label="Pen color">
        <button class="wb-swatch active" data-color="black" aria-label="Black"></button>
        <button class="wb-swatch"        data-color="blue"  aria-label="Blue"></button>
        <button class="wb-swatch"        data-color="red"   aria-label="Red"></button>
      </div>
      <div class="wb-slider-wrap">
        <span class="wb-slider-label">SIZE</span>
        <input type="range" class="wb-slider" min="1" max="12" value="3" aria-label="Pen line size">
      </div>
      <div class="wb-divider"></div>
      <button class="wb-tool" data-tool="eraser">ERASER</button>
      <button class="wb-tool danger" data-tool="clear">CLEAR</button>
    </div>`;

  // ── Right rail handlers ─────────────────────────────────────────
  function bindShellHandlers() {
    _rightRail.addEventListener("click", (e) => {
      const tool   = e.target.closest(".wb-tool");
      const swatch = e.target.closest(".wb-swatch");
      if (tool) {
        const t = tool.dataset.tool;
        if (t === "clear") { clearBoard(); return; }
        // Toggle: tapping the active eraser returns to pen. Pen is the
        // default/resting state — tapping pen while on pen is a no-op
        // (still pen). Tapping eraser while on pen activates eraser.
        // Tapping eraser while on eraser returns to pen (toggle off).
        if (_state.tool === t && t === "eraser") {
          _state.tool = "pen";
        } else {
          _state.tool = t;
        }
        _rightRail.querySelectorAll(".wb-tool").forEach((b) => {
          b.classList.toggle("active",
            b.dataset.tool === _state.tool && b.dataset.tool !== "clear");
        });
        return;
      }
      if (swatch) {
        const c = swatch.dataset.color;
        _state.color = COLOR_HEX[c] || COLOR_HEX.black;
        _rightRail.querySelectorAll(".wb-swatch").forEach((b) => {
          b.classList.toggle("active", b === swatch);
        });
        return;
      }
    });
    const slider = _rightRail.querySelector(".wb-slider");
    slider.addEventListener("input", () => {
      _state.size = parseInt(slider.value, 10) || 3;
    });
    _rightRail.querySelectorAll(".wb-tray-dot").forEach((dot) => {
      dot.addEventListener("pointerdown", (e) => onTrayPointerDown(e, dot.dataset.tray));
    });
  }

  function clearBoard() {
    _state.strokes.length = 0;
    _state.markers.length = 0;
    while (_strokeLayer.firstChild) _strokeLayer.removeChild(_strokeLayer.firstChild);
    while (_markerLayer.firstChild) _markerLayer.removeChild(_markerLayer.firstChild);
  }

  // ── Coord math ──────────────────────────────────────────────────
  function clientToSVG(clientX, clientY) {
    const ctm = _svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const pt = _svg.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // ── Marker tray → drag spawn ────────────────────────────────────
  function onTrayPointerDown(e, color) {
    e.preventDefault();
    const p = clientToSVG(e.clientX, e.clientY);
    const m = { id: uid(), color, x: clamp(p.x, 0, RINK_W), y: clamp(p.y, 0, RINK_H) };
    _state.markers.push(m);
    m.el = renderMarker(m);
    _dragMarker = { marker: m };
    document.addEventListener("pointermove", onDragMove);
    document.addEventListener("pointerup",   onDragUp, { once: true });
  }

  function onMarkerPointerDown(e, m) {
    e.preventDefault();
    e.stopPropagation();
    _dragMarker = { marker: m };
    m.el.classList.add("dragging");
    document.addEventListener("pointermove", onDragMove);
    document.addEventListener("pointerup",   onDragUp, { once: true });
  }

  function onDragMove(e) {
    if (!_dragMarker) return;
    const p = clientToSVG(e.clientX, e.clientY);
    const m = _dragMarker.marker;
    m.x = p.x; m.y = p.y;
    m.el.setAttribute("transform", `translate(${m.x}, ${m.y})`);
  }

  function onDragUp() {
    document.removeEventListener("pointermove", onDragMove);
    if (!_dragMarker) return;
    const m = _dragMarker.marker;
    m.el.classList.remove("dragging");
    // Drop outside rink = remove (drag-to-trash gesture).
    if (m.x < -MARKER_R || m.x > RINK_W + MARKER_R ||
        m.y < -MARKER_R || m.y > RINK_H + MARKER_R) {
      _state.markers = _state.markers.filter((x) => x.id !== m.id);
      if (m.el && m.el.parentNode) m.el.parentNode.removeChild(m.el);
    }
    _dragMarker = null;
  }

  function cancelDragging() {
    document.removeEventListener("pointermove", onDragMove);
    if (_dragMarker && _dragMarker.marker.el) _dragMarker.marker.el.classList.remove("dragging");
    _dragMarker = null;
  }

  function renderMarker(m) {
    const g = document.createElementNS(SVGNS, "g");
    g.setAttribute("class", "wb-marker");
    g.setAttribute("transform", `translate(${m.x}, ${m.y})`);
    const circle = document.createElementNS(SVGNS, "circle");
    circle.setAttribute("r", String(MARKER_R));
    circle.setAttribute("fill", m.color === "red" ? "#c8262b" : "#1f5fc4");
    circle.setAttribute("stroke", "#fff");
    circle.setAttribute("stroke-width", "2");
    g.appendChild(circle);
    _markerLayer.appendChild(g);
    g.addEventListener("pointerdown", (e) => onMarkerPointerDown(e, m));
    return g;
  }

  // ── Pen / eraser on SVG ─────────────────────────────────────────
  function bindRinkHandlers() {
    _svg.addEventListener("pointerdown", onSvgPointerDown);
  }

  function onSvgPointerDown(e) {
    if (_dragMarker) return;
    if (e.target.closest(".wb-marker")) return;   // marker drag wins
    // Take EXPLICIT pointer capture on the SVG itself. Without this,
    // the browser implicitly captures the touch to whatever element
    // pointerdown landed on (often a <path> stroke in eraser mode).
    // When eraseAt removes that <path> from DOM, iPad Safari can leave
    // the implicit-capture in a "lost track" state that silently blocks
    // the NEXT pointerdown on the SVG — symptom: pen draws nothing
    // after a single eraser action. Capturing to the SVG itself keeps
    // the touch session anchored to a node that never gets removed.
    if (e.pointerId != null && _svg.setPointerCapture) {
      try { _svg.setPointerCapture(e.pointerId); } catch (_) {}
    }
    if (_state.tool === "eraser") { eraseAt(e); return; }
    if (_state.tool === "pen")    { startStroke(e); return; }
  }

  function startStroke(e) {
    e.preventDefault();
    const p = clientToSVG(e.clientX, e.clientY);
    const stroke = {
      id: uid(),
      color: _state.color,
      size: _state.size,
      points: [p],
      // Pin this stroke to the originating finger. onStrokeMove /
      // onStrokeUp / onStrokeCancel reject events from any other
      // pointerId so a second finger touching the rink can't inject
      // points into this stroke (the "refracted ray" bug).
      pointerId: e.pointerId,
    };
    _state.strokes.push(stroke);
    const path = document.createElementNS(SVGNS, "path");
    path.setAttribute("class", "wb-stroke");
    path.setAttribute("stroke", stroke.color);
    path.setAttribute("stroke-width", String(stroke.size));
    path.setAttribute("d", `M ${p.x} ${p.y}`);
    path.dataset.id = stroke.id;
    _strokeLayer.appendChild(path);
    stroke.el = path;
    _drawing = stroke;
    // No `{ once: true }` — we need to filter by pointerId, and an
    // early-return on wrong pointerId would consume a once-listener,
    // leaving the real pointerup unhandled. Manual removal in endStroke.
    document.addEventListener("pointermove",   onStrokeMove);
    document.addEventListener("pointerup",     onStrokeUp);
    document.addEventListener("pointercancel", onStrokeCancel);
  }

  function onStrokeMove(e) {
    if (!_drawing) return;
    if (_drawing.pointerId != null && e.pointerId !== _drawing.pointerId) return;
    const p = clientToSVG(e.clientX, e.clientY);
    _drawing.points.push(p);
    _drawing.el.setAttribute("d", smoothPath(_drawing.points));
  }

  function onStrokeUp(e) {
    if (!_drawing) return;
    if (_drawing.pointerId != null && e.pointerId !== _drawing.pointerId) return;
    // Final smoothing pass on lift: one iteration of Chaikin densifies the
    // polyline and rounds visible corners, especially noticeable on slow
    // drawing where pointer samples cluster.
    if (_drawing.points.length >= 3) {
      _drawing.points = chaikinSmooth(_drawing.points);
      _drawing.el.setAttribute("d", smoothPath(_drawing.points));
    }
    endStroke();
  }

  // iOS sends pointercancel on palm rejection, app switch, low-memory
  // interrupts, and certain system gestures. Without a handler, _drawing
  // stayed set and onStrokeMove stayed registered — the next touch fed
  // points into the orphaned stroke, painting a "refracted ray" from
  // the old stroke's last point to the new touch's location.
  function onStrokeCancel(e) {
    if (!_drawing) return;
    if (_drawing.pointerId != null && e.pointerId !== _drawing.pointerId) return;
    endStroke();
  }

  function endStroke() {
    document.removeEventListener("pointermove",   onStrokeMove);
    document.removeEventListener("pointerup",     onStrokeUp);
    document.removeEventListener("pointercancel", onStrokeCancel);
    _drawing = null;
  }

  function cancelDrawing() { endStroke(); }

  // Chaikin corner-cutting smoothing. One iteration replaces each interior
  // segment with two new points at 25% and 75% along it — doubles point
  // count and rounds sharp transitions. Endpoints preserved so the stroke
  // still starts/ends where the user lifted.
  function chaikinSmooth(points) {
    if (points.length < 3) return points;
    const out = [points[0]];
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];
      out.push({
        x: 0.75 * p0.x + 0.25 * p1.x,
        y: 0.75 * p0.y + 0.25 * p1.y
      });
      out.push({
        x: 0.25 * p0.x + 0.75 * p1.x,
        y: 0.25 * p0.y + 0.75 * p1.y
      });
    }
    out.push(points[points.length - 1]);
    return out;
  }

  // Midpoint quadratic Bézier smoothing. For ≥3 points, each interior
  // point becomes a control point and the curve passes through midpoints
  // of adjacent segments. Final segment is a straight line so the stroke
  // terminates exactly where the pointer lifted.
  function smoothPath(points) {
    if (points.length < 2) {
      return points.length === 1 ? `M ${points[0].x} ${points[0].y}` : "";
    }
    if (points.length === 2) {
      return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
    }
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length - 1; i++) {
      const xc = (points[i].x + points[i + 1].x) / 2;
      const yc = (points[i].y + points[i + 1].y) / 2;
      d += ` Q ${points[i].x} ${points[i].y} ${xc} ${yc}`;
    }
    const last = points[points.length - 1];
    d += ` L ${last.x} ${last.y}`;
    return d;
  }

  // Proximity-based stroke hit-test. The original DOM-target test
  // (e.target.closest('.wb-stroke')) failed for finger taps because
  // an iPad finger contact patch (~30px) is wider than the stroke
  // (~3-12px). User would tap "on" a stroke but the underlying ice
  // rect caught the event. Now we translate tap to SVG coords, then
  // scan all strokes' polylines for closest segment within tolerance.
  function eraseAt(e) {
    e.preventDefault();
    const p = clientToSVG(e.clientX, e.clientY);
    let bestId = null;
    let bestDist = Infinity;
    for (const s of _state.strokes) {
      const tol = Math.max((s.size || 3) + 8, 12);
      const d = strokeDistance(p, s.points);
      if (d < tol && d < bestDist) {
        bestDist = d;
        bestId = s.id;
      }
    }
    if (bestId == null) return;
    const path = _strokeLayer.querySelector(`[data-id="${bestId}"]`);
    _state.strokes = _state.strokes.filter((s) => s.id !== bestId);
    if (path && path.parentNode) path.parentNode.removeChild(path);
  }

  // Minimum distance from point p to any segment of the polyline pts.
  function strokeDistance(p, pts) {
    if (!pts || pts.length === 0) return Infinity;
    if (pts.length === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y);
    let min = Infinity;
    for (let i = 1; i < pts.length; i++) {
      const d = pointToSegment(p, pts[i - 1], pts[i]);
      if (d < min) min = d;
    }
    return min;
  }

  function pointToSegment(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const cx = a.x + t * dx, cy = a.y + t * dy;
    return Math.hypot(p.x - cx, p.y - cy);
  }
})();
