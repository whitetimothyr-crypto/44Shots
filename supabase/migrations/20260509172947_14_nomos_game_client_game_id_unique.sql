-- Partial unique index on nomos_game.client_game_id.
-- Partial (WHERE client_game_id IS NOT NULL) so legacy rows with NULL
-- client_game_id (pre-migration-11) still coexist; only the populated
-- values are uniqueness-checked.
-- This is the DB-level race-stop the app-layer dedup check could not
-- guarantee on its own. createGame() catches the resulting 23505 and
-- routes to joinGame, so the user-visible behavior on a race is the
-- same as on a hit of the app-layer SELECT.
-- Pre-req: the historical PLYM-0001 duplicate has been deduped.

CREATE UNIQUE INDEX IF NOT EXISTS nomos_game_client_game_id_unique
  ON public.nomos_game (client_game_id)
  WHERE client_game_id IS NOT NULL;
