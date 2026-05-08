# 44 Shots — Tier 1 Audit Runner

Machine-checkable audits that pass or fail with specific findings. No AI judgment, no interpretation. Run locally or in CI on every push to main.

## What runs

| Audit | Tool | What it catches |
|---|---|---|
| Accessibility | axe-core via Playwright | WCAG 2.1 AA violations (critical + serious): missing alt text, unlabeled inputs, color contrast below 4.5:1, ARIA mismatches |
| Security | Custom Playwright spec | Exposed secrets in client bundle, missing security headers (HSTS, X-Frame-Options, etc.), mixed content (http on https), Sentry placeholder DSN |
| Lighthouse | Lighthouse CI | Performance, accessibility, best practices, SEO scored against thresholds |

## How to run locally

Prerequisite: run `npm install` and `npx playwright install chromium` once after pulling.

Single audit:

    npm run audit:security
    npm run audit:a11y
    npm run audit:lighthouse

All three sequentially:

    npm run audit:all

Default target is https://44shots.com. Override with AUDIT_BASE_URL:

    AUDIT_BASE_URL=https://staging.44shots.com npm run audit:a11y

## How it runs in CI

GitHub Actions workflow at `.github/workflows/audit-suite.yml`. Triggers:

- Every push to `main`
- Every PR targeting `main`
- Weekly cron: Monday 9am ET
- Manual via GitHub UI (Actions tab → Audit Suite → Run workflow)

All 3 audits run in parallel. Results upload as artifacts (30-day retention), accessible from the Actions tab.

## Thresholds

### Accessibility (HARD FAIL)
- Zero critical or serious WCAG 2.1 AA violations on homepage
- Zero critical or serious violations on signin modal
- Zero color contrast violations on rink tab

### Security (HARD FAIL)
- Zero exposed secrets matching pattern library (AWS, GitHub, Stripe, OpenAI, Anthropic, Google, Supabase service role)
- Required headers present: Strict-Transport-Security, X-Content-Type-Options, X-Frame-Options, Referrer-Policy
- Zero mixed content (http resources on https page)
- Sentry DSN initialized and not a placeholder

### Lighthouse (mixed)
- HARD FAIL: accessibility < 90, console errors present, vulnerable libraries detected, HTTPS misconfigured
- WARN: performance < 70, best practices < 85, SEO < 80

## Interpreting failures

### A11y violation
Output includes rule ID (e.g. `color-contrast`), affected DOM nodes, and a help URL. Fix the actual element. Do not suppress the rule.

### Security: exposed secret
Triple-check the match is real before assuming a leak. The AWS Secret Key pattern (40-char base64) has false positives. If real: rotate the key immediately, audit git history with `git log -S "leaked-key"`, force-push history rewrite if needed. If false positive: narrow the regex in `audit-tests/security.spec.ts`.

### Security: missing header
Add the four required headers to `vercel.json` under a `headers` block matching source `/(.*)`. Required values:
- Strict-Transport-Security: max-age=31536000; includeSubDomains
- X-Content-Type-Options: nosniff
- X-Frame-Options: DENY
- Referrer-Policy: strict-origin-when-cross-origin

### Lighthouse: perf below threshold
Check the artifact HTML report (downloadable from GitHub Actions). Common causes: large unoptimized images, render-blocking JS, no caching headers on static assets.

## Adding new audits

1. Add a Playwright spec to `audit-tests/`
2. Add an `audit:<name>` script to `package.json`
3. Add a job to `.github/workflows/audit-suite.yml`
4. Add a row to the table at the top of this doc

## What this does NOT cover

These are Tier 1 audits — automated, deterministic. They do not cover:

- UX heuristics (Nielsen, Shneiderman, Fogg) → Tier 2: AI multi-judge panel
- Cooper personas → Tier 3: human research required
- COPPA legal compliance → Tier 3: legal sign-off required
- Real-user telemetry (HEART) → Tier 3: requires shipped product + analytics

See `docs/audit-tier2.md` for the AI judge panel (Tier 2).

## Cost

Tier 1 is free. Lighthouse uploads to temporary public storage (no account needed). Playwright runs on standard GitHub Actions minutes (free tier covers our volume).
