-- Migration 19: per-user cloud backup of archived games.
--
-- Replaces the "Drive sync coming in v2.3" placeholder. Each ended game
-- lives in localStorage (felix-archive-v1) + IndexedDB on the device; when
-- the user is signed in with a real account (Google or email code), the
-- app also upserts each archived game here so a lost/replaced phone can
-- restore its history (Settings -> Cloud Backup -> Restore).
--
-- id = the archive snapshot's archivedAt timestamp (stringified), which is
-- already the dedupe key used by Import JSON. RLS: owner-only, all verbs.

create table if not exists public.game_backups (
  user_id    uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  id         text        not null,
  game       jsonb       not null,
  ended_at   timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  constraint game_backups_size check (octet_length(game::text) < 2000000)
);

alter table public.game_backups enable row level security;

drop policy if exists game_backups_select_own on public.game_backups;
drop policy if exists game_backups_insert_own on public.game_backups;
drop policy if exists game_backups_update_own on public.game_backups;
drop policy if exists game_backups_delete_own on public.game_backups;

create policy game_backups_select_own on public.game_backups
  for select to authenticated using (user_id = (select auth.uid()));
create policy game_backups_insert_own on public.game_backups
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy game_backups_update_own on public.game_backups
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy game_backups_delete_own on public.game_backups
  for delete to authenticated using (user_id = (select auth.uid()));

revoke all on public.game_backups from anon;
grant select, insert, update, delete on public.game_backups to authenticated;
