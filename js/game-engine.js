// js/game-engine.js - 44 Shots game-state plumbing
//
// Pulled from main inline <script> in index.html (originally regions
// 1000-1091 and 1173-1390 post-Step-3b). Top-level classic script -- no
// IIFE wrapper -- so internal declarations are shared script-scope with
// settings-engine.js (loads before this) and the main inline + shot-
// logic.js (loads after this).
//
// Load order constraint: this file loads BEFORE the main inline block,
// so its top-level statements only touch (a) DOM elements already parsed
// above the script tags, (b) functions hoisted within this file, and
// (c) callbacks scheduled via setTimeout / addEventListener whose body
// executes lazily after every script has loaded.
//
// Exports via script-scope:
//   STORAGE_KEY, NUM_KEY (NUM_KEY is jersey-related; moved here
//     incidentally because it sits between STORAGE_KEY and state init)
//   state (the central app state; let, mutable -- backup recovery and
//     period handlers reassign or mutate it)
//   load(), save() (state persistence; save() also mirrors events into
//     NomosSync if a mesh game is active, then calls renderStats() which
//     remains in main inline -- lazy resolution)
//   bindSeg, syncGlobalPeriodUI, getRinkViewEvents, getViewedNetEvents,
//   redrawMarkersForView, redrawNetForView, redrawMarkersForPeriod,
//   getOurDefendingSide, getTheirDefendingSide,
//   applyGameStateHighlight, setGameState, updateGameStateHint,
//   updateGoalieMarkers, applyRinkRotation, syncSegs

const STORAGE_KEY = "felix-shot-tracker-v1";
const NUM_KEY = "felix-jersey-num";

// State
let state = load() || { events:[], netEvents:[], result:"shot", period:1 };
// ALWAYS start in P1 on app open. Don't trust persisted period.
state.period = state.period || 1;
if(!state.period || state.period < 1 || state.period > 4) state.period = 1;
// Source of truth: which team are WE
if(!state.weAre) state.weAre = "home"; // "home" or "away"
// Game state for current shot logging (5v5, PP, PK)
if(!state.gameState) state.gameState = "5v5";
if(!state.gameStateExpiresAt) state.gameStateExpiresAt = null;
// Rink rotation for viewpoint (0 or 180)
if(typeof state.rinkRotation !== "number") state.rinkRotation = 0;
// Game info (set via Load Game screen)
if(!state.gameInfo){
  state.gameInfo = {
    ourTeam: "Phantoms",
    opponent: "",
    date: new Date().toISOString().slice(0,10),
    goalieHandedness: "left", // "left" = catches with left (glove on left as you face them); "right" = full right
    configured: false
  };
}
// Goalies array — list of goalies who played this game with start/end events
if(!state.goalies) state.goalies = [];
// Active (current) goalie — name, number, startedAt timestamp
if(!state.activeGoalie) state.activeGoalie = null;
// Rebound armed mode (transient, not persisted across reload)
state.armedForRebound = false;
state.lastShotIdForRebound = null;
state.armTimer = null;

// Page-load hydration guard helper. A persisted state with
// status='completed' (or 'finalized') is the residue of an End Game
// flow whose inner-setTimeout reset never ran -- typically because the
// browser was closed in the ~250ms window between the status stamp
// (index.html endGame, set during B2 sub-commit) and the field-clear
// reset that follows. Hydrating it would resurrect every marker /
// netEvent of the just-finalized game.
function _isFinalizedSnapshot(s){
  return !!(s && (s.status === "completed" || s.status === "finalized"));
}
function load(){
  try{
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if(_isFinalizedSnapshot(parsed)) return null;
    return parsed;
  }catch(e){ return null; }
}
function save(){
  try{
    const json = JSON.stringify(state);
    localStorage.setItem(STORAGE_KEY, json);
    // Auto-backup in localStorage (silent, no download interruption)
    const stamp = new Date().toISOString();
    localStorage.setItem("felix-backup-latest", json);
    localStorage.setItem("felix-backup-stamp", stamp);
  }catch(e){}
  // Mesh sync: mirror every event into NomosSync's offline-first queue.
  // Idempotent — recordEvent dedupes by client_id and only re-marks an
  // event pending if its payload changed since last record. No-op when
  // no mesh game is active. Wrapped to ensure sync never breaks save().
  try {
    if (typeof NomosSync !== "undefined" && typeof FelixGame !== "undefined") {
      const _g = FelixGame.getActiveGame();
      if (_g && _g.id) {
        const _ctx = { game_id: _g.id };
        const _push = (ev) => {
          if (!ev) return;
          const id = NomosSync.recordEvent(
            ev,
            ev._client_id ? Object.assign({}, _ctx, { client_id: ev._client_id }) : _ctx
          );
          if (id && !ev._client_id) ev._client_id = id;
        };
        (state.events || []).forEach(_push);
        (state.netEvents || []).forEach(_push);
        (state.faceoffs || []).forEach(_push);
      }
    }
  } catch(_) {}
  renderStats();
}

// Recovery: if main state is empty but backup exists, offer it
if((!state.events||state.events.length===0) && (!state.netEvents||state.netEvents.length===0)){
  try{
    const backup = localStorage.getItem("felix-backup-latest");
    const stamp = localStorage.getItem("felix-backup-stamp");
    if(backup){
      const parsed = JSON.parse(backup);
      // Same guard as load(): a backup snapshotted after the End Game
      // status stamp but before the inner-setTimeout reset is residue
      // from an aborted close. Drop it so we don't prompt this launch
      // OR the next.
      if(_isFinalizedSnapshot(parsed)){
        try{
          localStorage.removeItem("felix-backup-latest");
          localStorage.removeItem("felix-backup-stamp");
        }catch(_){}
      } else if((parsed.events&&parsed.events.length) || (parsed.netEvents&&parsed.netEvents.length)){
        setTimeout(()=>{
          // Re-check that state is still empty — the user may have started tapping
          // during the 500ms delay; accepting recovery would clobber their work.
          const stillEmpty = (!state.events||state.events.length===0) && (!state.netEvents||state.netEvents.length===0);
          if(!stillEmpty) return;
          if(confirm("Recover backup from "+new Date(stamp).toLocaleString()+"?\n"+(parsed.events?.length||0)+" events, "+(parsed.netEvents?.length||0)+" goal zones")){
            state = parsed;
            save(); redrawAll(); syncSegs();
          }
        }, 500);
      }
    }
  }catch(e){}
}

// Segmented controls
function bindSeg(id, key, cast){
  const el = document.getElementById(id);
  el.addEventListener("click", e=>{
    const b = e.target.closest("button"); if(!b) return;
    [...el.querySelectorAll("button")].forEach(x=>x.classList.remove("on"));
    b.classList.add("on");
    state[key] = cast(b.dataset[key]);
    save();
  });
}
bindSeg("periodSeg","period", v=>{
  const newPeriod = parseInt(v,10);
  setTimeout(()=>{
    // Clear visible markers — teams switched ends, fresh canvas for this period
    // (Data is preserved in state.events; we just hide markers from prior periods)
    redrawMarkersForPeriod(newPeriod);
    updateGoalieMarkers();
    lastEventIndex = -1;
    updateLastShotBar();
  }, 10);
  return newPeriod;
});

// Wire the visible global period selector. It's the user-facing control
// for the active LOGGING period only. Live tabs (Rink/Net/Stats/header) are
// always cumulative; per-tab view filters are owned by the individual tabs.
// The legacy hidden #periodSeg is kept only so older bindings don't crash.
const periodSegGlobal = document.getElementById("periodSegGlobal");

function syncGlobalPeriodUI(){
  const v = state.period;
  [...periodSegGlobal.querySelectorAll("button")].forEach(b=>{
    b.classList.toggle("on", parseInt(b.dataset.period,10) === v);
  });
}
if(periodSegGlobal){
  periodSegGlobal.addEventListener("click", e=>{
    const b = e.target.closest("button"); if(!b) return;
    const newPeriod = parseInt(b.dataset.period, 10);
    if(!newPeriod) return;
    const oldPeriod = state.period;
    if(newPeriod === oldPeriod) return;
    if(typeof exitFaceoffMode === "function") exitFaceoffMode();

    let hadMiniReport = false;
    if(oldPeriod && state.events.some(ev => ev.period === oldPeriod)){
      showPeriodMiniReport(oldPeriod, ()=>{
        if(typeof triggerCenterFaceoff === "function"){
          triggerCenterFaceoff("Period " + (newPeriod === 4 ? "OT" : newPeriod) + " · faceoff");
        }
      });
      hadMiniReport = true;
    }
    state.period = newPeriod;
    syncGlobalPeriodUI();
    if(typeof redrawMarkersForView === "function") redrawMarkersForView();
    else redrawMarkersForPeriod(newPeriod);
    if(typeof redrawNetForView === "function") redrawNetForView();
    if(typeof renderStats === "function") renderStats();
    updateGoalieMarkers();
    lastEventIndex = -1;
    updateLastShotBar();
    save();
    if(!hadMiniReport && typeof triggerCenterFaceoff === "function"){
      setTimeout(()=>{
        triggerCenterFaceoff("Period " + (newPeriod === 4 ? "OT" : newPeriod) + " · faceoff");
      }, 600);
    }
  });
  syncGlobalPeriodUI();
}

function getRinkViewEvents(){ return state.events.filter(ev => ev.period === state.period); }
function getViewedNetEvents(){ return state.netEvents.slice(); }
function redrawMarkersForView(){
  const mg = document.getElementById("markers");
  if(!mg) return;
  mg.innerHTML = "";
  getRinkViewEvents().forEach(ev => drawMarker(ev, false));
}
function redrawNetForView(){
  const ng = document.getElementById("netMarkers");
  if(!ng) return;
  ng.innerHTML = "";
  getViewedNetEvents().forEach(ev => { if(typeof drawNetMarker === "function") drawNetMarker(ev, false); });
}

function redrawMarkersForPeriod(period){
  const mg = document.getElementById("markers");
  if(!mg) return;
  mg.innerHTML = "";
  state.events.filter(ev => ev.period === period).forEach(ev => drawMarker(ev, false));
}

// "We" team = single source of truth.
// Hockey teams switch ends every period.
// P1: HOME defends LEFT (their bench is top-left), AWAY defends RIGHT
// P2: switch — HOME defends RIGHT, AWAY defends LEFT
// P3: same as P1
function getOurDefendingSide(period){
  // What end does OUR goalie occupy this period?
  const homeStart = "left"; // home defends left in P1
  const swap = (period === 2);
  const homeSide = swap ? "right" : "left";
  if(state.weAre === "home") return homeSide;
  return homeSide === "left" ? "right" : "left";
}
function getTheirDefendingSide(period){
  return getOurDefendingSide(period) === "left" ? "right" : "left";
}

// Wire We Are HOME / AWAY toggle
const weAreSeg = document.getElementById("weAreSeg");
if(weAreSeg){
  weAreSeg.addEventListener("click", e=>{
    const b = e.target.closest("button"); if(!b) return;
    [...weAreSeg.querySelectorAll("button")].forEach(x=>x.classList.remove("on"));
    b.classList.add("on");
    state.weAre = b.dataset.we;
    save();
    updateGoalieMarkers();
  });
  [...weAreSeg.querySelectorAll("button")].forEach(b=>b.classList.toggle("on", b.dataset.we===state.weAre));
}

// Wire game state (5v5 / PP / PK) — manual-only as of v2.1
// (auto-revert removed: a real penalty kill requires start/stop time tracking,
// which is too complex for live tap-tracking. Persistent highlight reminds
// the user to toggle back to 5v5.)
const gameStateSeg = document.getElementById("gameStateSeg");
function applyGameStateHighlight(){
  const gs = state.gameState || "5v5";
  document.body.classList.toggle("gs-pp", gs === "pp");
  document.body.classList.toggle("gs-pk", gs === "pk");
  if(gs === "pp")      document.body.setAttribute("data-gs-label", "POWER PLAY · TAP TO DESELECT");
  else if(gs === "pk") document.body.setAttribute("data-gs-label", "PENALTY KILL · TAP TO DESELECT");
  else document.body.removeAttribute("data-gs-label");
}
function setGameState(gs){
  state.gameState = gs;
  [...gameStateSeg.querySelectorAll("button")].forEach(x=>x.classList.toggle("on", x.dataset.gs===gs));
  state.gameStateExpiresAt = null; // legacy field, no longer used
  updateGameStateHint();
  applyGameStateHighlight();
  save();
}
if(gameStateSeg){
  gameStateSeg.addEventListener("click", e=>{
    const b = e.target.closest("button"); if(!b) return;
    // Guard: only PP/PK buttons (with data-gs) drive state. UndoBtn now
    // lives in #gameStateSeg too (2026-05-11) and has no data-gs — its
    // own click handler at the foot of the script wires Undo separately.
    if(!b.dataset.gs) return;
    // Toggle semantics: pressing the active mode switches to 5v5
    // (default). Pressing the inactive mode switches to it. PP and PK
    // are mutually exclusive because state.gameState only holds one
    // value, so toggling one off implicitly toggles the other off.
    const next = state.gameState === b.dataset.gs ? "5v5" : b.dataset.gs;
    setGameState(next);
  });
  // Restore active state on load
  [...gameStateSeg.querySelectorAll("button")].forEach(b=>b.classList.toggle("on", b.dataset.gs===state.gameState));
  // Clear any stale legacy auto-revert timestamp from old game data
  if(state.gameStateExpiresAt){ state.gameStateExpiresAt = null; save(); }
  applyGameStateHighlight();
}
function updateGameStateHint(){
  const hint = document.getElementById("gameStateHint");
  if(!hint) return;
  if(state.gameState === "pp")      hint.textContent = "POWER PLAY active · tap to deselect";
  else if(state.gameState === "pk") hint.textContent = "PENALTY KILL active · tap to deselect";
  else hint.textContent = "";
}

// Position H/A goalie markers based on which end each team defends this period
function updateGoalieMarkers(){
  const gL = document.getElementById("goalieLeft");
  const gR = document.getElementById("goalieRight");
  if(!gL || !gR) return;
  // Left side label: who defends left this period?
  const homeStart = "left";
  const homeDefends = (state.period === 2) ? (homeStart==="left"?"right":"left") : homeStart;
  const leftLetter = homeDefends === "left" ? "H" : "A";
  const rightLetter = homeDefends === "left" ? "A" : "H";
  gL.querySelector("text").textContent = leftLetter;
  gR.querySelector("text").textContent = rightLetter;
  // Color each goalie by their team: HOME=red, AWAY=blue
  const leftFill = leftLetter === "H" ? "var(--home)" : "var(--away)";
  const rightFill = rightLetter === "H" ? "var(--home)" : "var(--away)";
  gL.querySelector("circle").setAttribute("fill", leftFill);
  gR.querySelector("circle").setAttribute("fill", rightFill);
}

// Rink rotation
const rotateBtn = document.getElementById("rotateRinkBtn");
function applyRinkRotation(){
  const svg = document.getElementById("rinkSvg");
  if(!svg) return;
  svg.style.transform = (state.rinkRotation === 180) ? "rotate(180deg)" : "";
  svg.style.transition = "transform 0.4s ease";
}
if(rotateBtn){
  rotateBtn.addEventListener("click", ()=>{
    state.rinkRotation = (state.rinkRotation === 180) ? 0 : 180;
    save();
    applyRinkRotation();
  });
}
applyRinkRotation();
setTimeout(updateGoalieMarkers, 100);

// Restore segmented state on load
function syncSegs(){
  document.querySelectorAll("#periodSeg button").forEach(b=>b.classList.toggle("on", parseInt(b.dataset.period,10)===state.period));
  if(typeof syncGlobalPeriodUI === "function") syncGlobalPeriodUI();
}
syncSegs();
