
-- ============================================================
-- 44 SHOTS — TRUST AUDIT LAYER
-- Every trust adjustment gets logged for transparency + debugging
-- ============================================================

create table public.trust_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  game_id uuid references public.games(id) on delete set null,
  observation_id uuid references public.game_observations(id) on delete set null,
  -- Inputs to the trust calculation
  events_logged integer not null,
  events_in_consensus integer not null,    -- how many of their events made it to the truth
  events_disputed integer not null default 0,
  agreement_avg numeric(4,3) not null,     -- avg agreement_score across their events
  session_plausibility numeric(4,3) not null,
  -- Trust delta
  trust_before numeric(4,3) not null,
  trust_delta numeric(5,4) not null,       -- can be negative
  trust_after numeric(4,3) not null,
  learning_rate numeric(4,3) not null default 0.050,
  -- Metadata
  reason text,                              -- human-readable explanation
  computed_at timestamptz not null default now()
);

create index trust_history_user_idx on public.trust_history(user_id, computed_at desc);
create index trust_history_game_idx on public.trust_history(game_id);
