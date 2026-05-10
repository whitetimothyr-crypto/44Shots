// js/whiteboard.js — Whiteboard tab module (stub).
//
// Stub for PR 1: renders a "Coming soon" placeholder. Real build next
// sprint will host coach diagram tools (drag/drop X/O markers on rink).
// Implements the tab module interface documented in js/nav.js.

(function () {
  "use strict";

  window.FelixWhiteboard = {
    label: "Whiteboard",
    icon: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="14" rx="1.5"/><line x1="3" y1="20" x2="21" y2="20"/><line x1="7" y1="9" x2="13" y2="9"/><line x1="7" y1="13" x2="17" y2="13"/></svg>',

    init(root) {
      root.innerHTML = `
        <div class="stub-panel">
          <h2>Whiteboard</h2>
          <p>Coach diagram tools land next sprint. Drag X/O markers on the rink, save plays, share with the team.</p>
        </div>`;
    },

    onActivate() {},
    onDeactivate() {},
  };
})();
