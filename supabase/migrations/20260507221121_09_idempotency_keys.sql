-- ============================================================
-- 44 SHOTS — IDEMPOTENCY KEYS
--
-- Adds idempotency guards at game level and shot level so that retries
-- (network drop mid-write, app crash and resume) become no-ops instead of
-- duplicate rows.
--
-- Strategy: client generates a UUID before sending. (created_by, client_game_id)
-- and (observation_id, client_event_id) are unique per partition. On retry,
-- the unique index rejects the second insert. The client treats the rejection
-- as success.
--
-- Both indexes are PARTIAL (WHERE ... IS NOT NULL) so existing rows with
-- NULL keys stay valid and are not affected. Future inserts that omit the
-- key (legacy paths, raw inserts) are also still allowed but unprotected.
--
-- Verified end-to-end on 2026-05-07: applied migration, confirmed indexes
-- exist with correct definitions, ran behavioral test that proved duplicate
-- inserts are rejected with unique_violation. Cleanup removed test row.
-- Production state: 16 rows, all with NULL client_event_id, unchanged.
-- ============================================================

-- Game-level idempotency: parents/coaches creating the same game twice
ALTER TABLE public.games
  ADD COLUMN client_game_id text;

COMMENT ON COLUMN public.games.client_game_id IS
  'Client-generated UUID for idempotency. Set by the client before INSERT. '
  'Combined with created_by, uniquely identifies a single game-creation '
  'intent. Prevents duplicate games from retries on flaky networks.';

CREATE UNIQUE INDEX games_idempotency_idx
  ON public.games (created_by, client_game_id)
  WHERE client_game_id IS NOT NULL;

-- Shot-level idempotency: same shot logged twice on retry
-- Column already exists from migration 02. Just add the constraint.
COMMENT ON COLUMN public.shot_events.client_event_id IS
  'Client-generated UUID for idempotency. Set by the client before INSERT. '
  'Combined with observation_id, uniquely identifies a single shot-log '
  'intent. Prevents duplicate shots from retries on flaky networks. '
  'Column existed since migration 02 but was not enforced until migration 09.';

CREATE UNIQUE INDEX shot_events_idempotency_idx
  ON public.shot_events (observation_id, client_event_id)
  WHERE client_event_id IS NOT NULL;
