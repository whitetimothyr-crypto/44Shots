// js/lineup.js — Lineup tab module (PR 1 stub).
//
// PR 1 ships a placeholder. Subsequent PRs in this sprint will:
//   PR 2 — schema (migration 15: players, lineup_configs, lineup_slots)
//   PR 3 — js/lineup-api.js + player CRUD + CSV import
//   PR 4 — drag/drop with SortableJS + group/slot management
//
// Implements the tab module interface documented in js/nav.js.

(function () {
  "use strict";

  window.FelixLineup = {
    label: "Lineup",
    icon: '<svg viewBox="0 0 24 24"><circle cx="7" cy="8" r="2.5"/><circle cx="17" cy="8" r="2.5"/><circle cx="12" cy="16" r="2.5"/><line x1="9" y1="9.5" x2="11" y2="14"/><line x1="15" y1="9.5" x2="13" y2="14"/></svg>',

    init(root) {
      root.innerHTML = `
        <div class="stub-panel">
          <h2>Lineup</h2>
          <p>Roster + line-config builder lands across the next three commits this sprint. Database schema next, then player CRUD + CSV import, then drag/drop line management.</p>
        </div>`;
    },

    onActivate() {},
    onDeactivate() {},
  };
})();
