import { test, expect } from '@playwright/test';

/**
 * v3.1 modules: Calendar (TeamSnap schedule), Feed, Profile, cloud backup.
 *
 * Asserts:
 *   - MORE -> Calendar shows the panel on the FIRST open (regression: the
 *     panel used to be created after switchTab and rendered blank)
 *   - Calendar settles on rows, an empty state or an error with Retry,
 *     never an endless "Loading"
 *   - MORE -> Profile and MORE -> Feed render real modules
 *   - No "coming soon" / "Coming in v2.3" placeholder text remains
 *   - Share QR renders locally as a data: URL (Google Charts QR is dead)
 *   - Account modal offers Google sign-in
 */

async function dismissModals(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    for (const id of ['whatsNewBackdrop', 'loadGameModal', 'joinGameBackdrop']) {
      const el = document.getElementById(id) as HTMLElement | null;
      if (el) el.style.display = 'none';
    }
  });
}

async function openMore(page: import('@playwright/test').Page, dest: string) {
  await page.click('nav.bottom-nav button[data-tab="more"]');
  await page.click(`#panel-more [data-more="${dest}"]`);
}

test.describe('v3.1 modules', () => {
  test.use({ viewport: { width: 414, height: 896 } });

  test('Calendar is visible on first open and settles', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    await dismissModals(page);
    await openMore(page, 'calendar');
    await expect(page.locator('#panel-calendar')).toHaveClass(/active/);
    await expect(page.locator('#panel-calendar .calendar-root')).toBeVisible();
    await expect(page.locator('#panel-calendar .calendar-row, #panel-calendar .calendar-empty:not(:has-text("Loading"))').first())
      .toBeVisible({ timeout: 15_000 });
  });

  test('Profile and Feed render real modules', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    await dismissModals(page);
    await openMore(page, 'profile');
    await expect(page.locator('#panel-profile')).toHaveClass(/active/);
    await expect(page.locator('#panel-profile .profile-card').first()).toBeVisible({ timeout: 10_000 });
    await openMore(page, 'feed');
    await expect(page.locator('#panel-feed .feed-root')).toBeVisible();
  });

  test('no placeholder text remains', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    const html = await page.content();
    expect(html).not.toMatch(/coming soon/i);
    expect(html).not.toMatch(/Coming in v2\.3/);
    expect(html).not.toMatch(/lands next sprint/i);
    expect(html).not.toMatch(/Drive sync (coming|arriving)/i);
  });

  test('share QR renders locally and Google sign-in is offered', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    const qr = await page.evaluate(() => (window as any).FelixGame.getQRUrl('BGBYG14B-0001') as string);
    expect(qr.startsWith('data:image/')).toBe(true);
    await expect(page.locator('#accountGoogleBtn')).toHaveCount(1);
  });
});
