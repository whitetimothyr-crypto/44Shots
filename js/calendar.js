// js/calendar.js — Calendar (schedule) tab module
//
// Upcoming games for the active team (js/team.js), straight from the
// TeamSnap feed. Source: public.get_team_schedule(p_team_name) RPC
// (migration 18). The RPC is callable without signing in, re-syncs the
// TeamSnap iCal feed server-side when the last sync is >30 min old (plus a
// daily pg_cron sync), and returns upcoming scheduled / in-progress games
// using the Michigan calendar date.
//
// Tap a game -> detail sheet: join code + QR + share link for scorers,
// "Join this game" for anyone, "Start tracking" for coaches (joins the
// game, marks it live and opens New Game prefilled). Coaches also get
// "+ Game code" for games that are not on TeamSnap (scrimmages).
//
// Offline-first: the last good schedule is cached in localStorage and shown
// with a notice when the network or database is unreachable.
//
// Implements the tab module interface documented in js/nav.js.
// Off-rail: addressable from MORE, not in the bottom nav rail.

(function () {
  "use strict";

  const SUPABASE_URL = 'https://qshgschhudiryjnslzof.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_hdrc9mYaGocDhJVesn0FRw_wELl6Tnv';
  const CACHE_KEY = 'felix.scheduleCache.v2';
  const RINK_TZ = 'America/Detroit';

  let _fallbackClient = null;
  function getClient() {
    if (window.FelixAuth && typeof FelixAuth.client === 'function') {
      const c = FelixAuth.client();
      if (c) return c;
    }
    if (_fallbackClient) return _fallbackClient;
    if (typeof window.supabase === 'undefined' || !window.supabase.createClient) return null;
    _fallbackClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true }
    });
    return _fallbackClient;
  }

  function team() {
    return (window.FelixTeam && FelixTeam.get()) ||
      { slug: 'BGBYG14B', name: 'Biggby Black 14U', short: 'Biggby Black', rpc: 'Biggby Black' };
  }
  function todayISO() {
    if (window.FelixTeam) return FelixTeam.today();
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function say(msg) { if (typeof window.toast === 'function') window.toast(msg); }

  // game_date is a plain calendar date: build it in LOCAL time (the old
  // code mixed UTC and local and could show the wrong weekday).
  function parseDay(iso) {
    const [y, m, d] = String(iso).split('-').map((n) => parseInt(n, 10));
    return new Date(y, (m || 1) - 1, d || 1);
  }
  function fmtDate(iso, long) {
    try {
      return parseDay(iso).toLocaleDateString(undefined, long
        ? { weekday: 'long', month: 'long', day: 'numeric' }
        : { weekday: 'short', month: 'short', day: 'numeric' });
    } catch (_) { return iso; }
  }
  function daysFromToday(iso) {
    const ms = parseDay(iso) - parseDay(todayISO());
    return Math.round(ms / 86400000);
  }
  function relLabel(g) {
    if (g.status === 'in_progress') return 'LIVE';
    const n = daysFromToday(g.game_date);
    if (n === 0) return 'TODAY';
    if (n === 1) return 'TOMORROW';
    if (n > 1 && n < 7) return 'IN ' + n + ' DAYS';
    return '';
  }
  // TeamSnap DTSTART is the ARRIVAL time (matches "Arrival Time" in the
  // event description), so label it that way. Shown in rink-local time.
  function fmtArrive(ts) {
    if (!ts) return '';
    try {
      return 'Arrive ' + new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: RINK_TZ });
    } catch (_) { return ''; }
  }
  function opponent(g) {
    const away = g.away_team_name || 'TBD';
    return /tournament|showcase|classic|cup|jamboree/i.test(away) ? away : 'vs ' + away;
  }
  function matchTitle(g) {
    const opp = opponent(g);
    return (g.home_team_name || team().name) + (opp.indexOf('vs ') === 0 ? ' ' : ' · ') + opp;
  }
  function mapsURL(rink) {
    return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(rink);
  }

  function readCache() {
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      return c && c.team === team().slug && Array.isArray(c.games) ? c : null;
    } catch (_) { return null; }
  }
  function writeCache(games) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ team: team().slug, at: Date.now(), games })); } catch (_) {}
  }

  async function fetchSchedule() {
    const c = getClient();
    if (!c) throw new Error('The database library did not load. Check your connection and reload.');
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('You are offline.');
    const { data, error } = await c.rpc('get_team_schedule', { p_team_name: team().rpc });
    if (error) throw new Error(error.message || 'Schedule request failed');
    const games = (data || []).filter((g) => g.game_date >= todayISO() || g.status === 'in_progress');
    writeCache(games);
    return games;
  }

  async function isCoach() {
    try { return typeof FelixAuth !== 'undefined' && (await FelixAuth.getRole()) === 'coach'; }
    catch (_) { return false; }
  }
  function activeGame() {
    try { return (typeof FelixGame !== 'undefined' && FelixGame.getActiveGame()) || null; } catch (_) { return null; }
  }

  // ───────────────────────── panel ─────────────────────────
  let _root = null;
  let _games = [];
  let _seq = 0;

  function shell() {
    const t = team();
    _root.innerHTML = `
      <div class="calendar-root">
        <div class="calendar-head">
          <div>
            <div class="calendar-title">Schedule</div>
            <div class="calendar-sub">${esc(t.name)} · synced from TeamSnap</div>
          </div>
          <div class="calendar-actions">
            <button class="calendar-new" type="button" hidden>+ Game code</button>
            <button class="calendar-refresh" type="button" aria-label="Refresh schedule">↻</button>
          </div>
        </div>
        <div class="calendar-active" hidden></div>
        <div class="calendar-note" role="status" hidden></div>
        <div class="calendar-list" id="calendarList"></div>
      </div>`;
    _root.querySelector('.calendar-refresh').addEventListener('click', () => load(true));
    _root.querySelector('.calendar-new').addEventListener('click', () => {
      if (window.FelixWelcome && typeof FelixWelcome.showCreateGame === 'function') FelixWelcome.showCreateGame();
      else say('Game creation unavailable. Reload the app.');
    });
    _root.querySelector('.calendar-list').addEventListener('click', (e) => {
      const row = e.target.closest('.calendar-row');
      if (row) openSheet(_games[parseInt(row.dataset.idx, 10)]);
      const retry = e.target.closest('[data-retry]');
      if (retry) load(true);
    });
    _root.querySelector('.calendar-active').addEventListener('click', (e) => {
      if (e.target.closest('[data-leave]')) leave();
    });
    isCoach().then((c) => { const b = _root && _root.querySelector('.calendar-new'); if (b) b.hidden = !c; });
  }

  function renderActive() {
    if (!_root) return;
    const box = _root.querySelector('.calendar-active');
    if (!box) return;
    const g = activeGame();
    if (!g || !g.id) { box.hidden = true; box.innerHTML = ''; return; }
    const label = g.away_team_name ? opponent(g) : '';
    box.hidden = false;
    box.innerHTML = `<span>Tracking <b>${esc(g.code || g.client_game_id || '')}</b> ${esc(label)}</span>
      <button type="button" data-leave>Leave</button>`;
  }

  function renderList(games) {
    const list = _root && _root.querySelector('.calendar-list');
    if (!list) return;
    _games = games;
    if (!games.length) {
      list.innerHTML = `<div class="calendar-empty">No upcoming games on the ${esc(team().name)} TeamSnap schedule.</div>`;
      return;
    }
    const act = activeGame();
    list.innerHTML = games.map((g, i) => {
      const rel = relLabel(g);
      const meta = [fmtArrive(g.scheduled_start), g.rink_name].filter(Boolean).join(' · ');
      const cls = ['calendar-row'];
      if (rel === 'TODAY' || rel === 'LIVE') cls.push('is-soon');
      if (act && act.id === g.id) cls.push('is-active');
      return `
        <button class="${cls.join(' ')}" data-idx="${i}" data-game-code="${esc(g.code)}" type="button">
          <div class="calendar-row-date">${esc(fmtDate(g.game_date))}</div>
          <div class="calendar-row-match">${esc(opponent(g))}</div>
          <div class="calendar-row-code">${esc(g.code || '')}</div>
          <div class="calendar-row-loc">${rel ? `<span class="calendar-badge${rel === 'LIVE' ? ' live' : ''}">${rel}</span>` : ''}${esc(meta)}</div>
        </button>`;
    }).join('');
  }

  function note(text) {
    const n = _root && _root.querySelector('.calendar-note');
    if (!n) return;
    n.hidden = !text;
    n.textContent = text || '';
  }

  async function load(manual) {
    if (!_root) return;
    const seq = ++_seq;
    const list = _root.querySelector('.calendar-list');
    const cached = readCache();
    if (cached && !_games.length) renderList(cached.games);
    else if (!cached && !_games.length) list.innerHTML = '<div class="calendar-empty">Loading schedule…</div>';
    const btn = _root.querySelector('.calendar-refresh');
    if (btn) btn.classList.add('spinning');
    try {
      const games = await fetchSchedule();
      if (seq !== _seq) return;
      note('');
      renderList(games);
      if (manual) say('Schedule updated');
    } catch (e) {
      if (seq !== _seq) return;
      const msg = (e && e.message) || 'unknown error';
      if (cached) {
        renderList(cached.games);
        note('Could not refresh (' + msg + '). Showing the schedule saved ' +
          new Date(cached.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + '.');
      } else {
        list.innerHTML = `<div class="calendar-empty">Could not load the schedule: ${esc(msg)}<br>
          <button type="button" class="calendar-retry" data-retry>Try again</button></div>`;
      }
    } finally {
      if (btn) btn.classList.remove('spinning');
    }
    renderActive();
  }

  async function leave() {
    if (typeof FelixGame === 'undefined') return;
    if (!confirm('Stop tracking this game on this device? Shots you already logged stay saved.')) return;
    await FelixGame.leaveGame();
    say('Left the game');
    renderActive();
    renderList(_games);
  }

  // ───────────────────────── detail sheet ─────────────────────────
  let _sheet = null;
  let _sheetGame = null;

  function ensureSheet() {
    if (_sheet) return _sheet;
    _sheet = document.createElement('div');
    _sheet.className = 'cal-sheet-backdrop';
    _sheet.id = 'calSheet';
    _sheet.innerHTML = `
      <div class="cal-sheet" role="dialog" aria-modal="true" aria-labelledby="calSheetTitle">
        <button class="cal-sheet-x" type="button" aria-label="Close">&times;</button>
        <div class="cal-sheet-when"></div>
        <h3 id="calSheetTitle"></h3>
        <a class="cal-sheet-rink" target="_blank" rel="noopener"></a>
        <div class="cal-sheet-code"></div>
        <img class="cal-sheet-qr" alt="" width="180" height="180">
        <div class="cal-sheet-hint">Scorers scan this code or open the link to track this game with you. No account needed.</div>
        <div class="cal-sheet-row">
          <button type="button" data-act="copy">Copy link</button>
          <button type="button" data-act="share">Share</button>
        </div>
        <button type="button" class="cal-sheet-primary" data-act="join">Join this game</button>
        <button type="button" class="cal-sheet-primary coach" data-act="start" hidden>Start tracking (coach)</button>
        <button type="button" class="cal-sheet-link" data-act="leave" hidden>Leave this game</button>
        <div class="cal-sheet-msg" role="status"></div>
      </div>`;
    document.body.appendChild(_sheet);
    _sheet.addEventListener('click', (e) => {
      if (e.target === _sheet || e.target.closest('.cal-sheet-x')) { closeSheet(); return; }
      const b = e.target.closest('[data-act]');
      if (b) act(b.dataset.act, b);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && _sheet.classList.contains('open')) closeSheet();
    });
    return _sheet;
  }

  function sheetMsg(text, isError) {
    const m = _sheet.querySelector('.cal-sheet-msg');
    m.textContent = text || '';
    m.classList.toggle('error', !!isError);
  }

  async function openSheet(g) {
    if (!g) return;
    ensureSheet();
    _sheetGame = g;
    const when = [fmtDate(g.game_date, true), fmtArrive(g.scheduled_start)].filter(Boolean).join(' · ');
    _sheet.querySelector('.cal-sheet-when').textContent = when + (g.status === 'in_progress' ? ' · LIVE' : '');
    _sheet.querySelector('#calSheetTitle').textContent = matchTitle(g);
    const rink = _sheet.querySelector('.cal-sheet-rink');
    if (g.rink_name) { rink.hidden = false; rink.textContent = g.rink_name + ' ↗'; rink.href = mapsURL(g.rink_name); }
    else { rink.hidden = true; }
    _sheet.querySelector('.cal-sheet-code').textContent = g.code || '';
    const qr = _sheet.querySelector('.cal-sheet-qr');
    const qrSrc = (typeof FelixGame !== 'undefined' && FelixGame.getQRUrl) ? FelixGame.getQRUrl(g.code) : '';
    qr.hidden = !qrSrc;
    if (qrSrc) { qr.src = qrSrc; qr.alt = 'QR code to join ' + g.code; }
    const a = activeGame();
    const inThis = !!(a && a.id === g.id);
    const join = _sheet.querySelector('[data-act="join"]');
    join.textContent = inThis ? "You're in this game · Go to rink" : 'Join this game';
    join.disabled = false;
    _sheet.querySelector('[data-act="leave"]').hidden = !inThis;
    const start = _sheet.querySelector('[data-act="start"]');
    start.hidden = true;
    start.disabled = false;
    sheetMsg('');
    _sheet.classList.add('open');
    setTimeout(() => { const x = _sheet.querySelector('.cal-sheet-x'); if (x) x.focus(); }, 30);
    if (await isCoach()) start.hidden = false;
  }

  function closeSheet() {
    if (_sheet) _sheet.classList.remove('open');
    _sheetGame = null;
  }

  function goToRink() {
    if (window.FelixNav && typeof FelixNav.activate === 'function') FelixNav.activate('rink');
    else if (typeof window.switchTab === 'function') window.switchTab('rink');
  }

  async function act(what, btn) {
    const g = _sheetGame;
    if (!g) return;
    const url = (typeof FelixGame !== 'undefined' && FelixGame.getShareURL)
      ? FelixGame.getShareURL(g.code) : 'https://44shots.com/?game=' + encodeURIComponent(g.code);
    const title = matchTitle(g);
    if (what === 'copy') {
      try { await navigator.clipboard.writeText(url); sheetMsg('Link copied: ' + url); }
      catch (_) { window.prompt('Copy this link:', url); }
      return;
    }
    if (what === 'share') {
      if (navigator.share) {
        try { await navigator.share({ title: '44 Shots · ' + title, text: 'Track ' + title + ' with me on 44 Shots (' + g.code + ')', url }); }
        catch (e) { if (e && e.name !== 'AbortError') sheetMsg('Share failed: ' + e.message, true); }
      } else {
        try { await navigator.clipboard.writeText(url); sheetMsg('Sharing is not supported here, so the link was copied.'); }
        catch (_) { window.prompt('Copy this link:', url); }
      }
      return;
    }
    if (what === 'leave') { closeSheet(); leave(); return; }
    if (what === 'join') {
      const a = activeGame();
      if (a && a.id === g.id) { closeSheet(); goToRink(); return; }
      btn.disabled = true;
      sheetMsg('Joining ' + g.code + '…');
      try {
        await FelixGame.joinGame(g.code);
        closeSheet();
        say('Joined ' + g.code + ' · tap the rink to log shots');
        renderActive();
        renderList(_games);
        goToRink();
      } catch (e) {
        sheetMsg((e && e.message) || 'Could not join this game.', true);
        btn.disabled = false;
      }
      return;
    }
    if (what === 'start') {
      if (typeof window.startScheduledGame !== 'function') { sheetMsg('Start is unavailable. Reload the app.', true); return; }
      btn.disabled = true;
      sheetMsg('Setting up ' + g.code + '…');
      try {
        const ok = await window.startScheduledGame(g);
        if (ok) { closeSheet(); renderActive(); renderList(_games); }
        else { sheetMsg(''); btn.disabled = false; }
      } catch (e) {
        sheetMsg((e && e.message) || 'Could not start this game.', true);
        btn.disabled = false;
      }
    }
  }

  // Keep the "Tracking …" banner and row highlight current.
  function watchGame() {
    if (typeof FelixGame === 'undefined' || !FelixGame.onGameChange) return;
    FelixGame.onGameChange((evt) => {
      if (!_root) return;
      renderActive();
      renderList(_games);
      if (evt && evt.type === 'game_created') load(false);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchGame);
  else watchGame();
  if (window.FelixTeam && FelixTeam.onChange) FelixTeam.onChange(() => { _games = []; if (_root) { shell(); load(false); } });

  window.FelixCalendar = {
    label: "Calendar",
    icon: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/></svg>',
    init(root) { _root = root; shell(); },
    onActivate() {
      if (!_root) return;
      isCoach().then((c) => { const b = _root.querySelector('.calendar-new'); if (b) b.hidden = !c; });
      load(false);
    },
    onDeactivate() { closeSheet(); },
    refresh() { return load(true); },
  };
})();
