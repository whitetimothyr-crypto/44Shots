# Migration: Single-File Monolith to Next.js

Tracks rebrand and architectural migration of 44Shots from a single-file
HTML/JS monolith (`index.html`) to a Next.js 16 App Router application.

Branch: `feature/nextjs-tracking-loop` -> `main`

## Routing

| Path           | Handler                                                    |
| -------------- | ---------------------------------------------------------- |
| `/`            | Next.js App Router (`src/app/page.tsx` -> `ShotCanvas`)    |
| `/_not-found`  | Next.js default 404                                        |

Production `/` route now renders `<ShotCanvas />` from
`src/components/features/ShotCanvas.tsx`, backed by `useShotTracker`
(`src/hooks/useShotTracker.ts`) and Supabase sync via
`src/lib/sync-worker.ts`.

## Legacy Monolith Access

Legacy `index.html` lives at repo root. With Next.js owning routing,
that file is NOT auto-served. No `public/` directory exists on this
branch, so a request to `/index.html` returns 404.

Treat `index.html` as archived source for this PR. If runtime access
is ever required, options are:

1. Move file to `public/index.html` so Next.js serves it as a static asset.
2. Add a rewrite in `next.config.*` mapping `/legacy` to a custom handler.
3. Spin a separate Vercel project pointing at a `legacy/` directory.

None of these are wired in this PR.

## Data Layer

- IndexedDB: `felix_db` v2, same schema as legacy `js/db.js`
  (stores: `submission_queue`, `game_archive`, `auth_session`, `media`).
- Submission queue: rows persisted via `src/lib/indexed-db.ts`, drained
  by `src/lib/sync-worker.ts` on mount and on `window.online` events.
- Cloud: `nomos_submission` + `nomos_event` (Supabase project ref
  `qshgschhudiryjnslzof`). Idempotency on `nomos_submission.id` via
  upsert with `onConflict: "id"`.

Schema parity preserved so a SwiftData V4.0 port can mirror these
shapes 1:1.

## Build and Deploy

- Local: `npm run build` (Next.js 16 / Turbopack).
- Vercel: inherits Next.js defaults. `vercel.json` carries only domain
  redirects (`felix-tracker-nu.vercel.app` and `www.44shots.com` both
  redirect 301 to apex `44shots.com`).
- Build verified green on `feature/nextjs-tracking-loop`:
  3 static pages, TypeScript clean, no warnings.

## Env Vars

Required for cloud sync (set in Vercel project settings):

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

Phase 7 sync-worker lazy-imports `@/lib/supabase` inside `processQueue`
so SSR prerender does not crash when env vars are absent at build time.

## Rollback

If a regression surfaces post-merge:

1. Revert merge commit on `main`.
2. Legacy `index.html` was untouched on this branch and remains a
   source-of-truth snapshot for behaviour before migration.
3. Vercel previous deployment can also be promoted via Vercel UI for
   an immediate revert without git activity.
