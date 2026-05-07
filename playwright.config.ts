import { defineConfig, devices } from '@playwright/test';

/**
 * 44 Shots Playwright config.
 *
 * Targets production (44shots.com) by default. Override with BASE_URL env var
 * for local testing. CI flags get stricter behavior — retries, no test.only,
 * traces on failure.
 *
 * Run locally:    npx playwright test
 * Run vs local:   BASE_URL=http://localhost:8080 npx playwright test
 * Run headed:     npx playwright test --headed
 * Debug:          npx playwright test --debug
 */
export default defineConfig({
  testDir: './tests',
  // Each test gets 30 seconds. Auth roundtrip should take ~3-5s.
  timeout: 30_000,
  // Each individual expect() gets 5 seconds.
  expect: { timeout: 5_000 },
  // Fail the build if anyone leaves a test.only in source.
  forbidOnly: !!process.env.CI,
  // Retry only in CI. Local failures should be deterministic and visible.
  retries: process.env.CI ? 2 : 0,
  // Number of parallel workers. CI = 1 (predictable, no flake from races).
  workers: process.env.CI ? 1 : undefined,
  // HTML reporter for local viewing, list reporter for CI logs.
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }]]
    : 'list',
  use: {
    // Production by default. Override via BASE_URL env var.
    baseURL: process.env.BASE_URL || 'https://44shots.com',
    // Capture trace only on first retry to keep storage minimal.
    trace: 'on-first-retry',
    // Screenshot only on failure.
    screenshot: 'only-on-failure',
    // No video unless something's actively flaky.
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
