// js/shot-logic.js - 44 Shots rink tap / shot logging / marker drawing
//
// Pulled from the main inline <script> in index.html (originally regions
// 1396-1663 and 2120-2167 post-Step-3a). Top-level classic script -- no
// IIFE wrapper -- so internal declarations share script-scope with the
// main inline block. Must load AFTER the main inline <script> because
// the goalie-marker swallow handlers and the rinkSvg.addEventListener
// calls at the end of Region 1 read `rinkSvg` (declared in main inline
// at line 1393), and drawMarker reads `markersG` (declared at 1394) and
// `state` (declared at 1004).
//
// Exports via script-scope: svgPoint, findEventNearPoint, applyJitter,
// clearLongPress, handleRinkPointer{Down,Move,Up,Cancel}, handleRinkTap,
// drawMarker, faceoffMode (mutable flag, also read/written by the
// faceoff system that remains in main inline for now), plus the long-
// press state vars (lpTimer / lpStart / lpFired / lpCancelled) and the
// rebound/jitter constants.

function svgPoint(svg, evt){
  const pt = svg.createSVGPoint();
  pt.x = evt.clientX; pt.y = evt.clientY;
  const ctm = svg.getScreenCTM().inverse();
  return pt.matrixTransform(ctm);
}

// Tap the rink: defaults to Save. Persistent "Last Shot" bar at top
// lets you upgrade to Goal/Miss anytime until next tap. Tap an existing
// marker to edit/delete it.
let rinkLastHandled = 0;
let lastEventIndex = -1;
const MARKER_HIT_RADIUS = 25; // SVG units
const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_TOL = 10;       // screen px before press cancels
const DOUBLE_TAP_MS = 280;            // gap between taps to count as a double-tap gesture
const DOUBLE_TAP_MOVE_TOL = 40;       // SVG units of finger-placement variation between the two taps
const REBOUND_LINK_MAX_AGE_MS = 5000; // max age of the prior shot that a rebound can link to
const JITTER_RADIUS = 8;              // SVG units; nudge new shot if landing this close to existing
const JITTER_AMOUNT = 3;              // SVG units of nudge

function findEventNearPoint(p){
  // Search in reverse so most recent shots are found first
  for(let i=state.events.length-1; i>=0; i--){
    const ev = state.events[i];
    const dx = ev.x - p.x, dy = ev.y - p.y;
    if(Math.sqrt(dx*dx+dy*dy) <= MARKER_HIT_RADIUS) return i;
  }
  return -1;
}

// Apply jitter so a new shot doesn't sit exactly on top of another
function applyJitter(p){
  for(let i=state.events.length-1; i>=0; i--){
    const ev = state.events[i];
    if(ev.period !== state.period) continue;
    const dx = ev.x - p.x, dy = ev.y - p.y;
    if(Math.sqrt(dx*dx+dy*dy) < JITTER_RADIUS){
      // nudge perpendicular-ish using a small random angle
      const ang = Math.random()*Math.PI*2;
      return { x: p.x + Math.cos(ang)*JITTER_AMOUNT, y: p.y + Math.sin(ang)*JITTER_AMOUNT };
    }
  }
  return p;
}

// Track most recent placement for double-tap detection
let lastPlacement = { t: 0, x: 0, y: 0, idx: -1 };

// ---- Long-press state machine ----
let lpTimer = null;
let lpStart = null;       // { svgPt, clientX, clientY, pointerId, origEvt }
let lpFired = false;      // edit popover opened, suppress tap
let lpCancelled = false;  // movement exceeded tolerance

function clearLongPress(){
  if(lpTimer){ clearTimeout(lpTimer); lpTimer = null; }
  lpStart = null;
}

// Faceoff mode flag — declared early because handleRinkPointerDown checks it
let faceoffMode = false;

function handleRinkPointerDown(evt){
  // While in faceoff mode, the rink ignores normal taps; faceoff dots/picker handle their own clicks
  if(faceoffMode){ lpCancelled = true; return; }
  lpFired = false;
  lpCancelled = false;
  const p = svgPoint(rinkSvg, evt);
  if(p.x<60||p.x>940||p.y<28||p.y>397){ lpCancelled = true; return; }
  lpStart = {
    svgPt: { x: p.x, y: p.y },
    clientX: evt.clientX,
    clientY: evt.clientY,
    pointerId: evt.pointerId,
    origEvt: evt
  };
  lpTimer = setTimeout(()=>{
    lpTimer = null;
    if(!lpStart) return;
    const idx = findEventNearPoint(lpStart.svgPt);
    if(idx >= 0){
      lpFired = true;
      if(navigator.vibrate) try{ navigator.vibrate(15); }catch(e){}
      openEditPopover(idx, lpStart.clientX, lpStart.clientY);
    }
    // No marker nearby: do nothing on long-press; pointerup will not place a shot because we don't reset lpFired here, BUT we want shots to still be possible on long-hold-then-release in empty space. So we leave lpFired false and let pointerup place the shot.
  }, LONG_PRESS_MS);
}
function handleRinkPointerMove(evt){
  if(!lpStart || lpStart.pointerId !== evt.pointerId) return;
  const dx = evt.clientX - lpStart.clientX;
  const dy = evt.clientY - lpStart.clientY;
  if(Math.sqrt(dx*dx+dy*dy) > LONG_PRESS_MOVE_TOL){
    lpCancelled = true;
    clearLongPress();
  }
}
function handleRinkPointerUp(evt){
  if(lpStart && lpStart.pointerId !== evt.pointerId) return;
  const wasFired = lpFired;
  const wasCancelled = lpCancelled;
  const start = lpStart;
  clearLongPress();
  if(wasFired || wasCancelled) return;
  if(!start) return;
  handleRinkTap(start.origEvt);
}
function handleRinkPointerCancel(){
  lpCancelled = true;
  clearLongPress();
}

function handleRinkTap(evt){
  const now = Date.now();
  if(now - rinkLastHandled < 80) return; // 80ms anti-jitter, allows legitimate double-taps through
  rinkLastHandled = now;
  let p = svgPoint(rinkSvg, evt);
  if(p.x<60||p.x>940||p.y<28||p.y>397) return;

  // ---- Double-tap gesture detection (runs FIRST, before any FOR/AGAINST prompts) ----
  // The second tap of a double-tap pair does NOT place a new marker.
  // Instead it adds a rebound halo to the marker just placed by the first
  // tap of the pair, and draws a line to the shot that came before that.
  // Constraints (no exceptions):
  //   - second tap within 280ms of the first
  //   - second tap within 40 SVG units of the first
  //   - link target must attack the SAME net (no cross-ice rebounds)
  //   - link target must be within 5 seconds of the just-placed marker
  {
    const dtMode = settings.reboundMode || "doubletap";
    const dtAllowed = (dtMode === "doubletap" || dtMode === "both");
    if(dtAllowed && lastPlacement.idx >= 0 && state.events[lastPlacement.idx]){
      const justPlaced = state.events[lastPlacement.idx];
      const dt = now - lastPlacement.t;
      const dxdt = lastPlacement.x - p.x, dydt = lastPlacement.y - p.y;
      const nearSameSpot = Math.sqrt(dxdt*dxdt + dydt*dydt) <= DOUBLE_TAP_MOVE_TOL;
      if(dt <= DOUBLE_TAP_MS && nearSameSpot && justPlaced.period === state.period){
        // Find the shot before justPlaced in the same period AND same attacking net,
        // within the 5-second link window.
        let priorIdx = -1;
        for(let i = lastPlacement.idx - 1; i >= 0; i--){
          const candidate = state.events[i];
          if(candidate.period !== state.period){
            if(candidate.period < state.period) break;
            continue;
          }
          if(candidate.attackingNet !== justPlaced.attackingNet) continue;
          if(justPlaced.t - candidate.t > REBOUND_LINK_MAX_AGE_MS) break;
          priorIdx = i;
          break;
        }
        // Mutate the just-placed marker into a rebound. Do NOT place a new marker.
        if(!justPlaced.styles) justPlaced.styles = [];
        if(!justPlaced.styles.includes("rebound")) justPlaced.styles.push("rebound");
        if(priorIdx >= 0) justPlaced.linkedTo = priorIdx;
        lastPlacement = { t: 0, x: 0, y: 0, idx: -1 }; // prevent triple-tap looping
        save();
        redrawAll();
        updateLastShotBar();
        toast(priorIdx >= 0 ? "Rebound" : "Rebound (no prior shot)");
        return;
      }
    }
  }

  // Not a double-tap — proceed with normal shot placement.
  // Attribute based on which net the shot attacks (= whose defensive zone the tap is in).
  // The H/A markers on the rink show which team defends which side this period.
  // Left zone (x<370): puck attacking left net = AGAINST whoever defends left.
  // Right zone (x>630): puck attacking right net = AGAINST whoever defends right.
  // Neutral zone (370-630): ask which TEAM took the shot (by name).
  const ourSide = getOurDefendingSide(state.period);
  const ourTeamName = (state.gameInfo && state.gameInfo.ourTeam) || "Our Team";
  const oppTeamName = (state.gameInfo && state.gameInfo.opponent) || "Opponent";
  let attackingNet, forOrAgainst;
  if(p.x < 370){
    attackingNet = "left";
  } else if(p.x > 630){
    attackingNet = "right";
  } else {
    // Neutral zone — prompt with actual team names.
    // OK = our team took the shot (= attacking the net our team is NOT defending = FOR us).
    // Cancel = opponent took the shot (= attacking our net = AGAINST us).
    const choice = confirm("Neutral zone shot.\n\nWho took the shot?\n\nOK = "+ourTeamName+"\nCancel = "+oppTeamName);
    attackingNet = choice ? (ourSide === "left" ? "right" : "left") : ourSide;
    forOrAgainst = choice ? "for" : "against";
  }
  if(!forOrAgainst){
    // Puck heading toward OUR goalie's end = against us; otherwise = for us.
    forOrAgainst = (attackingNet === ourSide) ? "against" : "for";
  }

  // ---- Rebound detection: armed-mode or Time-mode only (double-tap handled above) ----
  let rebound = false;
  let linkedTo = null;

  if(state.armedForRebound && state.lastShotIdForRebound != null && state.events[state.lastShotIdForRebound]){
    // ARMED mode (REB button pressed) — always wins, links to the armed origin
    rebound = true;
    linkedTo = state.lastShotIdForRebound;
  } else {
    const mode = settings.reboundMode || "doubletap";
    const winMs = (settings.reboundWindowSec || 3) * 1000;
    const checkTime = (mode === "time" || mode === "both");
    if(checkTime){
      for(let i = state.events.length - 1; i >= 0; i--){
        const prev = state.events[i];
        if(prev.period !== state.period) break;
        if(now - prev.t > winMs) break;
        if(prev.result !== "shot") break;              // only saves seed time-rebounds
        if(prev.attackingNet !== attackingNet) break;   // no cross-ice rebounds
        rebound = true;
        linkedTo = i;
        break;
      }
    }
  }

  // Apply jitter so two same-spot taps remain visually distinct
  p = applyJitter(p);

  const ev = {
    x: p.x, y: p.y,
    result: "shot",
    styles: rebound ? ["rebound"] : [],
    linkedTo,
    period: state.period,
    attackingNet,
    forOrAgainst,
    gameState: state.gameState || "5v5",
    weAre: state.weAre,
    goalie: forOrAgainst === "against" && state.activeGoalie ? {name: state.activeGoalie.name, num: state.activeGoalie.num} : null,
    t: now
  };
  state.events.push(ev);
  lastEventIndex = state.events.length - 1;
  lastPlacement = { t: now, x: p.x, y: p.y, idx: lastEventIndex };
  // Disarm rebound mode after consuming
  if(state.armedForRebound){
    state.armedForRebound = false;
    state.lastShotIdForRebound = null;
    if(state.armTimer){ clearTimeout(state.armTimer); state.armTimer=null; }
    updateArmedUI();
  }
  drawMarker(ev, true);
  save();
  updateLastShotBar();
  redrawAll(); // redraw to show linked rebound line
  if(rebound) toast("Rebound");
}
rinkSvg.addEventListener("pointerdown", handleRinkPointerDown);
rinkSvg.addEventListener("pointermove", handleRinkPointerMove);
rinkSvg.addEventListener("pointerup", handleRinkPointerUp);
rinkSvg.addEventListener("pointercancel", handleRinkPointerCancel);
rinkSvg.addEventListener("pointerleave", handleRinkPointerCancel);

// Goalie markers (H / A circles in each crease) are display-only.
// Tapping the rink at their location should NOT register a shot;
// goalie change is on the Lineup screen. stopPropagation on
// pointerdown prevents the rink-level handler above from firing.
["goalieLeft", "goalieRight"].forEach((id) => {
  const g = document.getElementById(id);
  if (!g) return;
  const swallow = (e) => { e.stopPropagation(); };
  g.addEventListener("pointerdown", swallow);
  g.addEventListener("click", swallow);
});

function drawMarker(ev, animate){
  let mainEl;
  if(ev.result === "block"){
    // Block: small gray-blue square (defensive event, not a shot on goal)
    mainEl = document.createElementNS("http://www.w3.org/2000/svg","rect");
    const size = 11;
    mainEl.setAttribute("x", ev.x - size/2);
    mainEl.setAttribute("y", ev.y - size/2);
    mainEl.setAttribute("width", size);
    mainEl.setAttribute("height", size);
    mainEl.setAttribute("fill", "#8aa0b8");
    mainEl.setAttribute("stroke", "var(--bg)");
    mainEl.setAttribute("stroke-width", "1.5");
    mainEl.setAttribute("class", "marker"+(animate?" pulse":""));
  } else {
    const c = document.createElementNS("http://www.w3.org/2000/svg","circle");
    c.setAttribute("cx",ev.x); c.setAttribute("cy",ev.y);
    c.setAttribute("class","marker"+(animate?" pulse":""));
    if(ev.result==="goal"){ c.setAttribute("r",10); c.setAttribute("fill","var(--accent-2)"); c.setAttribute("stroke","var(--bg)"); c.setAttribute("stroke-width","2"); }
    else if(ev.result==="miss"){ c.setAttribute("r",6); c.setAttribute("fill","none"); c.setAttribute("stroke","var(--text-muted)"); c.setAttribute("stroke-width","2"); c.setAttribute("stroke-dasharray","2 3"); }
    else {
      // Save: orange = AGAINST our goalie (priority); teal = FOR (our offense)
      // Saves: HOME team = orange, AWAY team = teal
      // A shot's team identity = (we are HOME and FOR) OR (we are AWAY and AGAINST) → HOME team
      const isFor = ev.forOrAgainst === "for";
      const weAreHome = (ev.weAre || state.weAre) === "home";
      const isHomeTeamShot = (weAreHome && isFor) || (!weAreHome && !isFor);
      c.setAttribute("r", 7);
      c.setAttribute("fill", isHomeTeamShot ? "var(--home)" : "var(--away)");
      c.setAttribute("stroke","var(--bg)");
      c.setAttribute("stroke-width","1.5");
    }
    mainEl = c;
  }
  // Style indicator: thin outer ring for rebound/wrap/tip
  if(ev.styles && ev.styles.length){
    const ring = document.createElementNS("http://www.w3.org/2000/svg","circle");
    ring.setAttribute("cx",ev.x); ring.setAttribute("cy",ev.y);
    const baseR = ev.result === "block" ? 9 : parseFloat(mainEl.getAttribute("r"));
    ring.setAttribute("r", baseR + 4);
    ring.setAttribute("fill","none");
    ring.setAttribute("stroke", "var(--accent-2)");
    ring.setAttribute("stroke-width","1.5");
    ring.setAttribute("stroke-dasharray","3 2");
    markersG.appendChild(ring);
  }
  markersG.appendChild(mainEl);
}
