# Supabase Migrations

Source of truth for the 44 Shots Postgres schema. These files mirror the migrations applied to the production Supabase project (`qshgschhudiryjnslzof`, region us-west-2).

## Why this exists

Until 2026-05-07 the schema lived only in the Supabase dashboard. If the project were lost or had to be rebuilt, there was no canonical source. This directory closes that gap — the database can be reproduced from git.

## File format

Files follow Supabase CLI convention: `<UTC timestamp>_<snake_case_name>.sql`. Files are applied in lexicographic order, which matches chronological order because the timestamp prefix sorts cleanly.

## Current migrations (10 files)

| # | Filename | Purpose |
|---|----------|---------|
| 01 | `20260504015451_01_who_layer_profiles_teams_goalies.sql` | Identity tables: `profiles`, `teams`, `goalies`, `team_goalies`, `team_members`. Auth trigger to auto-create profile rows. |
| 02 | `20260504015521_02_what_layer_games_shots_observations.sql` | Event tables: `games`, `game_observations`, `shot_events`, `consensus_events`. |
| 03 | `20260504015533_03_trust_audit_layer.sql` | `trust_history` audit table. |
| 04 | `20260504015616_04_reconciliation_engine.sql` | `reconcile_game()` function — multi-observer consensus algorithm. |
| 05 | `20260504015644_05_trust_update_engine.sql` | Trust v1 (`update_trust_after_reconciliation` + `finalize_game`). |
| 06 | `20260504015712_06_row_level_security.sql` | RLS enable + all policies + helper functions (`is_team_member`, `is_team_coach`). |
| 07 | `20260504020335_07_trust_v2_goal_attendance.sql` | Trust v2 — replaces the v1 function with goal-attendance-weighted formula. |
| 08 | `20260504021244_08_trust_v3_anomaly_vs_variance.sql` | Trust v3 (current production). Anomaly vs variance model. **This is the active version.** |
| 09 | `20260506195405_allow_anon_signup_nullable_email.sql` | V3.0 anonymous sign-in fix: `profiles.email` is nullable, `handle_new_user` trigger is null-safe. |
| 10 | `20260506195447_allow_anon_signup_nullable_email.sql` | Byte-identical replay of #09. Both ALTER and CREATE OR REPLACE are idempotent so this was a no-op when applied. Preserved here for exact parity with production deploy history. |

## Restoring from these files

If the Supabase project is ever lost:

1. Create a new Supabase project with the same Postgres major version (17).
2. Apply migrations in order: `psql $DATABASE_URL -f 20260504015451_01_who_layer_profiles_teams_goalies.sql`, then 02, 03, etc.
3. Restore data from a backup (these files only define schema, not data).

## Updating going forward

When making schema changes, do them through the Supabase dashboard SQL editor as before, then export them to this directory:

1. Run: `SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 5;` against production.
2. Pull the new migration body via `SELECT statements FROM supabase_migrations.schema_migrations WHERE version = '<NEW_VERSION>';`.
3. Save as `supabase/migrations/<version>_<name>.sql` with the same name.
4. Commit.

A future Step 4+ improvement: install the Supabase CLI and use `supabase db pull` to automate this. Out of scope for the foundation-hardening sprint.

## Known schema debt (not blocking)

- The `nomos_*` tables (NOMOS-tier scaffolded for future cross-app architecture) are present but empty (0 rows). Decision pending whether they remain or get dropped — see Tim's Notion task: "Schema unification: pre-V3.0 profiles/games/shot_events vs nomos_*".
- `teams`, `team_goalies`, `team_members` tables are present but unused at 5–10 user beta scale. Will be activated when team sharing UI ships.
- Migrations #09 and #10 share a name. Harmless, but if it confuses future tooling, the cleaner long-term fix is a new migration that DROP/CREATEs each, with a unique name.
