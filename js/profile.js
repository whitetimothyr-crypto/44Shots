// js/profile.js — Profile tab module.
//
// Account (guest / signed in, role derived from the team roster), display
// name, active team + team memberships, goalie jersey number, the game
// this device is tracking, device data + sync + cloud backup status, and
// app version / What's New / Help shortcuts.
//
// Implements the tab module interface documented in js/nav.js.
// Off-rail: opened from MORE -> Profile.

(function () {
  "use strict";

  const ARCHIVE_KEY = "felix-archive-v1";
  const NUM_KEY_LS = "felix-jersey-num";
  const ROLE_LABEL = { head_coach: "Head coach", assistant_coach: "Assistant coach", coach: "Coach", manager: "Manager", player: "Player", parent: "Parent", member: "Member" };

  let _root = null;
  let _seq = 0;

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function say(msg) { if (typeof window.toast === "function") window.toast(msg); }
  function S() { try { return (typeof state !== "undefined" && state) ? state : null; } catch (_) { return null; } }
  function fmtBytes(n) {
    if (!n && n !== 0) return "–";
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(0) + " KB";
    if (n < 1073741824) return (n / 1048576).toFixed(1) + " MB";
    return (n / 1073741824).toFixed(2) + " GB";
  }
  function archiveCount() {
    try { const a = JSON.parse(localStorage.getItem(ARCHIVE_KEY) || "[]"); return Array.isArray(a) ? a.length : 0; } catch (_) { return 0; }
  }

  async function gather() {
    const out = { user: null, role: "user", profile: null, teams: [], media: null, storage: null };
    if (typeof FelixAuth !== "undefined") {
      try {
        out.user = await FelixAuth.getUser();
        out.role = await FelixAuth.getRole();
        if (out.user && !out.user.is_anonymous) {
          const [p, t] = await Promise.all([
            FelixAuth.getProfile().catch(() => null),
            FelixAuth.getTeams().catch(() => []),
          ]);
          out.profile = p; out.teams = t || [];
        }
      } catch (e) { console.warn("Profile auth:", e && e.message); }
    }
    try { if (typeof FelixDB !== "undefined" && FelixDB.getAllMedia) out.media = (await FelixDB.getAllMedia()).length; } catch (_) {}
    try { if (navigator.storage && navigator.storage.estimate) out.storage = await navigator.storage.estimate(); } catch (_) {}
    return out;
  }

  function card(title, inner) {
    return `<section class="profile-card"><h3>${esc(title)}</h3>${inner}</section>`;
  }

  async function render() {
    if (!_root) return;
    const seq = ++_seq;
    if (!_root.firstChild) _root.innerHTML = '<div class="profile-root"><div class="calendar-empty">Loading profile…</div></div>';
    const d = await gather();
    if (seq !== _seq || !_root) return;

    const u = d.user;
    const signedIn = !!(u && !u.is_anonymous);
    const name = (d.profile && d.profile.display_name) || "";
    const who = signedIn ? (name || u.email || "Signed in") : (u ? "Guest" : "Not signed in");
    const initial = (signedIn ? (name || u.email || "?") : "G").trim().charAt(0).toUpperCase();
    const roleText = d.role === "coach" ? "Coach" : "User";

    const account = card("Account", `
      <div class="profile-id">
        <div class="profile-avatar" aria-hidden="true">${esc(initial)}</div>
        <div>
          <div class="profile-name">${esc(who)}</div>
          <div class="profile-sub">${signedIn && name ? esc(u.email) + " · " : ""}<span class="profile-role ${d.role}">${roleText}</span></div>
        </div>
      </div>
      ${signedIn ? `
        <label class="profile-label" for="profileNameInput">Display name (shown to your team)</label>
        <div class="profile-row">
          <input id="profileNameInput" type="text" maxlength="60" value="${esc(name)}" placeholder="e.g. Coach Tim">
          <button type="button" class="profile-btn" data-act="save-name">Save</button>
        </div>` : `
        <p class="profile-desc">${u ? "You're tracking as a guest. Data stays on this device." : "Sign in to back up your games and unlock coach tools if you're on a team's staff."}</p>`}
      <div class="profile-row">
        ${signedIn
          ? '<button type="button" class="profile-btn ghost" data-act="sign-out">Sign out</button>'
          : '<button type="button" class="profile-btn primary" data-act="sign-in">Sign in</button>'}
      </div>`);

    const t = window.FelixTeam ? FelixTeam.get() : { slug: "BGBYG14B", name: "Biggby Black 14U" };
    const teamOpts = (window.FelixTeam ? FelixTeam.list() : [t]).map((x) =>
      `<option value="${esc(x.slug)}"${x.slug === t.slug ? " selected" : ""}>${esc(x.name)}</option>`).join("");
    const memberships = d.teams.length
      ? `<ul class="profile-list">${d.teams.map((m) => `<li><span>${esc(m.team_name || "Team")}</span><span class="profile-muted">${esc(ROLE_LABEL[m.team_role] || m.team_role || "Member")}</span></li>`).join("")}</ul>`
      : `<p class="profile-desc">${signedIn ? "This account isn't on a team roster yet. Ask your head coach to add you." : "Sign in to see your team roles."}</p>`;
    const teamCard = card("Team", `
      <label class="profile-label" for="profileTeamSelect">Tracking for</label>
      <select id="profileTeamSelect">${teamOpts}</select>
      <p class="profile-desc">Sets the Calendar schedule, new game codes and the default team name.</p>
      ${memberships}`);

    const num = localStorage.getItem(NUM_KEY_LS) || "";
    const goalie = card("Goalie", `
      <label class="profile-label" for="profileNumInput">Goalie jersey number</label>
      <div class="profile-row">
        <input id="profileNumInput" type="text" inputmode="numeric" maxlength="3" value="${esc(num === "?" ? "" : num)}" placeholder="#">
        <button type="button" class="profile-btn" data-act="save-num">Save</button>
      </div>`);

    const g = (typeof FelixGame !== "undefined" && FelixGame.getActiveGame()) || null;
    const s = S() || {};
    const gameCard = card("Current game", g && g.id ? `
      <div class="profile-list-row"><span>Game code</span><b>${esc(g.code || g.client_game_id || "")}</b></div>
      <div class="profile-list-row"><span>Matchup</span><span>${esc([g.home_team_name, g.away_team_name].filter(Boolean).join(" vs ") || "–")}</span></div>
      <div class="profile-row"><button type="button" class="profile-btn" data-act="go-calendar">Share code</button><button type="button" class="profile-btn ghost" data-act="leave">Leave game</button></div>`
      : `<p class="profile-desc">${s.gameInfo && s.gameInfo.configured ? "Tracking a local game (not shared with other scorers)." : "Not in a game."} Join or share a game from the Calendar.</p>
      <div class="profile-row"><button type="button" class="profile-btn" data-act="go-calendar">Open Calendar</button></div>`);

    const sync = (typeof NomosSync !== "undefined" && NomosSync.getStatus) ? NomosSync.getStatus() : null;
    const backup = window.FelixBackup ? FelixBackup.status() : null;
    const est = d.storage;
    const dataCard = card("This device", `
      <div class="profile-list-row"><span>Saved games</span><b>${archiveCount()}</b></div>
      <div class="profile-list-row"><span>Events this game</span><b>${(s.events || []).length + (s.faceoffs || []).length}</b></div>
      <div class="profile-list-row"><span>Photos &amp; videos</span><b>${d.media == null ? "–" : d.media}</b></div>
      <div class="profile-list-row"><span>Live sync</span><span>${sync ? (sync.online ? "Online" : "Offline") + " · " + sync.synced + " sent" + (sync.pending ? " · " + sync.pending + " waiting" : "") : "–"}</span></div>
      <div class="profile-list-row"><span>Cloud backup</span><span>${esc(backup ? backup.text : "–")}</span></div>
      <div class="profile-list-row"><span>Storage used</span><span>${est ? fmtBytes(est.usage) + (est.quota ? " of " + fmtBytes(est.quota) : "") : "–"}</span></div>
      ${signedIn && window.FelixBackup ? '<div class="profile-row"><button type="button" class="profile-btn" data-act="backup">Back up now</button><button type="button" class="profile-btn ghost" data-act="restore">Restore</button></div>' : ""}`);

    const app = card("App", `
      <div class="profile-list-row"><span>Version</span><b>${esc(window.APP_VERSION || "v3.0")}</b></div>
      <div class="profile-row">
        <button type="button" class="profile-btn ghost" data-act="whats-new">What's New</button>
        <button type="button" class="profile-btn ghost" data-act="help">Help</button>
        <button type="button" class="profile-btn ghost" data-act="settings">Settings</button>
      </div>`);

    _root.innerHTML = `<div class="profile-root">${account}${teamCard}${goalie}${gameCard}${dataCard}${app}</div>`;
  }

  async function onClick(e) {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const act = b.dataset.act;
    try {
      if (act === "sign-in") {
        if (typeof window.openAccount === "function") window.openAccount();
        else document.getElementById("settingsAccountBtn") && document.getElementById("settingsAccountBtn").click();
      } else if (act === "sign-out") {
        if (!confirm("Sign out? Your local game data stays on this device.")) return;
        await FelixAuth.signOut();
        say("Signed out");
        render();
      } else if (act === "save-name") {
        const v = (_root.querySelector("#profileNameInput") || {}).value || "";
        b.disabled = true;
        await FelixAuth.updateDisplayName(v);
        say("Name saved");
        render();
      } else if (act === "save-num") {
        const v = ((_root.querySelector("#profileNumInput") || {}).value || "").trim().replace(/[^0-9]/g, "").slice(0, 3);
        localStorage.setItem(NUM_KEY_LS, v || "?");
        const numEdit = document.getElementById("numEdit");
        if (numEdit) numEdit.textContent = v || "?";
        const s = S();
        if (s && s.activeGoalie && v) { s.activeGoalie.num = v; if (typeof save === "function") save(); if (typeof updateGoalieBanner === "function") updateGoalieBanner(); }
        say(v ? "Goalie #" + v + " saved" : "Jersey number cleared");
      } else if (act === "go-calendar") {
        if (window.FelixNav) FelixNav.activate("calendar");
      } else if (act === "leave") {
        if (!confirm("Stop tracking this game on this device? Shots you already logged stay saved.")) return;
        await FelixGame.leaveGame();
        say("Left the game");
        render();
      } else if (act === "backup") {
        b.disabled = true; b.textContent = "Backing up…";
        const r = await FelixBackup.backupAll({ force: true });
        say(r.uploaded ? "Backed up " + r.uploaded + " game(s)" : "Everything is already backed up");
        render();
      } else if (act === "restore") {
        b.disabled = true; b.textContent = "Restoring…";
        const r = await FelixBackup.restore();
        say(r.added ? "Restored " + r.added + " game(s)" : "No new games to restore");
        render();
      } else if (act === "whats-new") {
        const h = document.getElementById("helpBtn"); if (h) h.click();
      } else if (act === "help") {
        const h = document.getElementById("helpBtnUtil"); if (h) h.click();
      } else if (act === "settings") {
        if (typeof window.openSettings === "function") window.openSettings();
      }
    } catch (err) {
      say((err && err.message) || "Something went wrong");
      b.disabled = false;
      render();
    }
  }

  function onChange(e) {
    if (e.target && e.target.id === "profileTeamSelect" && window.FelixTeam) {
      const t = FelixTeam.set(e.target.value);
      say("Tracking for " + t.name);
    }
  }

  // Re-render on sign-in / sign-out while the tab is visible.
  if (typeof FelixAuth !== "undefined" && FelixAuth.onAuthChange) {
    FelixAuth.onAuthChange(() => {
      const p = document.getElementById("panel-profile");
      if (_root && p && p.classList.contains("active")) render();
    });
  }

  window.FelixProfile = {
    label: "Profile",
    icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>',
    init(root) {
      _root = root;
      root.addEventListener("click", onClick);
      root.addEventListener("change", onChange);
    },
    onActivate() { render(); },
    onDeactivate() {},
  };
})();
