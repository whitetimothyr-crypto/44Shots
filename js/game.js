// js/game.js — 44 Shots / NOMOS game management
// Handles: game creation (coach only), short code generation,
// join-by-code, URL param detection, active game state.
// Depends on: FelixAuth (js/auth.js), FelixDB (js/db.js)

(function () {
  const SUPABASE_URL = 'https://qshgschhudiryjnslzof.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_hdrc9mYaGocDhJVesn0FRw_wELl6Tnv';
  const TEAM_SLUG = 'PLYM'; // Plymouth Phantoms

  // Active game context for this session
  let _activeGame = null;
  const _listeners = [];

  function emit(evt) {
    _listeners.forEach((fn) => { try { fn(evt); } catch (e) { console.error('FelixGame listener:', e); } });
  }

  function getClient() {
    if (typeof window.supabase === 'undefined') throw new Error('Supabase SDK not loaded');
    return window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true }
    });
  }

  // Pad game number: 1 → "0001"
  function padGameNum(n) {
    return String(n).padStart(4, '0');
  }

  // Generate next game code: PLYM-0001, PLYM-0002, etc.
  // Queries nomos_game for the highest existing code for this slug.
  async function generateGameCode() {
    const client = getClient();
    const { data, error } = await client
      .from('nomos_game')
      .select('match_probe')
      .ilike('match_probe', `${TEAM_SLUG}-%`)
      .order('match_probe', { ascending: false })
      .limit(1);

    if (error) throw new Error('generateGameCode query failed: ' + error.message);

    if (!data || data.length === 0) return `${TEAM_SLUG}-0001`;

    const last = data[0].match_probe; // e.g. "PLYM-0003_20260509"
    const parts = last.split('-');
    const numPart = parts[1] ? parseInt(parts[1].split('_')[0], 10) : 0;
    return `${TEAM_SLUG}-${padGameNum(numPart + 1)}`;
  }

  // Build match_probe: "PLYM-0001_20260509"
  function buildMatchProbe(code, dateStr) {
    return `${code}_${dateStr.replace(/-/g, '')}`;
  }

  // Get today's date as YYYY-MM-DD
  function todayISO() {
    return new Date().toISOString().split('T')[0];
  }

  // ============================================================
  // Public API
  // ============================================================

  window.FelixGame = {

    onGameChange(fn) {
      _listeners.push(fn);
      return () => { const i = _listeners.indexOf(fn); if (i >= 0) _listeners.splice(i, 1); };
    },

    getActiveGame() {
      return _activeGame;
    },

    // Create a new game (coach only — enforced by app layer)
    // gameInfo: { home_team_name, away_team_name, rink_name, age_bracket }
    async createGame(gameInfo = {}) {
      const user = await FelixAuth.getUser();
      if (!user) throw new Error('Must be logged in to create a game');

      const role = await FelixAuth.getRole();
      if (role !== 'coach') throw new Error('Only coaches can create games');

      const code = await generateGameCode();
      const today = todayISO();
      const match_probe = buildMatchProbe(code, today);

      const client = getClient();
      const { data, error } = await client
        .from('nomos_game')
        .insert({
          match_probe,
          client_game_id: code,
          game_date: today,
          home_team_name: gameInfo.home_team_name || 'Plymouth Phantoms',
          away_team_name: gameInfo.away_team_name || null,
          rink_name: gameInfo.rink_name || null,
          age_bracket: gameInfo.age_bracket || null,
          status: 'scheduled'
        })
        .select()
        .single();

      if (error) throw new Error('createGame failed: ' + error.message);

      _activeGame = { ...data, code };
      // Persist to IndexedDB for offline resume
      await FelixDB.setSession({ ...(await FelixDB.getSession()), active_game_id: data.id, active_game_code: code });
      emit({ type: 'game_created', game: _activeGame });
      return _activeGame;
    },

    // Join an existing game by short code (e.g. "PLYM-0001")
    async joinGame(code) {
      const user = await FelixAuth.getUser();
      if (!user) throw new Error('Must be logged in to join a game');

      const normalized = code.trim().toUpperCase();
      const client = getClient();

      const { data, error } = await client
        .from('nomos_game')
        .select('*')
        .ilike('match_probe', `${normalized}_%`)
        .in('status', ['in_progress', 'scheduled'])
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (error || !data) throw new Error(`Game "${normalized}" not found or not active`);

      _activeGame = { ...data, code: normalized };
      await FelixDB.setSession({ ...(await FelixDB.getSession()), active_game_id: data.id, active_game_code: normalized });
      emit({ type: 'game_joined', game: _activeGame });
      return _activeGame;
    },

    // Detect ?game=PLYM-0001 in URL and auto-join
    async detectGameFromURL() {
      const params = new URLSearchParams(window.location.search);
      const code = params.get('game');
      if (!code) return null;
      try {
        const game = await this.joinGame(code);
        // Clean up URL without reload
        const clean = window.location.pathname;
        window.history.replaceState({}, '', clean);
        return game;
      } catch (e) {
        console.warn('FelixGame URL join failed:', e.message);
        return null;
      }
    },

    // Resume active game from IndexedDB on page load
    async resumeFromCache() {
      try {
        const session = await FelixDB.getSession();
        if (!session || !session.active_game_id) return null;
        const client = getClient();
        const { data } = await client
          .from('nomos_game')
          .select('*')
          .eq('id', session.active_game_id)
          .single();
        if (!data) return null;
        _activeGame = { ...data, code: session.active_game_code };
        emit({ type: 'game_resumed', game: _activeGame });
        return _activeGame;
      } catch (e) {
        console.warn('FelixGame resumeFromCache:', e.message);
        return null;
      }
    },

    // Transition active scheduled game to in_progress.
    // Coach-only. Clears local shot state so live tracking starts fresh.
    async beginGame() {
      if (!_activeGame) throw new Error('No active game to begin');
      const user = await FelixAuth.getUser();
      if (!user) throw new Error('Must be logged in to begin a game');
      const role = await FelixAuth.getRole();
      if (role !== 'coach') throw new Error('Only coaches can begin a game');

      const client = getClient();
      const { data, error } = await client
        .from('nomos_game')
        .update({ status: 'in_progress' })
        .eq('id', _activeGame.id)
        .select()
        .single();
      if (error) throw new Error('beginGame failed: ' + error.message);

      // Clear local game state. Preserves settings, archive, jersey-num, walkthrough.
      ['felix-shot-tracker-v1','felix-backup-latest','felix-backup-stamp',
       'felix-opp','felix-score','felix-notes','felix-opp-auto','felix-score-auto']
        .forEach((k) => { try { localStorage.removeItem(k); } catch(e){} });

      _activeGame = { ..._activeGame, ...data };
      emit({ type: 'game_started', game: _activeGame });
      return _activeGame;
    },

    // Mark active game completed
    async endGame() {
      if (!_activeGame) return;
      const client = getClient();
      await client
        .from('nomos_game')
        .update({ status: 'completed' })
        .eq('id', _activeGame.id);
      emit({ type: 'game_ended', game: _activeGame });
    },

    // Generate shareable URL for current active game
    getShareURL() {
      if (!_activeGame) return null;
      return `https://44shots.com?game=${_activeGame.code}`;
    },

    // Generate QR code data URL (uses Google Charts API, no lib needed)
    getQRUrl() {
      const url = this.getShareURL();
      if (!url) return null;
      const encoded = encodeURIComponent(url);
      return `https://chart.googleapis.com/chart?chs=200x200&cht=qr&chl=${encoded}&choe=UTF-8`;
    }
  };

  // Auto-detect game from URL on load
  document.addEventListener('DOMContentLoaded', () => {
    FelixGame.detectGameFromURL().catch((e) => console.warn('FelixGame init:', e.message));
  });

})();
