-- Add client_game_id to nomos_game.
-- The bare team-code (e.g. "PLYM-0001") is currently embedded inside
-- match_probe (e.g. "PLYM-0001_20260509"). Splitting it out as a
-- first-class column makes joins/lookups by code cheaper and brings
-- nomos_game into structural parity with public.games.client_game_id
-- (added in migration 09) for V4.0 SwiftData mapping.

ALTER TABLE public.nomos_game
  ADD COLUMN IF NOT EXISTS client_game_id text;

COMMENT ON COLUMN public.nomos_game.client_game_id IS
  'Bare team-prefixed game code, e.g. "PLYM-0001". Composite form lives in match_probe ("PLYM-0001_YYYYMMDD"). Mirrors public.games.client_game_id.';

-- Backfill existing rows: extract the bare code (everything before the underscore).
UPDATE public.nomos_game
SET client_game_id = split_part(match_probe, '_', 1)
WHERE client_game_id IS NULL
  AND match_probe LIKE '%-%_%';
