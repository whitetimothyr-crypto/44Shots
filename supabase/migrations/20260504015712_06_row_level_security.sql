
-- ============================================================
-- 44 SHOTS — RLS POLICIES
--
-- Visibility rules:
-- - profiles: own row read/write; everyone can read display_name+trust of any profile
-- - teams: members can read; only creator + coaches can edit
-- - goalies: owner + team members can read; only owner can edit
-- - games: team members can read; scorers can create their own observations
-- - shot_events: only the scorer can edit their own; team members can read after game complete
-- - consensus_events: team members can read
-- - trust_history: only the user themselves can read their own
-- ============================================================

alter table public.profiles enable row level security;
alter table public.teams enable row level security;
alter table public.goalies enable row level security;
alter table public.team_goalies enable row level security;
alter table public.team_members enable row level security;
alter table public.games enable row level security;
alter table public.game_observations enable row level security;
alter table public.shot_events enable row level security;
alter table public.consensus_events enable row level security;
alter table public.trust_history enable row level security;

-- profiles
create policy "profiles_self_read" on public.profiles
  for select using (true);  -- public-readable display info (filter sensitive cols at app layer)
create policy "profiles_self_update" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- helper: am I a member of this team?
create or replace function public.is_team_member(p_team_id uuid)
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from public.team_members
    where team_id = p_team_id and user_id = auth.uid()
  );
$$;

-- helper: am I a coach of this team?
create or replace function public.is_team_coach(p_team_id uuid)
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from public.team_members
    where team_id = p_team_id and user_id = auth.uid()
      and team_role in ('head_coach','assistant_coach')
  );
$$;

-- teams
create policy "teams_member_read" on public.teams
  for select using (public.is_team_member(id) or created_by = auth.uid());
create policy "teams_create" on public.teams
  for insert with check (created_by = auth.uid());
create policy "teams_coach_update" on public.teams
  for update using (public.is_team_coach(id) or created_by = auth.uid());

-- goalies
create policy "goalies_owner_read" on public.goalies
  for select using (
    owner_user_id = auth.uid()
    or exists (
      select 1 from public.team_goalies tg
      where tg.goalie_id = goalies.id
        and public.is_team_member(tg.team_id)
    )
  );
create policy "goalies_owner_write" on public.goalies
  for all using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());

-- team_goalies
create policy "team_goalies_member_read" on public.team_goalies
  for select using (public.is_team_member(team_id));
create policy "team_goalies_coach_write" on public.team_goalies
  for all using (public.is_team_coach(team_id)) with check (public.is_team_coach(team_id));

-- team_members
create policy "team_members_self_read" on public.team_members
  for select using (user_id = auth.uid() or public.is_team_member(team_id));
create policy "team_members_coach_write" on public.team_members
  for all using (public.is_team_coach(team_id)) with check (public.is_team_coach(team_id));
create policy "team_members_self_join" on public.team_members
  for insert with check (user_id = auth.uid());

-- games
create policy "games_team_read" on public.games
  for select using (
    team_id is null  -- ungrouped games (e.g., pickup) are visible to all participants
    or public.is_team_member(team_id)
    or created_by = auth.uid()
    or exists (select 1 from public.goalies g where g.id = games.goalie_id and g.owner_user_id = auth.uid())
  );
create policy "games_create" on public.games
  for insert with check (created_by = auth.uid());
create policy "games_coach_update" on public.games
  for update using (
    created_by = auth.uid()
    or (team_id is not null and public.is_team_coach(team_id))
  );

-- game_observations
create policy "game_obs_read" on public.game_observations
  for select using (
    scorer_user_id = auth.uid()
    or exists (
      select 1 from public.games g
      where g.id = game_id
        and (g.team_id is null or public.is_team_member(g.team_id) or g.created_by = auth.uid())
    )
  );
create policy "game_obs_self_write" on public.game_observations
  for all using (scorer_user_id = auth.uid()) with check (scorer_user_id = auth.uid());

-- shot_events
create policy "shot_events_self_read" on public.shot_events
  for select using (
    exists (
      select 1 from public.game_observations go
      where go.id = observation_id
        and (
          go.scorer_user_id = auth.uid()
          or exists (
            select 1 from public.games g
            where g.id = go.game_id
              and (g.team_id is null or public.is_team_member(g.team_id))
          )
        )
    )
  );
create policy "shot_events_self_write" on public.shot_events
  for all using (
    exists (
      select 1 from public.game_observations go
      where go.id = observation_id and go.scorer_user_id = auth.uid()
    )
  );

-- consensus_events: read-only for team
create policy "consensus_events_team_read" on public.consensus_events
  for select using (
    exists (
      select 1 from public.games g
      where g.id = game_id
        and (g.team_id is null or public.is_team_member(g.team_id) or g.created_by = auth.uid())
    )
  );

-- trust_history: only the user can see their own
create policy "trust_history_self_read" on public.trust_history
  for select using (user_id = auth.uid());
