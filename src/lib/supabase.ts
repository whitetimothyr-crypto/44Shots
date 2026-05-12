/**
 * Supabase browser client (44 Shots / NOMOS).
 *
 * Project ref: qshgschhudiryjnslzof
 *
 * Required env vars in .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL=https://qshgschhudiryjnslzof.supabase.co
 *   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
 *
 * Auth config matches current monolith (js/auth.js + js/game.js):
 *   - persistSession=true so anonymous + authed users survive reloads
 *   - autoRefreshToken=true so long-running rink sessions stay valid
 *
 * Server-side usage (route handlers, Server Components) should import
 * a separate server client built with cookies(); this file is for
 * client-side only.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error(
    "Missing Supabase env vars. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local. Project ref: qshgschhudiryjnslzof."
  );
}

export const supabase: SupabaseClient = createClient(
  supabaseUrl,
  supabasePublishableKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  }
);

export const SUPABASE_PROJECT_REF = "qshgschhudiryjnslzof";
