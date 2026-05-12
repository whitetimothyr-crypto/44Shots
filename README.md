# 44Shots

Youth hockey shot tracker. Production at https://44shots.com.

Single-file vanilla HTML/JS PWA, Supabase backend, Vercel deploy. 
Multi-observer consensus reconciliation with trust-weighted scoring.

## Status

V3.0 in active development. Foundation hardening sprint shipped 2026-05-07:
Sentry observability, schema versioned in git, Playwright + GitHub Actions CI,
idempotency keys at game and shot level.

See `docs/` and Notion 44Shots project for module specs and design docs.

## Local dev

```bash
npm install
npx playwright install chromium
npm test
```

## Tests

Smoke test runs on every push and PR to main. See `.github/workflows/playwright.yml`
and `tests/README.md`.
