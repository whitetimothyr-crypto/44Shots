-- Migration 15: LINEUP schema (players / lineup_configs / lineup_slots) +
-- teams.ical_url addendum + seed (Plymouth Phantoms, Biggby Black) +
-- Tim as head_coach in team_members so the new RLS policies actually
-- let him write to the new tables.
--
-- Idempotent: every CREATE / ALTER / INSERT uses IF NOT EXISTS or
-- ON CONFLICT DO NOTHING. Safe to re-run.
--
-- RLS model (per spec): SELECT for any authenticated user; INSERT /
-- UPDATE / DELETE only when is_team_coach(team_id) returns true. For
-- lineup_slots the team_id is derived from the parent config_id via
-- subquery — no slot-level team_id stored.

-- ========== teams.ical_url addendum ==========
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS ical_url text;

-- ========== Seed teams (idempotent) ==========
-- Hardcoded UUIDs so subsequent migrations and JS code can reference
-- them deterministically. Both UUIDs are valid v4 (version nibble = 4,
-- variant nibble = 8) and clearly identifiable as seeded fixtures.
INSERT INTO public.teams (id, name, organization, created_by, ical_url)
VALUES
  ('00000000-0000-4000-8000-000000000001', 'Plymouth Phantoms', 'Plymouth',
   '47cfe4e4-b339-4490-9687-90ff29900b98', NULL),
  ('00000000-0000-4000-8000-000000000002', 'Biggby Black', 'Biggby',
   '47cfe4e4-b339-4490-9687-90ff29900b98',
   'http://ical-cdn.teamsnap.com/team_schedule/f33b6030-4235-013d-7f77-6994bc39a4c3.ics')
ON CONFLICT (id) DO NOTHING;

-- Backfill ical_url on a re-run when the row pre-existed without it.
UPDATE public.teams
SET ical_url = 'http://ical-cdn.teamsnap.com/team_schedule/f33b6030-4235-013d-7f77-6994bc39a4c3.ics'
WHERE id = '00000000-0000-4000-8000-000000000002'
  AND ical_url IS NULL;

-- ========== Seed Tim as head_coach for both teams ==========
-- Required: without this, is_team_coach() returns false for Tim and
-- the new INSERT/UPDATE/DELETE policies would lock him out of his own
-- tables. team_members has 0 rows pre-migration.
INSERT INTO public.team_members (team_id, user_id, team_role)
VALUES
  ('00000000-0000-4000-8000-000000000001',
   '47cfe4e4-b339-4490-9687-90ff29900b98', 'head_coach'),
  ('00000000-0000-4000-8000-000000000002',
   '47cfe4e4-b339-4490-9687-90ff29900b98', 'head_coach')
ON CONFLICT (team_id, user_id) DO NOTHING;

-- ========== Table: players ==========
CREATE TABLE IF NOT EXISTS public.players (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id       uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  jersey_number text NOT NULL,
  first_name    text NOT NULL,
  last_name     text NOT NULL,
  position      text CHECK (position IN ('F','D','G')),
  handedness    text CHECK (handedness IN ('L','R')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS players_team_id_idx ON public.players(team_id);

ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS players_select_authenticated ON public.players;
CREATE POLICY players_select_authenticated ON public.players
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS players_coach_insert ON public.players;
CREATE POLICY players_coach_insert ON public.players
  FOR INSERT TO authenticated
  WITH CHECK (public.is_team_coach(team_id));

DROP POLICY IF EXISTS players_coach_update ON public.players;
CREATE POLICY players_coach_update ON public.players
  FOR UPDATE TO authenticated
  USING (public.is_team_coach(team_id))
  WITH CHECK (public.is_team_coach(team_id));

DROP POLICY IF EXISTS players_coach_delete ON public.players;
CREATE POLICY players_coach_delete ON public.players
  FOR DELETE TO authenticated
  USING (public.is_team_coach(team_id));

DROP TRIGGER IF EXISTS players_set_updated_at ON public.players;
CREATE TRIGGER players_set_updated_at
  BEFORE UPDATE ON public.players
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ========== Table: lineup_configs ==========
CREATE TABLE IF NOT EXISTS public.lineup_configs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  name        text NOT NULL,
  is_default  boolean NOT NULL DEFAULT false,
  created_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lineup_configs_team_id_idx ON public.lineup_configs(team_id);

-- One default per team. Partial so non-default configs never collide.
CREATE UNIQUE INDEX IF NOT EXISTS lineup_configs_team_default_unique
  ON public.lineup_configs(team_id)
  WHERE is_default = true;

ALTER TABLE public.lineup_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lineup_configs_select_authenticated ON public.lineup_configs;
CREATE POLICY lineup_configs_select_authenticated ON public.lineup_configs
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS lineup_configs_coach_insert ON public.lineup_configs;
CREATE POLICY lineup_configs_coach_insert ON public.lineup_configs
  FOR INSERT TO authenticated
  WITH CHECK (public.is_team_coach(team_id));

DROP POLICY IF EXISTS lineup_configs_coach_update ON public.lineup_configs;
CREATE POLICY lineup_configs_coach_update ON public.lineup_configs
  FOR UPDATE TO authenticated
  USING (public.is_team_coach(team_id))
  WITH CHECK (public.is_team_coach(team_id));

DROP POLICY IF EXISTS lineup_configs_coach_delete ON public.lineup_configs;
CREATE POLICY lineup_configs_coach_delete ON public.lineup_configs
  FOR DELETE TO authenticated
  USING (public.is_team_coach(team_id));

DROP TRIGGER IF EXISTS lineup_configs_set_updated_at ON public.lineup_configs;
CREATE TRIGGER lineup_configs_set_updated_at
  BEFORE UPDATE ON public.lineup_configs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ========== Table: lineup_slots ==========
-- No team_id column directly — derive via parent config in the RLS
-- policies below. ON DELETE SET NULL on player_id keeps the slot
-- visible after a player is removed (stays empty, ready for re-fill).
CREATE TABLE IF NOT EXISTS public.lineup_slots (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id      uuid NOT NULL REFERENCES public.lineup_configs(id) ON DELETE CASCADE,
  group_label    text NOT NULL,
  group_order    int  NOT NULL DEFAULT 0,
  slot_position  text NOT NULL,
  slot_order     int  NOT NULL DEFAULT 0,
  player_id      uuid REFERENCES public.players(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lineup_slots_config_id_idx ON public.lineup_slots(config_id);
CREATE INDEX IF NOT EXISTS lineup_slots_player_id_idx ON public.lineup_slots(player_id);

ALTER TABLE public.lineup_slots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lineup_slots_select_authenticated ON public.lineup_slots;
CREATE POLICY lineup_slots_select_authenticated ON public.lineup_slots
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS lineup_slots_coach_insert ON public.lineup_slots;
CREATE POLICY lineup_slots_coach_insert ON public.lineup_slots
  FOR INSERT TO authenticated
  WITH CHECK (public.is_team_coach(
    (SELECT team_id FROM public.lineup_configs WHERE id = config_id)
  ));

DROP POLICY IF EXISTS lineup_slots_coach_update ON public.lineup_slots;
CREATE POLICY lineup_slots_coach_update ON public.lineup_slots
  FOR UPDATE TO authenticated
  USING (public.is_team_coach(
    (SELECT team_id FROM public.lineup_configs WHERE id = config_id)
  ))
  WITH CHECK (public.is_team_coach(
    (SELECT team_id FROM public.lineup_configs WHERE id = config_id)
  ));

DROP POLICY IF EXISTS lineup_slots_coach_delete ON public.lineup_slots;
CREATE POLICY lineup_slots_coach_delete ON public.lineup_slots
  FOR DELETE TO authenticated
  USING (public.is_team_coach(
    (SELECT team_id FROM public.lineup_configs WHERE id = config_id)
  ));

DROP TRIGGER IF EXISTS lineup_slots_set_updated_at ON public.lineup_slots;
CREATE TRIGGER lineup_slots_set_updated_at
  BEFORE UPDATE ON public.lineup_slots
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
