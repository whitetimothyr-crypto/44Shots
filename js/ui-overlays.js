// js/ui-overlays.js - 44 Shots help / coachmark overlay
//
// Pulled from index.html inline <script> (originally lines 6454-6557,
// post-Step-3d at 5180-5283). IIFE-wrapped exactly as it was inline -- it
// is a pure DOM consumer (reads helpOverlay, helpRings, helpTips, helpStep,
// helpPrev, helpNext, helpClose, helpBtn, helpBtnUtil, whatsNewBackdrop),
// installs window.resize + click listeners, no main-block dependencies.
// Loads after the helpOverlay div is parsed and after the main inline
// script so all referenced IDs exist.

(function(){
  // Coachmark steps per tab. Each step: { sel: CSS selector, title, body }
  const STEPS = {
    rink: [
      { sel: "#newGameBtnTop", title: "New Game", body: "Tap to start a fresh game. You'll set opponent, date, your goalie, and home/away." },
      { sel: "#weAreSeg", title: "Home or Away", body: "Tells the app which end your goalie defends each period. Auto-flips for P1/P2/P3." },
      { sel: "#changeGoalieBtn", title: "Change Goalie", body: "Mid-game goalie swap. Stats split per goalie automatically in the report." },
      { sel: "#gameStateSeg", title: "Game State", body: "5v5, Power Play, Penalty Kill. Tag every shot's situation for sharper stats." },
      { sel: ".lsBtn[data-action='rebound']", title: "Rebound Mode", body: "Tap REB after a save. Rink pulses red. Next tap = rebound shot, linked to the original. Auto-disarms in 10s." },
      { sel: "#rinkSvg", title: "Tap to Log", body: "Tap anywhere on the rink to log a shot at that spot. Apple Pencil for precision. Confirm FOR/AGAINST in the prompt." }
    ],
    net: [
      { sel: "#netSvg", title: "Where the Goal Went In", body: "9-zone grid — tap where the puck beat the goalie. Glove/Center/Blocker × High/Mid/Low." }
    ],
    stats: [
      { sel: "nav.bottom-nav", title: "Stats Tabs", body: "Goalie, Our Team, Opponent. All live and split by period." }
    ],
    report: [
      { sel: "#oppInput", title: "Auto-Filled", body: "Opponent + score auto-populate from your game data. Edit if needed." },
      { sel: "#genReportBtn", title: "Generate Report", body: "Builds a full game report with drill recommendations based on what happened." }
    ]
  };

  let currentSteps = [];
  let stepIdx = 0;

  function showStep(i){
    const overlay = document.getElementById("helpOverlay");
    const rings = document.getElementById("helpRings");
    const tips = document.getElementById("helpTips");
    rings.innerHTML = "";
    tips.innerHTML = "";
    if(i < 0 || i >= currentSteps.length){ closeHelp(); return; }
    stepIdx = i;
    const step = currentSteps[i];
    const el = document.querySelector(step.sel);
    if(!el){ // skip missing
      if(i+1 < currentSteps.length) return showStep(i+1);
      return closeHelp();
    }
    const r = el.getBoundingClientRect();
    // Ring around element
    const ring = document.createElement("div");
    ring.className = "coach-ring";
    ring.style.left = (r.left - 6) + "px";
    ring.style.top = (r.top - 6) + "px";
    ring.style.width = (r.width + 12) + "px";
    ring.style.height = (r.height + 12) + "px";
    rings.appendChild(ring);
    // Tip placement: below if room, else above
    const tip = document.createElement("div");
    tip.className = "coach-tip";
    tip.innerHTML = "<b>"+step.title+"</b>"+step.body;
    tips.appendChild(tip);
    const tipRect = tip.getBoundingClientRect();
    let tipLeft = Math.max(12, Math.min(window.innerWidth - tipRect.width - 12, r.left));
    let tipTop;
    if(r.bottom + tipRect.height + 80 < window.innerHeight){
      tipTop = r.bottom + 14;
    } else {
      tipTop = Math.max(12, r.top - tipRect.height - 14);
    }
    tip.style.left = tipLeft + "px";
    tip.style.top = tipTop + "px";
    document.getElementById("helpStep").textContent = (i+1)+" / "+currentSteps.length;
    document.getElementById("helpPrev").style.visibility = i===0 ? "hidden" : "visible";
    document.getElementById("helpNext").textContent = (i===currentSteps.length-1) ? "Done" : "Next ›";
  }

  function openHelp(){
    // Determine current tab
    const activeTab = document.querySelector("nav.bottom-nav button.active");
    const tab = activeTab ? activeTab.dataset.tab : "rink";
    currentSteps = STEPS[tab] || STEPS.rink;
    stepIdx = 0;
    document.getElementById("helpOverlay").classList.add("active");
    showStep(0);
  }
  function closeHelp(){
    document.getElementById("helpOverlay").classList.remove("active");
  }
  document.getElementById("helpBtn").addEventListener("click", ()=>{ document.getElementById("whatsNewBackdrop").classList.add("active"); });

  // Overflow menu IIFE removed — three-dot trigger deleted in game-day
  // refactor. Items now live in the Settings modal's Game & App Tools
  // section; their existing event handlers bind by id and continue to work.

  const _helpUtil = document.getElementById("helpBtnUtil");
  if(_helpUtil) _helpUtil.addEventListener("click", openHelp);
  document.getElementById("helpClose").addEventListener("click", closeHelp);
  document.getElementById("helpPrev").addEventListener("click", ()=>showStep(stepIdx-1));
  document.getElementById("helpNext").addEventListener("click", ()=>{
    if(stepIdx === currentSteps.length-1) closeHelp();
    else showStep(stepIdx+1);
  });
  // Tap outside tip = close
  document.getElementById("helpOverlay").addEventListener("click", e=>{
    if(e.target.id === "helpOverlay") closeHelp();
  });
  // Reposition on resize/scroll
  window.addEventListener("resize", ()=>{ if(document.getElementById("helpOverlay").classList.contains("active")) showStep(stepIdx); });
})();
