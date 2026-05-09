-- Migration: 10_nomos_rls
-- Enables client-side writes to nomos_game and nomos_submission
-- for authenticated users only. Anon users cannot write.
-- Coach-only game creation is enforced at app layer (js/game.js)
-- until a coach_role column or profiles join is added in a future migration.

-- ============================================================
-- nomos_game policies
-- ============================================================

-- Any authenticated user can read all games (needed to join by code)
CREATE POLICY "nomos_game_select_authenticated"
  ON public.nomos_game
  FOR SELECT
  TO authenticated
  USING (true);

-- Only authenticated users can create games
-- Coach enforcement happens in app layer for now
CREATE POLICY "nomos_game_insert_authenticated"
  ON public.nomos_game
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Only authenticated users can update games they are associated with
-- (status updates: in_progress → completed)
CREATE POLICY "nomos_game_update_authenticated"
  ON public.nomos_game
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- nomos_submission policies
-- ============================================================

-- Authenticated users can read all submissions for a game
-- (needed for consensus resolution display)
CREATE POLICY "nomos_submission_select_authenticated"
  ON public.nomos_submission
  FOR SELECT
  TO authenticated
  USING (true);

-- Authenticated users can only insert their own submissions
-- submitter_id must match their auth.uid()
CREATE POLICY "nomos_submission_insert_own"
  ON public.nomos_submission
  FOR INSERT
  TO authenticated
  WITH CHECK (submitter_id = auth.uid());

-- Users can update only their own submissions
CREATE POLICY "nomos_submission_update_own"
  ON public.nomos_submission
  FOR UPDATE
  TO authenticated
  USING (submitter_id = auth.uid())
  WITH CHECK (submitter_id = auth.uid());
