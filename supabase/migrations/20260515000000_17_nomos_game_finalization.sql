-- Migration 17: nomos_game finalization columns (status, finalized_at)
--
-- Both columns already exist on the live database (added via Supabase
-- Dashboard pre-2026-05-15). This file brings the repo migration history
-- into parity with prod so a fresh `supabase db reset` reproduces the
-- live schema. Both ALTERs are no-ops against the production DB
-- (verified via information_schema.columns 2026-05-15).
--
-- State machine (V3.0 architectural decision 2026-05-15):
--
--   scheduled    -> FelixGame.createGame (js/game.js:113-127)
--   in_progress  -> FelixGame.beginGame  (js/game.js:228-252)
--   completed    -> client End Game flow (new wrapper js/game-end.js
--                   added in branch sub-commit B2; FelixGame.endGame at
--                   js/game.js:255-263 already writes 'completed' but
--                   was never wired into index.html's endGame handler)
--   finalized    -> server-side reconciliation Edge Function (future;
--                   sets finalized_at = NOW() at the same write)
--   disputed     -> server-side reconciliation, consensus failure
--                   (existing pattern, see migration 04)
--   archived     -> coach-side soft delete / hide
--
-- The CHECK constraint on status already permits all values above on
-- live. Inline CHECK on ADD COLUMN only attaches when the column is
-- being created; for existing columns it is silently skipped, so this
-- migration cannot accidentally alter the live constraint.

BEGIN;

ALTER TABLE public.nomos_game
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('scheduled','in_progress','completed','finalized','disputed','archived'));

ALTER TABLE public.nomos_game
  ADD COLUMN IF NOT EXISTS finalized_at timestamptz;

COMMENT ON COLUMN public.nomos_game.status IS
  'Lifecycle state. scheduled -> in_progress -> completed (client End Game via js/game-end.js) -> finalized | disputed (server reconciliation). archived = hidden by coach. CHECK constraint enforces this enum.';

COMMENT ON COLUMN public.nomos_game.finalized_at IS
  'UTC timestamp set by the reconciliation Edge Function when status flips to finalized. NULL while scheduled / in_progress / completed. Not written by client code.';

COMMIT;
