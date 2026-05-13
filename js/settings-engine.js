// js/settings-engine.js — 44 Shots user-preferences storage
//
// Separate localStorage key ("felix-settings-v6"); persists across game
// resets and across crowdsource submissions. Declarations are intentionally
// TOP-LEVEL (no IIFE wrapper) so SETTINGS_KEY / SETTINGS_DEFAULTS / settings /
// saveSettings are script-scope globals visible to the main inline <script>
// in index.html. Must load BEFORE that inline block. Source originally lived
// at index.html lines 1416-1434 inside the main IIFE; extracted in Step 3a.

const SETTINGS_KEY = "felix-settings-v6";
const SETTINGS_DEFAULTS = {
  reboundMode: "doubletap", // "time" | "doubletap" | "both" | "off" — double-tap is the default
  reboundWindowSec: 3,      // 1 | 2 | 3 — only used by Time mode
  seenWhatsNew: "",         // last version the user dismissed the popup for
  seenGestureHints: false   // first-launch gesture hints toast dismissed
};
let settings = (function loadSettings(){
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if(!raw) return {...SETTINGS_DEFAULTS};
    return {...SETTINGS_DEFAULTS, ...JSON.parse(raw)};
  } catch(e) { return {...SETTINGS_DEFAULTS}; }
})();
function saveSettings(){
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch(e){}
}
window.felixSettings = () => settings; // for debugging
