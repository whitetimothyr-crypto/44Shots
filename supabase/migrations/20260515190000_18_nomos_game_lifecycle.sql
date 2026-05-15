-- Migration 18: nomos_game lifecycle columns for the Entry Hub
--
-- Adds four columns + two partial indexes to support the Hub's
-- Create / Join / Practice entry flows and the Rejoin tile's
-- "last active" timestamp. No trigger -- last_active_at is maintained
-- by app code (js/entry.js + js/sync-readonly.js, sub-commits B2-B3),
-- because gameplay activity lives in nomos_event INSERTs not in
-- nomos_game UPDATEs (nomos_game has no score / period columns; the
-- per-shot data lives in nomos_event).
--
-- entry_mode CHECK enum:
--   create   -> coach used FelixGame.createGame (today's primary path)
--   join     -> player used FelixGame.joinGame by short code
--   practice -> solo drill mode (NOT YET implemented in FelixGame;
--               Hub stub in B3 alerts "coming soon")
--
-- 'rejoin' is intentionally NOT in the enum: rejoin is a UX action
-- (resuming an existing session), not a property of the game itself.
-- The originating entry_mode (create or join) is preserved across
-- rejoins; resume_count tracks how many times the user resumed.
--
-- last_active_at is the timestamp of the last meaningful client
-- activity for this game (most-recent shot, lifecycle change, or
-- explicit resume). Maintained by app-layer UPDATEs from B2/B3, not
-- by a server trigger. See docs/audit-known-issues.md if drift is
-- observed in production.

BEGIN;

ALTER TABLE public.nomos_game
    ADD COLUMN IF NOT EXISTS entry_mode text
        CHECK (entry_mode IN ('create', 'join', 'practice'))
        DEFAULT 'create',
    ADD COLUMN IF NOT EXISTS join_code text,
    ADD COLUMN IF NOT EXISTS resume_count int NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_active_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS nomos_game_join_code_active_idx
    ON public.nomos_game (join_code)
    WHERE join_code IS NOT NULL AND finalized_at IS NULL;

CREATE INDEX IF NOT EXISTS nomos_game_resume_idx
    ON public.nomos_game (created_by, last_active_at DESC)
    WHERE finalized_at IS NULL;

COMMIT;
