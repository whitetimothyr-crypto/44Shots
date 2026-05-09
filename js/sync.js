// js/sync.js — 44 Shots / NOMOS submission sync
// Flushes IndexedDB submission_queue → nomos_submission in Supabase.
// Authenticated users only. Trust weight pulled from submitter_trust if exists.
// Depends on: FelixAuth (js/auth.js), FelixDB (js/db.js), FelixGame (js/game.js)

(function () {
  const SUPABASE_URL = 'https://qshgschhudiryjnslzof.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_hdrc9mYaGocDhJVesn0FRw_wELl6Tnv';
  const DEFAULT_TRUST_WEIGHT = 0.4;
  const MAX_RETRIES = 3;

  let _syncing = false;

  function getClient() {
    if (typeof window.supabase === 'undefined') throw new Error('Supabase SDK not loaded');
    return window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true }
    });
  }

  // Fetch trust weight for this user from submitter_trust table
  async function getTrustWeight(client, userId) {
    try {
      const { data } = await client
        .from('submitter_trust')
        .select('trust_score')
        .eq('submitter_id', userId)
        .single();
      return (data && typeof data.trust_score === 'number') ? data.trust_score : DEFAULT_TRUST_WEIGHT;
    } catch (_) {
      return DEFAULT_TRUST_WEIGHT;
    }
  }

  // Submit a single queued row to nomos_submission
  async function submitOne(client, row, userId, trustWeight) {
    const { error } = await client
      .from('nomos_submission')
      .insert({
        game_id: row.game_id,
        submitter_id: userId,
        raw_stats: {
          events: row.events,
          client_queued_at: row.created_at,
          schema_v: 1
        },
        weight_at_submission: trustWeight,
        schema_v: 1
      });

    if (error) throw new Error(error.message);
  }

  window.NomosSync = {

    // Flush all pending IndexedDB submissions to Supabase
    // Called on: end-game, app resume when online
    async flush() {
      if (_syncing) return { skipped: true, reason: 'already_syncing' };
      if (!navigator.onLine) return { skipped: true, reason: 'offline' };

      const user = await FelixAuth.getUser();
      if (!user || user.is_anonymous) return { skipped: true, reason: 'not_authenticated' };

      const activeGame = FelixGame.getActiveGame();
      if (!activeGame) return { skipped: true, reason: 'no_active_game' };

      _syncing = true;
      const results = { synced: 0, failed: 0, errors: [] };

      try {
        const client = getClient();
        const trustWeight = await getTrustWeight(client, user.id);
        const pending = await FelixDB.getQueue('pending');

        // Only flush rows for the active game
        const forThisGame = pending.filter((r) => r.game_id === activeGame.id);

        for (const row of forThisGame) {
          if (row.retry_count >= MAX_RETRIES) {
            await FelixDB.markSubmission(row.id, { status: 'failed', last_error: 'max_retries_exceeded' });
            results.failed++;
            continue;
          }
          try {
            await submitOne(client, row, user.id, trustWeight);
            await FelixDB.markSubmission(row.id, { status: 'synced' });
            results.synced++;
          } catch (e) {
            await FelixDB.markSubmission(row.id, {
              retry_count: (row.retry_count || 0) + 1,
              last_error: e.message
            });
            results.failed++;
            results.errors.push({ id: row.id, error: e.message });
          }
        }

        // Clean up synced rows
        await FelixDB.clearSynced();

      } finally {
        _syncing = false;
      }

      console.log('[NomosSync] flush complete:', results);
      return results;
    },

    // Queue a submission locally then attempt immediate sync if online
    // rawStats: the full game stat blob from the app
    async queueAndSync(rawStats) {
      const user = await FelixAuth.getUser();
      if (!user) throw new Error('Not logged in');

      const activeGame = FelixGame.getActiveGame();
      if (!activeGame) throw new Error('No active game');

      // Queue locally first (offline-safe)
      await FelixDB.queueSubmission({
        game_id: activeGame.id,
        submitter_id: user.id,
        events: rawStats.events || [],
        created_at: Date.now()
      });

      // Attempt immediate flush if online
      if (navigator.onLine) {
        return this.flush();
      }
      return { queued: true, synced: 0 };
    },

    isSyncing() { return _syncing; }
  };

  // Auto-flush on coming back online
  window.addEventListener('online', () => {
    NomosSync.flush().catch((e) => console.warn('[NomosSync] online flush:', e.message));
  });

})();
