// js/calendar.js — Calendar (schedule) tab module
//
// Renders upcoming scheduled games for the active team. Source: nomos_game
// table, status='scheduled' or 'in_progress', game_date >= today, ordered
// ascending. Schedule is seeded by TeamSnap iCal import (game-day 2026-05-10
// autonomous run) and refreshed via re-import.
//
// Implements the tab module interface documented in js/nav.js.
// Off-rail: addressable from MORE, not in the bottom nav rail.

(function () {
  "use strict";

  const SUPABASE_URL = 'https://qshgschhudiryjnslzof.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_hdrc9mYaGocDhJVesn0FRw_wELl6Tnv';
  // Default team filter — Biggby Black 14U, the only roster on the
  // platform today. When multi-team support lands, swap this for a
  // user-membership lookup against team_members.
  const DEFAULT_TEAM_NAME = 'Biggby Black 14U';

  let _client = null;
  function getClient() {
    if (_client) return _client;
    if (typeof window.supabase === 'undefined' || !window.supabase.createClient) return null;
    _client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true }
    });
    return _client;
  }

  function fmtDate(iso) {
    // iso is YYYY-MM-DD. Render as "Sun May 10".
    try {
      const [y, m, d] = iso.split('-').map((n) => parseInt(n, 10));
      const dt = new Date(Date.UTC(y, m - 1, d));
      return dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
    } catch (_) { return iso; }
  }

  function fmtMatch(g) {
    const home = g.home_team_name || '—';
    const away = g.away_team_name || 'TBD';
    // If our team is "home", "Us vs Opponent". If our team is "away",
    // "Us at Opponent". Today's data has Biggby as home_team_name and
    // opponent as away_team_name — render "vs" by default.
    return `${home} vs ${away}`;
  }

  let _root = null;

  async function render() {
    if (!_root) return;
    _root.innerHTML = `
      <div class="calendar-root">
        <div class="calendar-head">
          <span class="calendar-title">Schedule</span>
          <button class="calendar-refresh" type="button" aria-label="Refresh">↻</button>
        </div>
        <div class="calendar-list" id="calendarList">
          <div class="calendar-empty">Loading…</div>
        </div>
      </div>`;
    const list = _root.querySelector('#calendarList');
    const refresh = _root.querySelector('.calendar-refresh');
    if (refresh) refresh.addEventListener('click', () => fetchAndRender(list));
    await fetchAndRender(list);
  }

  async function fetchAndRender(list) {
    list.innerHTML = '<div class="calendar-empty">Loading…</div>';
    const client = getClient();
    if (!client) {
      list.innerHTML = '<div class="calendar-empty">Supabase unavailable.</div>';
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await client
      .from('nomos_game')
      .select('id, client_game_id, game_date, home_team_name, away_team_name, rink_name, status')
      .eq('home_team_name', DEFAULT_TEAM_NAME)
      .gte('game_date', today)
      .in('status', ['scheduled', 'in_progress'])
      .order('game_date', { ascending: true })
      .limit(50);
    if (error) {
      list.innerHTML = `<div class="calendar-empty">Error: ${error.message}</div>`;
      return;
    }
    if (!data || data.length === 0) {
      list.innerHTML = '<div class="calendar-empty">No upcoming games.</div>';
      return;
    }
    list.innerHTML = data.map((g) => `
      <button class="calendar-row" data-game-code="${g.client_game_id || ''}" type="button">
        <div class="calendar-row-date">${fmtDate(g.game_date)}</div>
        <div class="calendar-row-match">${fmtMatch(g)}</div>
        <div class="calendar-row-loc">${g.rink_name || ''}</div>
        <div class="calendar-row-code">${g.client_game_id || ''}</div>
      </button>
    `).join('');
    // TODO: tap row → preview / quick-join. Currently no-op (stub).
    list.querySelectorAll('.calendar-row').forEach((row) => {
      row.addEventListener('click', () => {
        if (typeof window.toast === 'function') window.toast('Tap-to-join coming soon');
      });
    });
  }

  window.FelixCalendar = {
    label: "Calendar",
    icon: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/></svg>',
    init(root) { _root = root; render(); },
    onActivate() { if (_root) render(); },
    onDeactivate() {},
  };
})();
