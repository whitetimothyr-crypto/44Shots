# 44 Shots Tests

Playwright end-to-end tests. Currently smoke-only. Designed to validate the production deployment after every push to `main`.

## What's tested

### `smoke.spec.ts`

A single smoke test that exercises the critical-path bootstrap:

1. **Page loads** — HTML responds, title matches `/44 Shots/i`
2. **Sentry SDK initialized** — `window.Sentry` is an object (loader script ran, error tracking active)
3. **FelixAuth wrapper loaded** — Supabase client wired up
4. **Anonymous signup completes** — clicks "Continue as Guest", round-trips to Supabase, the `handle_new_user` trigger fires, profile row created, RLS allows the read
5. **UI reflects signed-in state** — `#topAccountBtn` shows "GUEST", modal flips to signed-in view
6. **No unexpected console errors** during the flow

If this test passes, the entire auth + database stack is healthy. Catches: TDZ bugs, broken Supabase migrations, RLS misconfigurations, missing globals, environment misconfigurations, broken `handle_new_user` trigger.

Does not catch: rink UI bugs, period segment bugs, shot-logging logic, report generation. Those need their own tests.

## Running locally

```bash
# Install once
npm install
npx playwright install chromium

# Run tests against production (44shots.com)
npm test

# Run against a local server
BASE_URL=http://localhost:8080 npm test

# Watch mode with UI for development
npm run test:ui

# Headed (watch the browser)
npm run test:headed

# Debug a specific failure
npm run test:debug

# Open the last HTML report
npm run test:report
```

## CI

Runs on every push to `main` and every PR to `main`. The workflow:

1. Waits 60s for Vercel to finish deploying the pushed commit
2. Boots Chromium in headless mode
3. Runs the smoke test against `44shots.com`
4. Uploads `playwright-report/` as an artifact (30-day retention) on failure

If the test fails, the GitHub commit shows a red ✗ and the artifact contains screenshots, traces, and HTML reports for debugging.

## Adding tests

Place new specs in `tests/`. Naming convention: `<area>.spec.ts`. Keep tests independent — Playwright runs them in parallel locally. Use `getByRole()` over CSS selectors when possible (more resilient to DOM refactors). Avoid hardcoding URLs — use `baseURL` from config.

## Known limitations

- Single-browser (Chromium) for now. Add Firefox/WebKit in `playwright.config.ts` when iOS app ships.
- Tests run against live production. There is no preview/staging environment yet — that's a separate Step in the foundation-hardening plan.
- Anonymous signup creates real auth users in the production Supabase project. They accumulate but are harmless. Cleanup is a future concern (cron job to prune anon users >30 days old).
