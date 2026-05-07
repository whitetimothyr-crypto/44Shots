
-- ============================================================
-- 44 SHOTS — WHO LAYER
-- profiles: adults with Google accounts (parents, coaches, scorers)
-- teams: hockey teams (a goalie may belong to one or more)
-- goalies: child profiles owned by a parent (COPPA-compliant)
-- ============================================================

create extension if not exists "pgcrypto";

-- profiles: 1:1 with auth.users, holds role + trust
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  role text not null default 'scorer' check (role in ('parent','coach','scorer','admin')),
  trust_score numeric(4,3) not null default 0.500 check (trust_score >= 0 and trust_score <= 1),
  sessions_logged integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index profiles_role_idx on public.profiles(role);

-- teams: a goalie's team(s)
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  level text check (level in ('house','travel','aa','aaa','rec','high_school','other')),
  age_bracket text,           -- e.g. "U10","U12","U14","U16","U18","adult"
  organization text,          -- e.g. "Plymouth Phantoms"
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- goalies: the child athletes (under 13, parent-owned)
create table public.goalies (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  first_name text not null,
  jersey_number integer,
  catch_hand text not null default 'left' check (catch_hand in ('left','right','full_right')),
  birth_year integer not null check (birth_year >= 1980 and birth_year <= 2030),
  notes text,
  created_at timestamptz not null default now()
);

create index goalies_owner_idx on public.goalies(owner_user_id);
create index goalies_birth_year_idx on public.goalies(birth_year);

-- team_goalies: which goalies play for which teams (many-to-many; goalies can change teams seasonally)
create table public.team_goalies (
  team_id uuid not null references public.teams(id) on delete cascade,
  goalie_id uuid not null references public.goalies(id) on delete cascade,
  active boolean not null default true,
  joined_at timestamptz not null default now(),
  primary key (team_id, goalie_id)
);

-- team_members: adults associated with a team (parents, coaches, scorers)
create table public.team_members (
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  team_role text not null default 'scorer' check (team_role in ('head_coach','assistant_coach','team_parent','scorer','viewer')),
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create index team_members_user_idx on public.team_members(user_id);

-- updated_at trigger for profiles
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;

create trigger profiles_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

-- auto-create profile row when auth user is created
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();
