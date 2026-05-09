// js/auth.js — 44 Shots auth wiring (Supabase)
// V3.0 spec: roles DERIVED from auth source. Two roles only: user, coach.
//   anon / no roster match → user
//   roster email match     → coach (TeamSnap, stubbed via ADMIN_EMAILS until sprint H+6)
// Auth flow: anonymous sign-in OR email OTP (6-digit). Magic link dropped because
// PWA-launched users can't complete it — link opens in browser, session never
// propagates. OTP keeps verification in PWA context.
// Mirrors session into FelixDB.auth_session for offline-first + V4.0 SwiftData parity.
(function () {
  const SUPABASE_URL = 'https://qshgschhudiryjnslzof.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_hdrc9mYaGocDhJVesn0FRw_wELl6Tnv';
  // TODO(H+6): remove ADMIN_EMAILS once getCoachRosterEmails() pulls real
  // TeamSnap roster. Tim is a coach on the real roster; this is a stopgap so
  // his account gets the coach role before TeamSnap wires.
  const ADMIN_EMAILS = ['white.timothy.r@gmail.com'];

  let client = null;
  let initPromise = null;
  const listeners = [];

  function emit(evt) {
    listeners.forEach((fn) => { try { fn(evt); } catch (e) { console.error('FelixAuth listener:', e); } });
  }

  // TODO(sprint H+6→H+7): replace with TeamSnap roster lookup
  async function getCoachRosterEmails() { return []; }

  async function deriveRole(user) {
    if (!user) return 'user';
    const email = (user.email || '').toLowerCase();
    if (!email || user.is_anonymous) return 'user';
    if (ADMIN_EMAILS.includes(email)) return 'coach';
    const coaches = await getCoachRosterEmails();
    if (coaches.map((e) => e.toLowerCase()).includes(email)) return 'coach';
    return 'user';
  }

  async function mirrorToFelixDB(session, role) {
    if (typeof FelixDB === 'undefined') return;
    try {
      if (!session || !session.user) {
        await FelixDB.clearSession();
        return;
      }
      await FelixDB.setSession({
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
      if (typeof window.supabase === 'undefined' || !window.supabase.createClient) {
        throw new Error('Supabase JS SDK not loaded — add <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script> before js/auth.js');
      }
      client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
      client.auth.onAuthStateChange((_evt, session) => { handleSessionChange(session); });
      const { data } = await client.auth.getSession();
      if (data && data.session) await handleSessionChange(data.session);
      return client;
    })();
    return initPromise;
  }

  window.FelixAuth = {
    init,
    onAuthChange(fn) {
      listeners.push(fn);
      return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
    },

    async getUser() {
      await init();
      const { data } = await client.auth.getUser();
      return (data && data.user) || null;
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
