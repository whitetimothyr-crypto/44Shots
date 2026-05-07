
-- ============================================================
-- 44 SHOTS — RECONCILIATION ENGINE
-- Multi-observer consensus algorithm.
--
-- ALGORITHM:
-- 1. Cluster shot_events across all observations by (period, game_state, time_window, spatial_proximity)
-- 2. Each cluster represents one real-world event observed by 1+ scorers
-- 3. For each cluster, compute trust-weighted consensus:
--    - outcome: majority vote weighted by trust
--    - net_zone: trust-weighted mode (highest weighted count)
--    - rink_x, rink_y: trust-weighted average
--    - agreement_score = (sum trust of agreeing observers) / (sum trust of all observers in cluster)
-- 4. If observer_count = 1, pass through with reduced agreement_score = 0.5
-- 5. If agreement_score < 0.6, flag is_disputed = true (admin review later)
-- ============================================================

-- Helper: cluster shot_events into groups likely representing the same real event
-- Two events are "the same event" if:
--   same period AND same game_state AND game_clock within 15 seconds (or both null)
--   AND spatial distance < 0.15 (in normalized rink coords)
--   AND same for_or_against
create or replace function public._events_are_same(a public.shot_events, b public.shot_events)
returns boolean language plpgsql immutable as $$
declare
  spatial_dist numeric;
  clock_diff integer;
begin
  if a.period <> b.period then return false; end if;
  if a.game_state <> b.game_state then return false; end if;
  if a.for_or_against <> b.for_or_against then return false; end if;

  -- Time proximity
  if a.game_clock_seconds is not null and b.game_clock_seconds is not null then
    clock_diff := abs(a.game_clock_seconds - b.game_clock_seconds);
    if clock_diff > 15 then return false; end if;
  end if;

  -- Spatial proximity (only check if both have coords)
  if a.rink_x is not null and b.rink_x is not null then
    spatial_dist := sqrt(power(a.rink_x - b.rink_x, 2) + power(a.rink_y - b.rink_y, 2));
    if spatial_dist > 0.15 then return false; end if;
  end if;

  return true;
end;
$$;

-- Main reconciliation function. Called when a game is marked complete.
create or replace function public.reconcile_game(p_game_id uuid)
returns table(consensus_count integer, disputed_count integer)
language plpgsql security definer as $$
declare
  v_observer_count integer;
  v_clusters jsonb := '[]'::jsonb;
  v_cluster_id integer := 0;
  v_consensus_count integer := 0;
  v_disputed_count integer := 0;
  rec record;
  cluster_rec record;
begin
  -- Count observers
  select count(*) into v_observer_count
  from public.game_observations where game_id = p_game_id;

  if v_observer_count = 0 then
    return query select 0, 0;
    return;
  end if;

  -- Wipe prior consensus for this game (idempotent reconciliation)
  delete from public.consensus_events where game_id = p_game_id;

  -- Build temp clustering table
  create temp table _cluster_assignments (
    event_id uuid primary key,
    cluster_id integer,
    scorer_user_id uuid,
    trust numeric(4,3)
  ) on commit drop;

  -- Greedy clustering: walk events in chronological order, assign to existing cluster or new one
  for rec in
    select se.*, go.scorer_user_id, go.scorer_trust_at_time as trust
    from public.shot_events se
    join public.game_observations go on go.id = se.observation_id
    where go.game_id = p_game_id
    order by se.period, coalesce(se.game_clock_seconds, 0) desc, se.logged_at
  loop
    declare
      v_assigned_cluster integer := null;
      cand record;
    begin
      -- Try to match against existing clusters (one event per scorer per cluster)
      for cand in
        select ca.cluster_id, ca.event_id
        from _cluster_assignments ca
        where ca.cluster_id not in (
          select cluster_id from _cluster_assignments where scorer_user_id = rec.scorer_user_id
        )
      loop
        declare
          other public.shot_events;
          self public.shot_events;
        begin
          select * into other from public.shot_events where id = cand.event_id;
          select * into self from public.shot_events where id = rec.id;
          if public._events_are_same(self, other) then
            v_assigned_cluster := cand.cluster_id;
            exit;
          end if;
        end;
      end loop;

      if v_assigned_cluster is null then
        v_cluster_id := v_cluster_id + 1;
        v_assigned_cluster := v_cluster_id;
      end if;

      insert into _cluster_assignments(event_id, cluster_id, scorer_user_id, trust)
      values (rec.id, v_assigned_cluster, rec.scorer_user_id, rec.trust);
    end;
  end loop;

  -- For each cluster, compute trust-weighted consensus
  for cluster_rec in
    select cluster_id from _cluster_assignments group by cluster_id
  loop
    declare
      v_agreement numeric;
      v_total_trust numeric;
      v_modal_outcome text;
      v_modal_zone integer;
      v_modal_modifier text;
      v_avg_x numeric;
      v_avg_y numeric;
      v_avg_clock integer;
      v_period integer;
      v_game_state text;
      v_for_or_against text;
      v_obs_count integer;
      v_event_ids uuid[];
      v_disputed boolean;
    begin
      -- Total trust in this cluster
      select sum(trust) into v_total_trust
      from _cluster_assignments where cluster_id = cluster_rec.cluster_id;

      -- Trust-weighted modal outcome
      select se.outcome into v_modal_outcome
      from _cluster_assignments ca
      join public.shot_events se on se.id = ca.event_id
      where ca.cluster_id = cluster_rec.cluster_id
      group by se.outcome
      order by sum(ca.trust) desc
      limit 1;

      -- Trust-weighted modal zone (only if it's a goal-ish event)
      select se.net_zone into v_modal_zone
      from _cluster_assignments ca
      join public.shot_events se on se.id = ca.event_id
      where ca.cluster_id = cluster_rec.cluster_id and se.net_zone is not null
      group by se.net_zone
      order by sum(ca.trust) desc
      limit 1;

      -- Trust-weighted modal modifier
      select se.shot_modifier into v_modal_modifier
      from _cluster_assignments ca
      join public.shot_events se on se.id = ca.event_id
      where ca.cluster_id = cluster_rec.cluster_id and se.shot_modifier is not null
      group by se.shot_modifier
      order by sum(ca.trust) desc
      limit 1;

      -- Trust-weighted spatial average
      select
        sum(se.rink_x * ca.trust) / nullif(sum(ca.trust * (case when se.rink_x is not null then 1 else 0 end)), 0),
        sum(se.rink_y * ca.trust) / nullif(sum(ca.trust * (case when se.rink_y is not null then 1 else 0 end)), 0),
        round(avg(se.game_clock_seconds))::integer,
        max(se.period),
        max(se.game_state),
        max(se.for_or_against),
        count(distinct ca.scorer_user_id),
        array_agg(ca.event_id)
      into v_avg_x, v_avg_y, v_avg_clock, v_period, v_game_state, v_for_or_against, v_obs_count, v_event_ids
      from _cluster_assignments ca
      join public.shot_events se on se.id = ca.event_id
      where ca.cluster_id = cluster_rec.cluster_id;

      -- Agreement score: trust-weighted fraction of observers who picked the modal outcome
      select coalesce(sum(ca.trust), 0) / nullif(v_total_trust, 0) into v_agreement
      from _cluster_assignments ca
      join public.shot_events se on se.id = ca.event_id
      where ca.cluster_id = cluster_rec.cluster_id and se.outcome = v_modal_outcome;

      -- Single-observer events get a baseline 0.5 confidence
      if v_obs_count = 1 then
        v_agreement := 0.5;
      end if;

      v_disputed := v_agreement < 0.6;
      if v_disputed then v_disputed_count := v_disputed_count + 1; end if;

      insert into public.consensus_events (
        game_id, period, game_state, game_clock_seconds,
        rink_x, rink_y, net_zone,
        for_or_against, outcome, shot_modifier,
        observer_count, agreement_score, contributing_event_ids, is_disputed
      ) values (
        p_game_id, v_period, v_game_state, v_avg_clock,
        v_avg_x, v_avg_y, v_modal_zone,
        v_for_or_against, v_modal_outcome, v_modal_modifier,
        v_obs_count, round(v_agreement::numeric, 3), v_event_ids, v_disputed
      );

      v_consensus_count := v_consensus_count + 1;
    end;
  end loop;

  -- Mark game as reconciled
  update public.games
  set status = case when v_disputed_count > 0 then 'disputed' else 'reconciled' end,
      reconciled_at = now()
  where id = p_game_id;

  return query select v_consensus_count, v_disputed_count;
end;
$$;
