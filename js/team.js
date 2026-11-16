// js/team.js — active team + local-date helpers (44 Shots)
//
// One place for "which team is this device tracking": game-code prefix,
// display names, and the team name the schedule RPC expects. Replaces the
// hard-coded "Phantoms" / "PLYM" defaults that predated Biggby Black.
// Persisted at localStorage["felix.activeTeam"]. Loads right after db.js,
// before game-engine.js (which reads FelixTeam.get().short for the default
// "our team" label).
//
// Also exports FelixTeam.today(): the LOCAL calendar date as YYYY-MM-DD.
// new Date().toISOString().slice(0,10) is the UTC date, which flips to
// tomorrow after ~7-8 PM in Michigan, so evening games were being stamped
// with the next day's date.

(function () {
  "use strict";

  const KEY = "felix.activeTeam";

  // slug  = game-code prefix (BGBYG14B-0009)
  // name  = nomos_game.home_team_name written by the TeamSnap sync
  // short = label on the rink / reports
  // rpc   = p_team_name for get_team_schedule (matches public.teams.name)
  const TEAMS = {
    BGBYG14B: { slug: "BGBYG14B", name: "Biggby Black 14U", short: "Biggby Black", rpc: "Biggby Black" },
    PLYM:     { slug: "PLYM",     name: "Plymouth Phantoms", short: "Phantoms",     rpc: "Plymouth Phantoms" },
  };
  const DEFAULT_SLUG = "BGBYG14B";
  const listeners = [];

  function today(d) {
    const dt = d instanceof Date ? d : new Date();
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const day = String(dt.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function get() {
    let slug = DEFAULT_SLUG;
    try { slug = localStorage.getItem(KEY) || DEFAULT_SLUG; } catch (_) {}
    return Object.assign({}, TEAMS[slug] || TEAMS[DEFAULT_SLUG]);
  }

  function set(slug) {
    if (!TEAMS[slug]) return get();
    try { localStorage.setItem(KEY, slug); } catch (_) {}
    const t = get();
    listeners.forEach((fn) => { try { fn(t); } catch (_) {} });
    return t;
  }

  // Map a team name from the DB (teams.name or nomos_game.home_team_name)
  // back to a known team, so memberships can pick the default team.
  function fromName(name) {
    const n = String(name || "").toLowerCase();
    return Object.values(TEAMS).find((t) =>
      n === t.name.toLowerCase() || n === t.rpc.toLowerCase() || n === t.short.toLowerCase()
    ) || null;
  }

  window.FelixTeam = {
    get,
    set,
    list() { return Object.values(TEAMS).map((t) => Object.assign({}, t)); },
    fromName,
    today,
    onChange(fn) { listeners.push(fn); },
  };
})();
