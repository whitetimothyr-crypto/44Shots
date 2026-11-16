// js/auth.js — 44 Shots auth wiring (Supabase)
// V3.0 spec: roles DERIVED from auth source. Two roles only: user, coach.
//   anon / no roster match → user
//   coaching-staff member  → coach (team_members.team_role head_coach / assistant_coach,
//                             the app's copy of the TeamSnap staff roster; ADMIN_EMAILS fallback)
// Auth flow: anonymous sign-in OR email OTP (6-digit). Magic link dropped because
// PWA-launched users can't complete it — link opens in browser, session never
// propagates. OTP keeps verification in PWA context.
// Mirrors session into FelixDB.auth_session for offline-first + V4.0 SwiftData parity.
(function () {
  const SUPABASE_URL = 'https://qshgschhudiryjnslzof.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_hdrc9mYaGocDhJVesn0FRw_wELl6Tnv';
  // Fallback only: the real source is team_members (see loadMemberships).
  // Kept so the owner never loses coach access if the roster query fails
  // offline on a fresh device.
  const ADMIN_EMAILS = ['white.timothy.r@gmail.com'];
  const COACH_TEAM_ROLES = ['head_coach', 'assistant_coach', 'coach', 'manager'];
  const ROLE_CACHE_KEY = 'felix.roleCache';

  let client = null;
  let initPromise = null;
  const listeners = [];
  // user_id -> { at, memberships: [{ team_id, team_role, team_name }] }
  const _memberCache = {};

  function emit(evt) {
    listeners.forEach((fn) => { try { fn(evt); } catch (e) { console.error('FelixAuth listener:', e); } });
  }

  // ONE shared Supabase client for the whole app. Every module's
  // getClient() prefers FelixAuth.client() so there is a single GoTrue
  // instance (multiple instances race on the same storage key and log
  // "Multiple GoTrueClient instances detected").
  function createSharedClient() {
    if (client) return client;
    if (typeof window.supabase === 'undefined' || !window.supabase.createClient) return null;
    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    return client;
  }

  function readRoleCache() {
    try { return JSON.parse(localStorage.getItem(ROLE_CACHE_KEY) || '{}') || {}; } catch (_) { return {}; }
  }
  function writeRoleCache(userId, memberships) {
    try {
      const c = readRoleCache();
      c[userId] = { at: Date.now(), memberships };
      localStorage.setItem(ROLE_CACHE_KEY, JSON.stringify(c));
    } catch (_) {}
  }

  // Team memberships for a signed-in (non-anonymous) user. RLS lets a user
  // read their own team_members rows and the teams they belong to.
  // Cached 5 min in memory, and in localStorage for offline launches.
  async function loadMemberships(user, force) {
    if (!user || user.is_anonymous) return [];
    const hit = _memberCache[user.id];
    if (!force && hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.memberships;
    const c = createSharedClient();
    if (c && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
      try {
        const { data, error } = await c
          .from('team_members')
          .select('team_id, team_role, teams(name)')
          .eq('user_id', user.id);
        if (!error && Array.isArray(data)) {
          const memberships = data.map((r) => ({
            team_id: r.team_id,
            team_role: r.team_role,
            team_name: (r.teams && r.teams.name) || null
          }));
          _memberCache[user.id] = { at: Date.now(), memberships };
          writeRoleCache(user.id, memberships);
          return memberships;
        }
      } catch (e) { console.warn('FelixAuth memberships:', e && e.message); }
    }
    const cached = readRoleCache()[user.id];
    return (cached && cached.memberships) || [];
  }

  async function deriveRole(user) {
    if (!user) return 'user';
    const email = (user.email || '').toLowerCase();
    if (!email || user.is_anonymous) return 'user';
    const memberships = await loadMemberships(user);
    if (memberships.some((m) => COACH_TEAM_ROLES.includes(String(m.team_role || '').toLowerCase()))) return 'coach';
    if (ADMIN_EMAILS.includes(email)) return 'coach';
    return 'user';
  }

  async function mirrorToFelixDB(session, role) {
    if (typeof FelixDB === 'undefined') return;
    try {
      // Preserve the joined-game pointer (active_game_id / active_game_code,
      // written by FelixGame). setSession() replaces the whole record, so a
      // token refresh used to wipe it and the joined game was forgotten.
      const prev = (await FelixDB.getSession()) || {};
      const keep = {};
      if (prev.active_game_id) keep.active_game_id = prev.active_game_id;
      if (prev.active_game_code) keep.active_game_code = prev.active_game_code;
      if (!session || !session.user) {
        if (keep.active_game_id) await FelixDB.setSession(keep);
        else await FelixDB.clearSession();
        return;
      }
      await FelixDB.setSession({
        ...keep,
        user_id: session.user.id,
        email: session.user.email || null,
        is_anonymous: !!session.user.is_anonymous,
        role: role,
        access_token: session.access_token,
        expires_at: session.expires_at ? session.expires_at * 1000 : null,
        provider: (session.user.app_metadata && session.user.app_metadata.provider) || 'unknown'
      });
    } catch (e) {
      console.warn('FelixDB session mirror failed:', e);
    }
  }

  async function handleSessionChange(session) {
    const role = await deriveRole(session && session.user);
    await mirrorToFelixDB(session, role);
    emit({ type: 'session', session: session || null, role: role });
  }

  function init() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      if (!createSharedClient()) {
        throw new Error('Supabase JS SDK not loaded — add <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script> before js/auth.js');
      }
      // Deferred per Supabase guidance: handleSessionChange queries team_members,
      // and awaiting a Supabase call inside this callback can deadlock the auth lock.
      client.auth.onAuthStateChange((_evt, session) => { setTimeout(() => handleSessionChange(session), 0); });
      const { data } = await client.auth.getSession();
      if (data && data.session) await handleSessionChange(data.session);
      return client;
    })();
    return initPromise;
  }

  window.FelixAuth = {
    init,
    // Shared client (sync). Null only if the Supabase SDK failed to load.
    client() { return createSharedClient(); },
    onAuthChange(fn) {
      listeners.push(fn);
      return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
    },

    // Reads the locally persisted session (no network round trip), so role
    // checks work offline at the rink and don't hit /auth/v1/user on every
    // button press. The SDK refreshes the token in the background.
    async getUser() {
      await init();
      const { data } = await client.auth.getSession();
      return (data && data.session && data.session.user) || null;
    },
    // [{ team_id, team_role, team_name }] for the signed-in account.
    async getTeams(force) {
      const user = await this.getUser();
      return loadMemberships(user, !!force);
    },
    async getProfile() {
      const user = await this.getUser();
      if (!user || user.is_anonymous) return null;
      const { data } = await client.from('profiles')
        .select('id, email, display_name, role, trust_score, sessions_logged')
        .eq('id', user.id).maybeSingle();
      return data || null;
    },
    async updateDisplayName(name) {
      const user = await this.getUser();
      if (!user || user.is_anonymous) throw new Error('Sign in to set a name');
      const clean = String(name || '').trim().slice(0, 60);
      const { error } = await client.from('profiles')
        .update({ display_name: clean || null, updated_at: new Date().toISOString() })
        .eq('id', user.id);
      if (error) throw new Error(error.message);
      return clean;
    },
    async getRole() {
      const user = await this.getUser();
      return deriveRole(user);
    },
    async isAnon() {
      const user = await this.getUser();
      return !user || user.is_anonymous === true;
    },

    async signInWithGoogle() {
      await init();
      return client.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin }
      });
    },
    async sendLoginCode(email) {
      // Sends 6-digit OTP via email. Email template must render {{ .Token }} only.
      // PWA-safe: no link redirect, code is typed back into the same app context.
      await init();
      if (!email) throw new Error('email required');
      return client.auth.signInWithOtp({
        email: email,
        options: { shouldCreateUser: true }
      });
    },
    async verifyLoginCode(email, code) {
      // Establishes session in current context — no sandbox jump.
      await init();
      if (!email || !code) throw new Error('email and code required');
      const result = await client.auth.verifyOtp({
        email: email,
        token: code,
        type: 'email'
      });
      // Mirror auth user into public.profiles. The handle_new_user trigger
      // creates the row on auth.users INSERT (writes email + display_name
      // as SECURITY DEFINER); this UPDATE is idempotent — backfills email
      // on every login and bumps updated_at. Does NOT touch display_name,
      // role, trust_score, sessions_logged. UPDATE-only (not upsert)
      // because RLS lacks an INSERT policy on profiles by design — row
      // creation is the trigger's responsibility.
      if (result && result.data && result.data.user) {
        try {
          const u = result.data.user;
          await client.from('profiles')
            .update({ email: u.email, updated_at: new Date().toISOString() })
            .eq('id', u.id);
        } catch (e) {
          console.warn('FelixAuth: profile email update failed:', e.message);
        }
      }
      return result;
    },
    async signInAnonymously() {
      await init();
      return client.auth.signInAnonymously();
    },
    async signOut() {
      await init();
      return client.auth.signOut();
    }
  };

  // Auto-init: required for OAuth/magic-link callback URL detection (detectSessionInUrl)
  // and for restoring existing sessions on page load. Caller methods all await init() too,
  // so this just kicks off the same promise eagerly.
  init().catch((e) => console.warn('FelixAuth auto-init:', e.message));
})();
