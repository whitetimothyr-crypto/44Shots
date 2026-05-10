// js/feed.js — Feed tab module (stub).
//
// Stub for PR 1: renders a "Coming soon" placeholder. Real build next
// sprint will host the parent-facing game feed (live updates from
// scorers, photo/video posts, milestone events).
// Implements the tab module interface documented in js/nav.js.

(function () {
  "use strict";

  window.FelixFeed = {
    label: "Feed",
    icon: '<svg viewBox="0 0 24 24"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>',

    init(root) {
      root.innerHTML = `
        <div class="stub-panel">
          <h2>Feed</h2>
          <p>Live game feed lands next sprint. Parents follow along: scorer updates, photos, milestone events as they happen.</p>
        </div>`;
    },

    onActivate() {},
    onDeactivate() {},
  };
})();
