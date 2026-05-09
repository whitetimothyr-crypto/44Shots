-- Add created_by to nomos_game for V4.0 ownership parity with public.games.
-- FK target is public.profiles(id) (NOT auth.users) to mirror the legacy
-- games.created_by exactly. profiles.id == auth.users.id per the
-- handle_new_user trigger, so an auth UUID is always a valid profile ref
-- by the time createGame() runs.
-- ON DELETE SET NULL: if the creator's profile is removed, the game row
-- survives with created_by = NULL. Match legacy behavior on games.

ALTER TABLE public.nomos_game
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.nomos_game.created_by IS
  'Profile UUID of the authenticated user who created this game. Mirrors public.games.created_by. NULL on legacy rows that pre-date this column.';

-- No backfill: existing 2 rows pre-date this column. Their creator is unknowable
-- from data on hand. Leaving NULL is honest; future inserts must populate.
