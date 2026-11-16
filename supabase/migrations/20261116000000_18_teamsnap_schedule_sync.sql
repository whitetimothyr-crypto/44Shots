-- Migration 18: TeamSnap iCal -> nomos_game schedule sync + public schedule read
--
-- Why: the Calendar tab read nomos_game rows that were seeded once by hand
-- (2026-05-10) and went stale (tournament dates moved, new games missing).
-- This keeps the schedule in sync with TeamSnap automatically:
--   * sync_team_schedule(team)  fetches teams.ical_url, parses VEVENTs whose
--     SUMMARY is a game ("<us> vs <opp>" / "<us> at <opp>"), inserts new
--     future games with the next game code (BGBYG14B-0009 ...), updates
--     moved/renamed future games, archives future games deleted in TeamSnap.
--     Mapping lives in external_id_map (external_system = 'teamsnap_ical').
--   * get_team_schedule(team)   the Calendar's read path. Runs the sync when
--     the last one is older than 30 minutes, then returns upcoming games.
--     SECURITY DEFINER so signed-out visitors can see the schedule without
--     an auth session (nomos_game SELECT is authenticated-only).
--   * pg_cron runs a forced sync daily at 10:17 UTC.
-- Practices and team events are ignored (no " vs " / " at " in SUMMARY).
-- Past games are never touched.

create extension if not exists http with schema extensions;
create extension if not exists pg_cron;

alter table public.teams add column if not exists schedule_synced_at timestamptz;
alter table public.nomos_game add column if not exists scheduled_start timestamptz;

comment on column public.nomos_game.scheduled_start is
  'Start time from TeamSnap (NULL for all-day / tournament placeholders). Set by sync_team_schedule.';

create or replace function public.sync_team_schedule(p_team_name text default 'Biggby Black', p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_team public.teams%rowtype;
  v_prefix text;
  v_display text;
  v_today date := (now() at time zone 'America/New_York')::date;
  v_resp extensions.http_response;
  v_body text;
  v_block text;
  v_uid text;
  v_start text;
  v_summary text;
  v_loc text;
  v_desc text;
  v_venue text;
  v_rink text;
  v_ts timestamptz;
  v_date date;
  v_opp text;
  v_m text[];
  v_game_id uuid;
  v_code text;
  v_next int;
  v_seen text[] := '{}';
  n_ins int := 0;
  n_upd int := 0;
  n_arch int := 0;
begin
  select m.prefix, m.display into v_prefix, v_display
  from (values ('Biggby Black', 'BGBYG14B', 'Biggby Black 14U'),
               ('Plymouth Phantoms', 'PLYM', 'Plymouth Phantoms')) as m(team, prefix, display)
  where m.team = p_team_name;
  if v_prefix is null then
    return jsonb_build_object('ok', false, 'error', 'unknown_team');
  end if;

  select * into v_team from public.teams where name = p_team_name order by created_at limit 1;
  if v_team.id is null or v_team.ical_url is null then
    return jsonb_build_object('ok', false, 'error', 'no_ical');
  end if;
  if not p_force and v_team.schedule_synced_at is not null
     and v_team.schedule_synced_at > now() - interval '30 minutes' then
    return jsonb_build_object('ok', true, 'skipped', 'fresh', 'synced_at', v_team.schedule_synced_at);
  end if;

  update public.teams set schedule_synced_at = now() where id = v_team.id;

  begin
    perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '8000');
    v_resp := extensions.http_get(replace(v_team.ical_url, 'http://', 'https://'));
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'fetch_failed: ' || sqlerrm);
  end;
  if v_resp.status <> 200 then
    return jsonb_build_object('ok', false, 'error', 'http_' || v_resp.status);
  end if;

  -- Unfold iCal continuation lines (CRLF + single space).
  v_body := replace(replace(v_resp.content, E'\r\n', E'\n'), E'\n ', '');

  for v_block in select (regexp_matches(v_body, 'BEGIN:VEVENT\n(.*?)END:VEVENT', 'g'))[1] loop
    v_uid     := substring(v_block from '(?:^|\n)UID:([^\n]+)');
    v_start   := substring(v_block from '(?:^|\n)DTSTART[^:\n]*:([0-9]{8}(?:T[0-9]{6})?)');
    v_summary := substring(v_block from '(?:^|\n)SUMMARY:([^\n]+)');
    v_loc     := substring(v_block from '(?:^|\n)LOCATION:([^\n]+)');
    v_desc    := substring(v_block from '(?:^|\n)DESCRIPTION:([^\n]+)');
    continue when v_uid is null or v_start is null or v_summary is null;

    v_summary := btrim(replace(replace(replace(v_summary, '\,', ','), '\;', ';'), '\n', ' '));
    v_m := regexp_match(v_summary, '^(.*?)\s+(vs\.?|at|@)\s+(.+)$', 'i');
    continue when v_m is null;  -- practice / team event, not a game
    v_opp := btrim(v_m[3]);

    if length(v_start) = 8 then
      v_date := to_date(v_start, 'YYYYMMDD');
      v_ts := null;
    else
      v_ts := (to_timestamp(v_start, 'YYYYMMDD"T"HH24MISS')::timestamp) at time zone 'America/New_York';
      v_date := (v_ts at time zone 'America/New_York')::date;
      if to_char(v_ts at time zone 'America/New_York', 'HH24MISS') = '000000' then
        v_ts := null;  -- TeamSnap all-day placeholder (tournament days)
      end if;
    end if;

    v_loc := nullif(btrim(replace(replace(replace(coalesce(v_loc, ''), '\,', ','), '\;', ';'), '\n', ', ')), '');
    v_venue := nullif(btrim(split_part(split_part(coalesce(substring(v_desc from 'Location: *(.*)$'), ''), '\n', 1), ' (Arrival', 1)), '');
    v_venue := nullif(btrim(replace(replace(coalesce(v_venue, ''), '\,', ','), '\;', ';')), '');
    v_rink := case
      when v_venue is not null and v_loc is not null and position(v_venue in v_loc) = 0 then v_venue || ' · ' || v_loc
      else coalesce(v_venue, v_loc)
    end;

    v_seen := v_seen || v_uid;
    v_game_id := null;
    select e.nomos_game_id into v_game_id
    from public.external_id_map e
    where e.external_system = 'teamsnap_ical' and e.external_id = v_uid
    order by e.mapped_at desc
    limit 1;

    if v_game_id is null then
      continue when v_date < v_today;  -- never backfill past games
      select coalesce(max(nullif(substring(g.client_game_id from '-([0-9]+)$'), '')::int), 0) + 1
        into v_next
      from public.nomos_game g
      where g.client_game_id like v_prefix || '-%';
      v_code := v_prefix || '-' || lpad(v_next::text, 4, '0');
      insert into public.nomos_game
        (match_probe, client_game_id, game_date, scheduled_start, home_team_name,
         away_team_name, rink_name, status, entry_mode, created_by)
      values
        (v_code || '_' || to_char(v_date, 'YYYY-MM-DD'), v_code, v_date, v_ts, v_display,
         v_opp, v_rink, 'scheduled', 'create', v_team.created_by)
      returning id into v_game_id;
      insert into public.external_id_map (id, nomos_game_id, external_system, external_id, confidence, mapped_at)
      values (gen_random_uuid(), v_game_id, 'teamsnap_ical', v_uid, 1, now());
      n_ins := n_ins + 1;
    else
      update public.nomos_game g set
        game_date = v_date,
        match_probe = g.client_game_id || '_' || to_char(v_date, 'YYYY-MM-DD'),
        scheduled_start = v_ts,
        away_team_name = v_opp,
        rink_name = v_rink
      where g.id = v_game_id
        and g.status = 'scheduled'
        and g.game_date > v_today
        and (g.game_date, g.scheduled_start, g.away_team_name, g.rink_name)
            is distinct from (v_date, v_ts, v_opp, v_rink);
      if found then n_upd := n_upd + 1; end if;
    end if;
  end loop;

  -- Future scheduled games that were deleted in TeamSnap -> archived.
  if coalesce(array_length(v_seen, 1), 0) > 0 then
    update public.nomos_game g set status = 'archived'
    from public.external_id_map e
    where e.nomos_game_id = g.id
      and e.external_system = 'teamsnap_ical'
      and g.status = 'scheduled'
      and g.game_date > v_today
      and g.home_team_name = v_display
      and not (e.external_id = any (v_seen));
    get diagnostics n_arch = row_count;
  end if;

  return jsonb_build_object('ok', true, 'inserted', n_ins, 'updated', n_upd,
                            'archived', n_arch, 'feed_events', coalesce(array_length(v_seen, 1), 0));
end;
$$;

create or replace function public.get_team_schedule(p_team_name text default 'Biggby Black', p_sync boolean default true)
returns table (id uuid, code text, game_date date, scheduled_start timestamptz,
               home_team_name text, away_team_name text, rink_name text, status text)
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_display text;
  v_today date := (now() at time zone 'America/New_York')::date;
begin
  select m.display into v_display
  from (values ('Biggby Black', 'Biggby Black 14U'),
               ('Plymouth Phantoms', 'Plymouth Phantoms')) as m(team, display)
  where m.team = p_team_name;
  if v_display is null then
    return;
  end if;
  if p_sync then
    begin
      perform public.sync_team_schedule(p_team_name, false);
    exception when others then
      null;  -- schedule read must never fail because TeamSnap is down
    end;
  end if;
  return query
    select g.id, g.client_game_id, g.game_date, g.scheduled_start,
           g.home_team_name, g.away_team_name, g.rink_name, g.status
    from public.nomos_game g
    where g.home_team_name = v_display
      and g.game_date >= v_today
      and g.status in ('scheduled', 'in_progress')
    order by g.game_date, g.scheduled_start nulls first
    limit 50;
end;
$$;

revoke all on function public.sync_team_schedule(text, boolean) from public, anon, authenticated;
revoke all on function public.get_team_schedule(text, boolean) from public;
grant execute on function public.get_team_schedule(text, boolean) to anon, authenticated;

-- Daily forced sync (idempotent re-schedule).
select cron.unschedule(jobid) from cron.job where jobname = 'teamsnap-schedule-sync';
select cron.schedule('teamsnap-schedule-sync', '17 10 * * *',
  $cron$select public.sync_team_schedule('Biggby Black', true)$cron$);
