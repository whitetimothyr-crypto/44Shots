
-- ============================================================
-- 44 SHOTS — TRUST UPDATE v3 (anomaly vs variance model)
--
-- Anomalies (severe): missed goals → -0.05 per missed goal
-- Variances (gradual): event-level disagreement → ±0.005 per game tops
--
-- Rationale: goals are objective events the referee signals. Missing one
-- means you weren't paying attention. Daily details (zone, location, count)
-- are normal human variance and should adjust trust slowly.
-- ============================================================

create or replace function public.update_trust_after_reconciliation(p_game_id uuid)
returns integer
language plpgsql security definer as $$
declare
  v_anomaly_penalty_per_goal constant numeric := 0.050;  -- per missed goal
  v_variance_baseline constant numeric := 0.75;          -- "competent" detail accuracy
  v_variance_learning_rate constant numeric := 0.020;    -- gentle slope
  obs record;
  v_updates_count integer := 0;
  v_total_goals integer;
begin
  -- Total goals in this game from consensus (excluding disputed)
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
      v_goals_caught integer;
      v_goals_missed integer;
      v_anomaly_penalty numeric;
      v_variance_score numeric;
      v_variance_delta numeric;
      v_trust_before numeric;
      v_trust_delta numeric;
      v_trust_after numeric;
      v_session_score numeric;
      v_reason text;
    begin
      select trust_score into v_trust_before
      from public.profiles where id = obs.scorer_user_id;

      select count(*) into v_events_logged
      from public.shot_events where observation_id = obs.observation_id;

      -- Count consensus contributions
      select
        count(distinct ce.id) filter (where ce.is_disputed = false),
        count(distinct ce.id) filter (where ce.is_disputed = true),
        count(distinct ce.id) filter (where ce.is_disputed = false and ce.outcome = 'goal')
      into v_events_in_consensus, v_events_disputed, v_goals_caught
      from public.consensus_events ce
      cross join unnest(ce.contributing_event_ids) as cid
      join public.shot_events se on se.id = cid
      where ce.game_id = p_game_id
        and se.observation_id = obs.observation_id;

      v_goals_missed := greatest(0, v_total_goals - v_goals_caught);

      -- ANOMALY PENALTY: severe, per missed goal
      v_anomaly_penalty := v_goals_missed * v_anomaly_penalty_per_goal;

      -- VARIANCE DELTA: gentle, based on detail accuracy
      if v_events_logged = 0 then
        v_variance_score := v_variance_baseline;  -- neutral if nothing logged
      else
        v_variance_score := v_events_in_consensus::numeric / v_events_logged;
      end if;
      v_variance_delta := (v_variance_score - v_variance_baseline) * v_variance_learning_rate;

      v_trust_delta := v_variance_delta - v_anomaly_penalty;
      v_trust_after := greatest(0.0, least(1.0, v_trust_before + v_trust_delta));
      v_session_score := v_variance_score - (v_goals_missed::numeric / nullif(v_total_goals, 0));

      v_reason := format(
        'Goals %s/%s caught (anomaly penalty %s); detail accuracy %s%% (variance Δ %s); total Δ %s',
        v_goals_caught, v_total_goals,
        case when v_anomaly_penalty > 0 then '-' || v_anomaly_penalty::text else '0' end,
        round(v_variance_score * 100),
        round(v_variance_delta, 4),
        round(v_trust_delta, 4)
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
        round(v_variance_score, 3),
        round(coalesce(v_session_score, v_variance_score), 3),
        v_trust_before, round(v_trust_delta, 4), round(v_trust_after, 3),
        v_variance_learning_rate, v_reason
      );

      v_updates_count := v_updates_count + 1;
    end;
  end loop;

  return v_updates_count;
end;
$$;
