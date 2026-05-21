// js/net-panel.js — 44 Shots Net Panel (9-zone scored-goal grid)
//
// Pulled from main inline <script> in index.html (originally lines
// 1651-1741). Wrapped in IIFE so internal helpers stay private. Public
// API is exposed on window for the few external callers that need
// typeof-guarded access from other classic <script> tags.
//
// Load order: this file loads with `defer` AFTER sync-indicator.js
// (see index.html mount near the bottom of <body>). By the time the
// IIFE runs:
//   - DOM elements #netSvg, #netMarkers, #netZoneLabels are parsed.
//   - state (from game-engine.js) is initialized in shared script-scope.
//   - svgPoint, save, toast, switchTab, triggerCenterFaceoff are
//     defined in inline shared script-scope.
//
// Dependencies (resolved via classic-script-shared-scope):
//   state                  - js/game-engine.js
//   svgPoint, toast,
//   switchTab, save        - index.html inline
//   triggerCenterFaceoff   - index.html inline (typeof-guarded)
//
// Public API (window):
//   window.drawNetMarker        - used by index.html redrawAll() and
//                                 js/game-engine.js:redrawNetForView()
//                                 (both typeof-guarded on the JS side)
//   window.renderNetZoneLabels  - used by index.html goalie-change /
//                                 game-start hooks (all typeof-guarded)
//
// Private to IIFE: zoneOf, handleNetTap, netLastHandled.

(function () {
  const netSvg = document.getElementById("netSvg");
  const netG = document.getElementById("netMarkers");
  if (!netSvg) return;

  function renderNetZoneLabels(){
    const labelsG = document.getElementById("netZoneLabels");
    if(labelsG) labelsG.innerHTML = "";
  }

  function zoneOf(x,y){
    // Net frame is x:80-520, y:60-340 (width 440, height 280)
    if(x<80||x>520||y<60||y>340) return null;
    // 3x3 grid: divide into thirds
    const xL = 80, xR = 520, yT = 60, yB = 340;
    const xCol1 = xL + (xR-xL)/3;     // ~226.67
    const xCol2 = xL + 2*(xR-xL)/3;   // ~373.33
    const yRow1 = yT + (yB-yT)/3;     // ~153.33
    const yRow2 = yT + 2*(yB-yT)/3;   // ~246.67

    // Determine vertical band: high / mid / low
    let vert;
    if(y < yRow1) vert = "high";
    else if(y < yRow2) vert = "mid";
    else vert = "low";

    // Determine horizontal band
    let col;
    if(x < xCol1) col = "left";
    else if(x < xCol2) col = "center";
    else col = "right";

    // Handedness: regular goalie = catches with left hand = glove on goalie's left,
    // which is the SHOOTER's RIGHT side of the net (right column on screen).
    // Full right = glove on goalie's right = shooter's LEFT (left column on screen).
    const hand = (state.activeGoalie && state.activeGoalie.hand) || (state.gameInfo && state.gameInfo.goalieHandedness) || "left";
    const isFullRight = hand === "right";

    let side;
    if(col === "center"){
      // Center column - special labels
      if(vert === "low") return "Five hole";
      if(vert === "mid") return "Center mid";
      return "High center";
    }
    if(isFullRight){
      side = (col === "left") ? "Glove" : "Blocker";
    } else {
      side = (col === "left") ? "Blocker" : "Glove";
    }
    return side+" "+vert;
  }

  let netLastHandled = 0;
  function handleNetTap(evt){
    const now = Date.now();
    if(now - netLastHandled < 250) return;
    netLastHandled = now;
    const p = svgPoint(netSvg, evt);
    const z = zoneOf(p.x,p.y); if(!z) return;
    // Tag this net event with the team the most recent goal belonged to
    const team = state.pendingNetGoalTeam || "against";
    const ev = { x:p.x, y:p.y, zone:z, period:state.period, weAre:state.weAre, forOrAgainst:team, t:now };
    state.netEvents.push(ev);
    drawNetMarker(ev,true); save();
    state.pendingNetGoalTeam = null; // clear after use
    save();
    toast(z.toUpperCase()+" · "+(team==="for"?"OUR GOAL":"AGAINST "+((state.activeGoalie&&state.activeGoalie.name)||"GOALIE").toUpperCase()));
    setTimeout(()=>{
      switchTab("rink");
      // Every goal is followed by a center-ice draw
      setTimeout(()=>{
        if(typeof triggerCenterFaceoff === "function"){
          triggerCenterFaceoff("Post-goal faceoff");
        }
      }, 350);
    }, 600);
  }

  function drawNetMarker(ev, animate){
    const c = document.createElementNS("http://www.w3.org/2000/svg","circle");
    c.setAttribute("cx",ev.x); c.setAttribute("cy",ev.y);
    c.setAttribute("r",12);
    // Goals are gold for both teams; outline shows which team scored
    const isFor = ev.forOrAgainst === "for";
    const weAreHome = (ev.weAre || state.weAre) === "home";
    const isHomeTeamGoal = (weAreHome && isFor) || (!weAreHome && !isFor);
    c.setAttribute("fill", "var(--gold)");
    c.setAttribute("stroke", isHomeTeamGoal ? "var(--home)" : "var(--away)");
    c.setAttribute("stroke-width","3");
    c.setAttribute("class","marker"+(animate?" pulse":""));
    netG.appendChild(c);
  }

  netSvg.addEventListener("pointerdown", handleNetTap);
  netSvg.addEventListener("click", handleNetTap);
  renderNetZoneLabels();

  window.drawNetMarker = drawNetMarker;
  window.renderNetZoneLabels = renderNetZoneLabels;
})();
