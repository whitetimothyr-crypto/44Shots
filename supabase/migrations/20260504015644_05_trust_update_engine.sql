
-- ============================================================
-- 44 SHOTS — TRUST UPDATE ENGINE
--
-- After a game is reconciled, update each scorer's trust based on:
-- - How many of their events made it into consensus
-- - Avg agreement_score across their contributed events
-- - Whether their events were disputed
--
-- Formula:
--   inclusion_rate = events_in_consensus / events_logged
--   session_plausibility = inclusion_rate * agreement_avg
--   trust_delta = (session_plausibility - 0.5) * learning_rate
--   trust_new = clamp(trust_old + trust_delta, 0, 1)
--
-- Plain English:
--   - If your events all agree with consensus → plausibility ~1.0 → trust climbs
--   - If half your events were unique/disputed → plausibility ~0.4 → trust drops
--   - Brand-new scorer (trust=0.5) with clean game → bumps to ~0.525 immediately
--   - Long-time scorer logging garbage → drops 0.025 per game until they fix it
-- ============================================================

create or replace function public.update_trust_after_reconciliation(p_game_id uuid)
returns integer
language plpgsql security definer as $$
declare
  v_learning_rate constant numeric := 0.050;
  v_baseline constant numeric := 0.5;
  obs record;
  v_updates_count integer := 0;
begin
  for obs in
    select id as observation_id, scorer_user_id, scorer_trust_at_time
    from public.game_observations
    where game_id = p_game_id
  loop
    declare
      v_events_logged integer;
      v_events_in_consensus integer;
      v_events_disputed integer;
      v_agreement_avg numeric;
      v_inclusion_rate numeric;
      v_plausibility numeric;
      v_trust_before numeric;
      v_trust_delta numeric;
      v_trust_after numeric;
      v_reason text;
    begin
      -- Get current trust (may have changed since observation was submitted)
      select trust_score into v_trust_before
      from public.profiles where id = obs.scorer_user_id;

      -- Count this scorer's events for this game
      select count(*) into v_events_logged
      from public.shot_events where observation_id = obs.observation_id;

      if v_events_logged = 0 then
        continue;  -- no events logged, no trust adjustment
      end if;

      -- Count their events that landed in consensus
      select
        count(distinct ce.id) filter (where ce.is_disputed = false),
        count(distinct ce.id) filter (where ce.is_disputed = true),
        coalesce(avg(ce.agreement_score), 0)
      into v_events_in_consensus, v_events_disputed, v_agreement_avg
      from public.consensus_events ce
      cross join unnest(ce.contributing_event_ids) as cid
      join public.shot_events se on se.id = cid
      where ce.game_id = p_game_id
        and se.observation_id = obs.observation_id;

      v_inclusion_rate := v_events_in_consensus::numeric / nullif(v_events_logged, 0);
      v_plausibility := v_inclusion_rate * v_agreement_avg;

      -- Trust delta is centered at 0.5 (baseline) — above grows trust, below shrinks it
      v_trust_delta := (v_plausibility - v_baseline) * v_learning_rate;
      v_trust_after := greatest(0.0, least(1.0, v_trust_before + v_trust_delta));

      v_reason := format(
        'Logged %s events; %s in consensus (%s disputed); agreement avg %s',
        v_events_logged, v_events_in_consensus, v_events_disputed,
        round(v_agreement_avg, 3)
      );

      -- Apply update
      update public.profiles
      set trust_score = round(v_trust_after::numeric, 3),
          sessions_logged = sessions_logged + 1
      where id = obs.scorer_user_id;

      -- Audit log
      insert into public.trust_history (
        user_id, game_id, observation_id,
        events_logged, events_in_consensus, events_disputed,
        agreement_avg, session_plausibility,
        trust_before, trust_delta, trust_after,
        learning_rate, reason
      ) values (
        obs.scorer_user_id, p_game_id, obs.observation_id,
        v_events_logged, v_events_in_consensus, v_events_disputed,
        round(v_agreement_avg, 3), round(v_plausibility, 3),
        v_trust_before, round(v_trust_delta, 4), round(v_trust_after, 3),
        v_learning_rate, v_reason
      );

      v_updates_count := v_updates_count + 1;
    end;
  end loop;

  return v_updates_count;
end;
$$;

-- Convenience: complete-and-reconcile in one call
create or replace function public.finalize_game(p_game_id uuid)
returns jsonb
language plpgsql security definer as $$
declare
  v_consensus integer;
  v_disputed integer;
  v_trust_updates integer;
begin
  select consensus_count, disputed_count
  into v_consensus, v_disputed
  from public.reconcile_game(p_game_id);

  v_trust_updates := public.update_trust_after_reconciliation(p_game_id);

  return jsonb_build_object(
    'game_id', p_game_id,
    'consensus_events', v_consensus,
    'disputed_events', v_disputed,
    'scorers_updated', v_trust_updates
  );
end;
$$;
