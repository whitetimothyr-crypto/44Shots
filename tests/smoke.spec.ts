import { test, expect } from '@playwright/test';

/**
 * 44 Shots smoke test.
 *
 * Validates the critical-path bootstrap of the app:
 *   1. Page loads without console errors blocking init
 *   2. Sentry SDK is reachable on window
 *   3. Supabase client is reachable on window (FelixAuth wrapper exists)
 *   4. Anonymous signup completes (round-trips to Supabase, creates auth user,
 *      handle_new_user trigger fires, profile row created, RLS allows the read)
 *   5. UI reflects signed-in state ("GUEST" appears)
 *
 * If this test passes, the entire auth + database stack is healthy. If it
 * fails, you've broken something fundamental — do not deploy.
 */

test.describe('44 Shots smoke', () => {
  test('page loads, SDKs initialize, anonymous signup works', async ({ page }) => {
    // Track console errors. We expect ZERO during boot.
    // (We allow expected Sentry tracing warning — it's a known config quirk.)
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        // Filter known-benign noise:
        if (text.includes('browserTracingIntegration')) return; // Sentry config warning
        if (text.includes('favicon')) return; // favicon 404 is harmless
        consoleErrors.push(text);
      }
    });

    // ===== 1. Page loads =====
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Page title check — fast sanity that we got the right HTML.
    await expect(page).toHaveTitle(/44 Shots/i);

    // ===== 2. Sentry initialized =====
    // Loader script is async — give it up to 5s to wire up.
    await expect.poll(
      async () => await page.evaluate(() => typeof (window as any).Sentry),
      { timeout: 5_000, message: 'Sentry SDK should be loaded on window' }
    ).toBe('object');

    // ===== 3. Supabase + FelixAuth wrapper =====
    await expect.poll(
      async () => await page.evaluate(() => typeof (window as any).FelixAuth),
      { timeout: 5_000, message: 'FelixAuth wrapper should be loaded on window' }
    ).toBe('object');

    // ===== 4. Anonymous signup =====
    // Open the account modal. The top-right button reads "SIGN IN" when signed
    // out. We click it to open the modal.
    await page.locator('#topAccountBtn').click();

    // Modal should be visible. The "Continue as Guest" button is the path we
    // exercise — it calls FelixAuth.signInAnonymously() → Supabase auth.
    const guestButton = page.locator('#accountAnonBtn');
    await expect(guestButton).toBeVisible({ timeout: 3_000 });
    await guestButton.click();

    // ===== 5. UI reflects signed-in state =====
    // After successful anonymous signup, the modal flips from #accountSignedOut
    // to #accountSignedIn, and the email field shows "Guest (no account)".
    // We wait up to 10s — anonymous signup is normally <2s but allow headroom.
    await expect(page.locator('#accountUserEmail')).toContainText(
      /Guest/i,
      { timeout: 10_000 }
    );

    // The top button should now read "GUEST" (per the role label logic).
    await expect(page.locator('#topAccountBtn')).toHaveText(
      /GUEST/i,
      { timeout: 5_000 }
    );

    // ===== Final check: no unexpected console errors during the whole flow =====
    expect(
      consoleErrors,
      `Unexpected console errors during boot: ${consoleErrors.join('\n')}`
    ).toEqual([]);
  });
});
