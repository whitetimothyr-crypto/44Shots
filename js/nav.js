// js/nav.js — bottom nav controller (44 Shots / NOMOS).
//
// ─────────────────────────────────────────────────────────────────────
// TAB MODULE INTERFACE
// ─────────────────────────────────────────────────────────────────────
// Each new tab module exports a singleton on window.Felix<Name>:
//
//   FelixWhiteboard.init(rootElement)   — one-time setup; build DOM, bind
//                                         handlers. Receives the panel
//                                         element (#panel-<id>) as root.
//   FelixWhiteboard.onActivate()        — called every time the tab
//                                         becomes active (incl. first).
//   FelixWhiteboard.onDeactivate()      — called when leaving the tab.
//   FelixWhiteboard.icon                — SVG markup for the nav button.
//   FelixWhiteboard.label               — short uppercase label.
//
// Legacy tabs (rink, stats, report) live inline in index.html and are
// registered here with `legacy: true`. nav.js renders their nav buttons
// only; panel activation is delegated to the existing switchTab() in
// index.html (now exposed on window).
//
// ─────────────────────────────────────────────────────────────────────
// CONFIG PERSISTENCE
// ─────────────────────────────────────────────────────────────────────
// User-chosen tab order persists at localStorage["felix.tabOrder"] as
// a JSON array of tab IDs. Falls back to DEFAULT_ORDER_COACH. Role
// detection (parent vs coach) is deferred — coach default ships now.
//
// ─────────────────────────────────────────────────────────────────────
// LAZY LOAD
// ─────────────────────────────────────────────────────────────────────
// Modules listed in TABS[].module() resolve a global at activation time.
// Stubs (whiteboard, feed, lineup) load eagerly via <script src=…> in
// index.html — small enough that lazy loading buys nothing. When real
// builds land and grow large, switch their <script> tags to dynamic
// imports keyed off TABS.<id>._loadOnDemand without touching this file.

(function () {
  "use strict";

  const STORAGE_KEY = "felix.tabOrder";

  // Coach/admin default order — shipped now. Parent default deferred.
  const DEFAULT_ORDER_COACH = ["rink", "whiteboard", "feed", "lineup", "more"];

  // Tab registry. `legacy: true` means panel activation is handled by
  // index.html's switchTab() (kept for now — extraction is a later PR).
  const TABS = {
    rink: {
      legacy: true,
      label: "Rink",
      icon: '<svg viewBox="0 0 24 24"><rect x="2.5" y="6" width="19" height="12" rx="6"/><line x1="12" y1="6" x2="12" y2="18"/><circle cx="12" cy="12" r="2"/></svg>',
    },
    whiteboard: {
      module: () => window.FelixWhiteboard,
      label: "Whiteboard",
      icon: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="14" rx="1.5"/><line x1="3" y1="20" x2="21" y2="20"/><line x1="7" y1="9" x2="13" y2="9"/><line x1="7" y1="13" x2="17" y2="13"/></svg>',
    },
    feed: {
      module: () => window.FelixFeed,
      label: "Feed",
      icon: '<svg viewBox="0 0 24 24"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>',
    },
    lineup: {
      module: () => window.FelixLineup,
      label: "Lineup",
      icon: '<svg viewBox="0 0 24 24"><circle cx="7" cy="8" r="2.5"/><circle cx="17" cy="8" r="2.5"/><circle cx="12" cy="16" r="2.5"/><line x1="9" y1="9.5" x2="11" y2="14"/><line x1="15" y1="9.5" x2="13" y2="14"/></svg>',
    },
    more: {
      legacy: true, // panel-more lives in index.html for PR 1
      label: "More",
      icon: '<svg viewBox="0 0 24 24"><circle cx="6" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.6" fill="currentColor" stroke="none"/></svg>',
    },
    // Off-rail tabs — addressable from MORE, not in the visible nav.
    stats: {
      legacy: true,
      label: "Stats",
      icon: '<svg viewBox="0 0 24 24"><line x1="6" y1="20" x2="6" y2="12"/><line x1="12" y1="20" x2="12" y2="6"/><line x1="18" y1="20" x2="18" y2="14"/><line x1="3" y1="20" x2="21" y2="20"/></svg>',
    },
    report: {
      legacy: true,
      label: "Report",
      icon: '<svg viewBox="0 0 24 24"><rect x="6" y="4" width="12" height="17" rx="1.5"/><rect x="9" y="2.5" width="6" height="3" rx="0.8"/><line x1="9" y1="10" x2="15" y2="10"/><line x1="9" y1="13.5" x2="15" y2="13.5"/><line x1="9" y1="17" x2="13" y2="17"/></svg>',
    },
  };

  let _prevActiveId = null;

  function getOrder() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0 && parsed.every((t) => TABS[t])) {
          return parsed;
        }
      }
    } catch (_) {}
    return DEFAULT_ORDER_COACH.slice();
  }

  function saveOrder(order) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(order)); } catch (_) {}
  }

  function activeTabId() {
    const btn = document.querySelector("nav.bottom-nav button.active");
    return btn ? btn.dataset.tab : null;
  }

  function activateModuleTab(tabId) {
    const tab = TABS[tabId];
    if (!tab || tab.legacy) return;
    let panel = document.getElementById("panel-" + tabId);
    if (!panel) {
      panel = document.createElement("section");
      panel.className = "panel";
      panel.id = "panel-" + tabId;
      const main = document.querySelector("main");
      if (main) main.appendChild(panel);
    }
    const mod = typeof tab.module === "function" ? tab.module() : null;
    if (mod && !tab._inited) {
      try { if (typeof mod.init === "function") mod.init(panel); }
      catch (e) { console.error("FelixNav init failed for " + tabId + ":", e); }
      tab._inited = true;
    }
    if (mod && typeof mod.onActivate === "function") {
      try { mod.onActivate(); } catch (e) { console.error("FelixNav onActivate " + tabId + ":", e); }
    }
  }

  function deactivateModuleTab(tabId) {
    const tab = TABS[tabId];
    if (!tab || tab.legacy) return;
    const mod = typeof tab.module === "function" ? tab.module() : null;
    if (mod && typeof mod.onDeactivate === "function") {
      try { mod.onDeactivate(); } catch (e) { console.error("FelixNav onDeactivate " + tabId + ":", e); }
    }
  }

  function render() {
    const navEl = document.querySelector("nav.bottom-nav");
    if (!navEl) return;

    const order = getOrder();
    const currentActive = activeTabId();
    const activeId = currentActive && order.includes(currentActive) ? currentActive : order[0];
    _prevActiveId = activeId;

    navEl.innerHTML = "";
    order.forEach((id) => {
      const tab = TABS[id];
      if (!tab) return;
      const btn = document.createElement("button");
      btn.dataset.tab = id;
      btn.setAttribute("aria-label", tab.label);
      btn.innerHTML = tab.icon + "\n      " + tab.label;
      if (id === activeId) btn.classList.add("active");
      navEl.appendChild(btn);
    });
  }

  // Click delegation. Bound once on document so it survives re-renders.
  // Fires AFTER index.html's existing tabs.addEventListener (which handles
  // panel activation via switchTab). Our job here is module lifecycle.
  document.addEventListener("click", (e) => {
    const navEl = document.querySelector("nav.bottom-nav");
    if (!navEl) return;
    const btn = e.target.closest("nav.bottom-nav button");
    if (!btn || !navEl.contains(btn)) return;
    const id = btn.dataset.tab;
    if (!id) return;
    if (_prevActiveId && _prevActiveId !== id) deactivateModuleTab(_prevActiveId);
    activateModuleTab(id);
    _prevActiveId = id;
  });

  // ─────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────
  window.FelixNav = {
    render,
    getOrder,
    saveOrder,
    setOrder(order) { saveOrder(order); render(); },
    registerTab(id, tab) { TABS[id] = tab; },
    activate(id) {
      const btn = document.querySelector(`nav.bottom-nav button[data-tab="${id}"]`);
      if (btn) { btn.click(); return; }
      // Tab not in the visible rail (e.g. stats/report from MORE).
      // Switch panels via the legacy handler when available, else fall
      // back to a generic .panel.active toggle.
      if (typeof window.switchTab === "function") { try { window.switchTab(id); } catch (_) {} return; }
      document.querySelectorAll(".panel").forEach((p) =>
        p.classList.toggle("active", p.id === "panel-" + id)
      );
    },
  };

  // Render synchronously — by the time this script tag is parsed, the nav
  // element is in the DOM (it lives earlier in the body). Doing this
  // before the main IIFE's _initActiveTab capture means the inline IIFE
  // sees the active tab we set here.
  render();
})();
