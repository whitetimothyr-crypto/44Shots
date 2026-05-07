
-- ============================================================
-- 44 SHOTS — TRUST UPDATE v2
-- Refined: missing GOALS is a heavy penalty. Missing non-goal events is fine.
-- Logging phantom events is a moderate penalty.
--
-- Formula:
--   goal_attendance = (goals_total - goals_missed) / goals_total
--   event_quality = events_in_consensus / events_logged
--   session_plausibility = 0.6*goal_attendance + 0.4*event_quality
--   trust_delta = (session_plausibility - 0.5) * learning_rate
-- ============================================================

create or replace function public.update_trust_after_reconciliation(p_game_id uuid)
returns integer
language plpgsql security definer as $$
declare
  v_learning_rate constant numeric := 0.050;
  v_baseline constant numeric := 0.5;
  v_goal_weight constant numeric := 0.6;
  v_quality_weight constant numeric := 0.4;
  obs record;
  v_updates_count integer := 0;
  v_total_goals integer;
begin
  -- Total goals in this game (per consensus, not disputed ones)
  select count(*) into v_total_goals
  from public.consensus_events
  where game_id = p_game_id and outcome = 'goal' and is_disputed = false;

  for obs in
    select id as observation_id, scorer_user_id, scorer_trust_at_time
    from public.game_observations
    where game_id = p_game_id
  loop
    declare
      v_events_logged integer;
      v_events_in_consensus integer;
      v_events_disputed integer;
      v_goals_logged_in_consensus integer;
      v_goals_missed integer;
      v_goal_attendance numeric;
      v_event_quality numeric;
      v_plausibility numeric;
      v_trust_before numeric;
      v_trust_delta numeric;
      v_trust_after numeric;
      v_reason text;
    begin
      select trust_score into v_trust_before
      from public.profiles where id = obs.scorer_user_id;

      select count(*) into v_events_logged
      from public.shot_events where observation_id = obs.observation_id;

      if v_events_logged = 0 and v_total_goals = 0 then
        continue;  -- nothing to assess
      end if;

      -- Count this scorer's contributions to consensus
      select
        count(distinct ce.id) filter (where ce.is_disputed = false),
        count(distinct ce.id) filter (where ce.is_disputed = true),
        count(distinct ce.id) filter (where ce.is_disputed = false and ce.outcome = 'goal')
      into v_events_in_consensus, v_events_disputed, v_goals_logged_in_consensus
      from public.consensus_events ce
      cross join unnest(ce.contributing_event_ids) as cid
      join public.shot_events se on se.id = cid
      where ce.game_id = p_game_id
        and se.observation_id = obs.observation_id;

      -- Goals missed = total goals - goals this scorer caught
      v_goals_missed := greatest(0, v_total_goals - v_goals_logged_in_consensus);

      -- Goal attendance: 1.0 if caught all goals, drops sharply for each missed
      if v_total_goals = 0 then
        v_goal_attendance := 1.0;  -- no goals to miss = perfect attendance
      else
        v_goal_attendance := v_goals_logged_in_consensus::numeric / v_total_goals;
      end if;

      -- Event quality: of events you logged, how many landed in consensus?
      if v_events_logged = 0 then
        v_event_quality := v_baseline;  -- neutral if you didn't log anything
      else
        v_event_quality := v_events_in_consensus::numeric / v_events_logged;
      end if;

      v_plausibility := (v_goal_weight * v_goal_attendance) + (v_quality_weight * v_event_quality);

      v_trust_delta := (v_plausibility - v_baseline) * v_learning_rate;
      v_trust_after := greatest(0.0, least(1.0, v_trust_before + v_trust_delta));

      v_reason := format(
        'Goals %s/%s caught (%s%% attendance); %s/%s events in consensus (%s%% quality); plausibility %s',
        v_goals_logged_in_consensus, v_total_goals, round(v_goal_attendance * 100),
        v_events_in_consensus, v_events_logged, round(v_event_quality * 100),
        round(v_plausibility, 3)
      );

      update public.profiles
      set trust_score = round(v_trust_after::numeric, 3),
          sessions_logged = sessions_logged + 1
      where id = obs.scorer_user_id;

      insert into public.trust_history (
        user_id, game_id, observation_id,
        events_logged, events_in_consensus, events_disputed,
        agreement_avg, session_plausibility,
        trust_before, trust_delta, trust_after,
        learning_rate, reason
      ) values (
        obs.scorer_user_id, p_game_id, obs.observation_id,
        v_events_logged, v_events_in_consensus, v_events_disputed,
        round(v_goal_attendance, 3),  -- repurposed: goal_attendance lives here
        round(v_plausibility, 3),
        v_trust_before, round(v_trust_delta, 4), round(v_trust_after, 3),
        v_learning_rate, v_reason
      );

      v_updates_count := v_updates_count + 1;
    end;
  end loop;

  return v_updates_count;
end;
$$;
