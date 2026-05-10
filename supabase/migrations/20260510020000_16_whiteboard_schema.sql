-- Migration 16: WHITEBOARD schema (sessions / markers / strokes).
--
-- Tactical planning surface for coaches. Three tables:
--   whiteboard_sessions  — one drill / scenario, scoped to a team
--                          (game_id optional; video_source_id reserved
--                          for future AI video import + auto-marker
--                          placement, hook only — no FK target yet)
--   whiteboard_markers   — F1/F2/F3, D1/D2 (red+blue), puck. path_data
--                          is an ordered jsonb array of {x,y} waypoints
--                          for animation playback.
--   whiteboard_strokes   — six tool types (skate / skate_stop / skate_shot
--                          / pass / shot / loose_puck), each curved or
--                          straight, with pressure-aware stroke_data.
--
-- Idempotent: every CREATE / ALTER / POLICY uses IF NOT EXISTS or
-- DROP-then-CREATE. Safe to re-run.
--
-- RLS model (per spec):
--   SELECT — any authenticated team member of the parent session's team
--   INSERT/UPDATE/DELETE — coach only (is_team_coach() on parent team)
-- Marker + stroke policies derive team_id via subquery on session_id.
-- Position coords are normalized 0..1 floats (rink-relative). Renderer
-- multiplies by viewport size — schema is resolution-independent.

-- ========== Table: whiteboard_sessions ==========
CREATE TABLE IF NOT EXISTS public.whiteboard_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id         uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  game_id         uuid REFERENCES public.games(id) ON DELETE SET NULL,
  name            text NOT NULL,
  drill_title     text,
  video_source_id uuid,
  created_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS whiteboard_sessions_team_id_idx
  ON public.whiteboard_sessions(team_id);
CREATE INDEX IF NOT EXISTS whiteboard_sessions_game_id_idx
  ON public.whiteboard_sessions(game_id);

ALTER TABLE public.whiteboard_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whiteboard_sessions_team_member_select
  ON public.whiteboard_sessions;
CREATE POLICY whiteboard_sessions_team_member_select
  ON public.whiteboard_sessions
  FOR SELECT TO authenticated
  USING (public.is_team_member(team_id));

DROP POLICY IF EXISTS whiteboard_sessions_coach_insert
  ON public.whiteboard_sessions;
CREATE POLICY whiteboard_sessions_coach_insert
  ON public.whiteboard_sessions
  FOR INSERT TO authenticated
  WITH CHECK (public.is_team_coach(team_id));

DROP POLICY IF EXISTS whiteboard_sessions_coach_update
  ON public.whiteboard_sessions;
CREATE POLICY whiteboard_sessions_coach_update
  ON public.whiteboard_sessions
  FOR UPDATE TO authenticated
  USING (public.is_team_coach(team_id))
  WITH CHECK (public.is_team_coach(team_id));

DROP POLICY IF EXISTS whiteboard_sessions_coach_delete
  ON public.whiteboard_sessions;
CREATE POLICY whiteboard_sessions_coach_delete
  ON public.whiteboard_sessions
  FOR DELETE TO authenticated
  USING (public.is_team_coach(team_id));

DROP TRIGGER IF EXISTS whiteboard_sessions_set_updated_at
  ON public.whiteboard_sessions;
CREATE TRIGGER whiteboard_sessions_set_updated_at
  BEFORE UPDATE ON public.whiteboard_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ========== Table: whiteboard_markers ==========
-- color is null for the puck (white-only). marker_type/color CHECK
-- constraints lock the placeable set to exactly the 11 sanctioned
-- markers — no cones, generic dots, numbers, letters, or net icons.
-- path_data: jsonb array of {x,y} waypoints (0..1 normalized) — null
-- when the marker has no animation path.
CREATE TABLE IF NOT EXISTS public.whiteboard_markers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   uuid NOT NULL REFERENCES public.whiteboard_sessions(id) ON DELETE CASCADE,
  marker_type  text NOT NULL CHECK (marker_type IN ('F1','F2','F3','D1','D2','puck')),
  color        text CHECK (color IN ('red','blue')),
  position_x   float NOT NULL,
  position_y   float NOT NULL,
  path_data    jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whiteboard_markers_color_required
    CHECK ((marker_type = 'puck' AND color IS NULL)
        OR (marker_type <> 'puck' AND color IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS whiteboard_markers_session_id_idx
  ON public.whiteboard_markers(session_id);

ALTER TABLE public.whiteboard_markers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whiteboard_markers_team_member_select
  ON public.whiteboard_markers;
CREATE POLICY whiteboard_markers_team_member_select
  ON public.whiteboard_markers
  FOR SELECT TO authenticated
  USING (public.is_team_member(
    (SELECT team_id FROM public.whiteboard_sessions WHERE id = session_id)
  ));

DROP POLICY IF EXISTS whiteboard_markers_coach_insert
  ON public.whiteboard_markers;
CREATE POLICY whiteboard_markers_coach_insert
  ON public.whiteboard_markers
  FOR INSERT TO authenticated
  WITH CHECK (public.is_team_coach(
    (SELECT team_id FROM public.whiteboard_sessions WHERE id = session_id)
  ));

DROP POLICY IF EXISTS whiteboard_markers_coach_update
  ON public.whiteboard_markers;
CREATE POLICY whiteboard_markers_coach_update
  ON public.whiteboard_markers
  FOR UPDATE TO authenticated
  USING (public.is_team_coach(
    (SELECT team_id FROM public.whiteboard_sessions WHERE id = session_id)
  ))
  WITH CHECK (public.is_team_coach(
    (SELECT team_id FROM public.whiteboard_sessions WHERE id = session_id)
  ));

DROP POLICY IF EXISTS whiteboard_markers_coach_delete
  ON public.whiteboard_markers;
CREATE POLICY whiteboard_markers_coach_delete
  ON public.whiteboard_markers
  FOR DELETE TO authenticated
  USING (public.is_team_coach(
    (SELECT team_id FROM public.whiteboard_sessions WHERE id = session_id)
  ));

DROP TRIGGER IF EXISTS whiteboard_markers_set_updated_at
  ON public.whiteboard_markers;
CREATE TRIGGER whiteboard_markers_set_updated_at
  BEFORE UPDATE ON public.whiteboard_markers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ========== Table: whiteboard_strokes ==========
-- stroke_data: jsonb array of {x,y,pressure} points (0..1 normalized
-- coords; pressure 0..1 from Pointer Events API). variant gates the
-- long-press curved/straight modes per spec. stroke_order is used at
-- render time for deterministic z-stacking and during undo/redo.
CREATE TABLE IF NOT EXISTS public.whiteboard_strokes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   uuid NOT NULL REFERENCES public.whiteboard_sessions(id) ON DELETE CASCADE,
  stroke_type  text NOT NULL CHECK (stroke_type IN ('skate','skate_stop','skate_shot','pass','shot','loose_puck')),
  variant      text NOT NULL CHECK (variant IN ('curved','straight')),
  stroke_data  jsonb NOT NULL,
  color        text NOT NULL,
  brush_size   int  NOT NULL DEFAULT 3,
  stroke_order int  NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS whiteboard_strokes_session_id_idx
  ON public.whiteboard_strokes(session_id);
CREATE INDEX IF NOT EXISTS whiteboard_strokes_session_order_idx
  ON public.whiteboard_strokes(session_id, stroke_order);

ALTER TABLE public.whiteboard_strokes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whiteboard_strokes_team_member_select
  ON public.whiteboard_strokes;
CREATE POLICY whiteboard_strokes_team_member_select
  ON public.whiteboard_strokes
  FOR SELECT TO authenticated
  USING (public.is_team_member(
    (SELECT team_id FROM public.whiteboard_sessions WHERE id = session_id)
  ));

DROP POLICY IF EXISTS whiteboard_strokes_coach_insert
  ON public.whiteboard_strokes;
CREATE POLICY whiteboard_strokes_coach_insert
  ON public.whiteboard_strokes
  FOR INSERT TO authenticated
  WITH CHECK (public.is_team_coach(
    (SELECT team_id FROM public.whiteboard_sessions WHERE id = session_id)
  ));

DROP POLICY IF EXISTS whiteboard_strokes_coach_update
  ON public.whiteboard_strokes;
CREATE POLICY whiteboard_strokes_coach_update
  ON public.whiteboard_strokes
  FOR UPDATE TO authenticated
  USING (public.is_team_coach(
    (SELECT team_id FROM public.whiteboard_sessions WHERE id = session_id)
  ))
  WITH CHECK (public.is_team_coach(
    (SELECT team_id FROM public.whiteboard_sessions WHERE id = session_id)
  ));

DROP POLICY IF EXISTS whiteboard_strokes_coach_delete
  ON public.whiteboard_strokes;
CREATE POLICY whiteboard_strokes_coach_delete
  ON public.whiteboard_strokes
  FOR DELETE TO authenticated
  USING (public.is_team_coach(
    (SELECT team_id FROM public.whiteboard_sessions WHERE id = session_id)
  ));
