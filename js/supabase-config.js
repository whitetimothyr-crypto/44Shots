// js/supabase-config.js - 44 Shots Supabase project identifiers
//
// Originally at index.html line 4308 (pre-refactor) / line 3034-3035 (post-3c)
// inside hydrateFromMeshIfEmpty. Relocated per the Step 3 brief; values kept
// inline (publishable / anon key is safe in client code -- Supabase RLS is
// what protects rows).
//
// Top-level classic script -- no IIFE wrapper -- so SB_URL and SB_KEY are
// script-scope globals visible to the main inline <script> and to the other
// /js modules that load after this one in index.html (only the main inline
// reads these; the /js/auth.js, /js/game.js, /js/sync.js modules carry
// their own internal SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY copies inside
// their IIFE wrappers and are intentionally NOT touched here -- byte-for-
// byte rule, follow-up dedupe deferred to a separate refactor).
//
// Load order: must load BEFORE the main inline <script> in index.html so
// SB_URL and SB_KEY are in scope when hydrateFromMeshIfEmpty fires
// (lazy -- user clicks Generate Report). The script tag sits with the other
// pre-main /js modules (settings-engine, game-engine).

const SB_URL = "https://qshgschhudiryjnslzof.supabase.co";
const SB_KEY = "sb_publishable_hdrc9mYaGocDhJVesn0FRw_wELl6Tnv";
