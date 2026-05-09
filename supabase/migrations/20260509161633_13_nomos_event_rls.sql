-- RLS policies for nomos_event. Migration 10 enabled RLS on this table but
-- never granted any policies, so authenticated INSERTs were silently denied
-- (this is the root cause of "zero rows in nomos_event").
-- Policies mirror nomos_submission: SELECT to anyone authenticated (needed
-- for consensus reads), INSERT only when the parent submission belongs to
-- the caller. UPDATE/DELETE intentionally absent — events are an
-- append-only audit log.

-- Authenticated users can read all events (consensus visibility).
CREATE POLICY "nomos_event_select_authenticated"
  ON public.nomos_event
  FOR SELECT
  TO authenticated
  USING (true);

-- Authenticated users can insert events under their OWN submissions only.
-- Cross-checks nomos_submission.submitter_id = auth.uid() so a user cannot
-- write events under someone else's submission row.
CREATE POLICY "nomos_event_insert_via_own_submission"
  ON public.nomos_event
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.nomos_submission s
      WHERE s.id = nomos_event.submission_id
        AND s.submitter_id = auth.uid()
    )
  );
