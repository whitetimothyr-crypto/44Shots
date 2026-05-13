// js/input-controller.js - 44 Shots Apple Pencil input-mode toggle
//
// Pulled from index.html inline <script> (originally lines 6596-6652,
// post-Step-3d at 5298-5354). IIFE-wrapped exactly as it was inline.
//
// Two responsibilities:
//   1. Toggle body.input-mode-pen via the #inputModeBtn button. Persists
//      to localStorage under "felix.inputMode". Bumps tap targets to
//      60x60 in pen mode (via CSS rule already in css/app.css).
//   2. Pointer safety net for Apple Pencil only -- if palm rejection
//      drops the natural click after pointerup, dispatch a synthetic
//      click within 250ms. A capturing click listener cancels the
//      fallback when the natural click does land (avoids double-fire).
//
// Pure DOM consumer; no main-block dependencies. Loads after main inline
// so #inputModeBtn / #penIndicator exist.

(function () {
  const KEY = "felix.inputMode";
  const FINGER = "finger";
  const PEN = "pen";

  function getMode() { try { return localStorage.getItem(KEY) || FINGER; } catch (_) { return FINGER; } }
  function setMode(v) { try { localStorage.setItem(KEY, v); } catch (_) {} }

  function apply(mode) {
    const indicator = document.getElementById("penIndicator");
    const btn = document.getElementById("inputModeBtn");
    if (mode === PEN) {
      document.body.classList.add("input-mode-pen");
      if (indicator) indicator.style.display = "inline";
      if (btn) btn.textContent = "✎ Input: Apple Pencil";
    } else {
      document.body.classList.remove("input-mode-pen");
      if (indicator) indicator.style.display = "none";
      if (btn) btn.textContent = "✎ Input: Finger";
    }
  }

  function toggle() {
    const next = getMode() === PEN ? FINGER : PEN;
    setMode(next);
    apply(next);
  }

  apply(getMode());
  const btn = document.getElementById("inputModeBtn");
  if (btn) btn.addEventListener("click", toggle);

  // Pointer safety net for Apple Pencil only. Body-level capture so it
  // catches taps on any button-like surface without per-button wiring.
  let pending = null;
  document.addEventListener("pointerup", (e) => {
    if (getMode() !== PEN) return;
    if (e.pointerType !== "pen") return;
    const target = e.target.closest("button, [role='button'], .lsBtn, a");
    if (!target || target.disabled) return;
    pending = { target, fired: false };
    const captured = pending;
    setTimeout(() => {
      if (!captured.fired) {
        captured.fired = true;
        try { captured.target.click(); } catch (_) {}
      }
      if (pending === captured) pending = null;
    }, 250);
  }, true);
  document.addEventListener("click", () => {
    // Natural click landed — cancel the pending synthetic.
    if (pending) pending.fired = true;
  }, true);
})();
