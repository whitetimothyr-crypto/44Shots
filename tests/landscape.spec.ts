import { test, expect, Page } from '@playwright/test';

/**
 * RINK-screen landscape no-scroll fix verification.
 *
 * Asserts on three viewports (iPhone 14/15 Pro, iPad Pro 11, iPad Pro 13):
 *   - No vertical or horizontal scroll on the RINK panel
 *   - Period selector, score block, all 7 lastShotBar action buttons,
 *     FACEOFF, and the bottom-nav are all inside the viewport
 *   - Rink illustration is at least 50% of viewport width
 *   - Tap targets meet 44x44 minimum
 *   - End Game button is in viewport
 *
 * Run locally vs a static server:
 *   BASE_URL=http://localhost:8088 npx playwright test landscape.spec.ts --project=smoke
 */

const VIEWPORTS = [
  { name: 'iPhone 14/15 Pro landscape', width: 844, height: 390 },
  { name: 'iPad Pro 11" landscape',     width: 1180, height: 820 },
  { name: 'iPad Pro 13" landscape',     width: 1366, height: 1024 },
];

async function inViewport(page: Page, selector: string): Promise<boolean> {
  return await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    return r.left >= 0 && r.top >= 0 && r.right <= vw + 1 && r.bottom <= vh + 1;
  }, selector);
}

async function elementSize(page: Page, selector: string) {
  return await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { w: r.width, h: r.height, top: r.top, left: r.left, right: r.right, bottom: r.bottom };
  }, selector);
}

async function gotoRink(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  // Wait for any auth-driven role gates to settle, then force the
  // coach-gated End Game button visible. We test the landscape layout
  // assuming the coach view (worst case — most controls visible).
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const wn = document.querySelector('#whatsNewBackdrop') as HTMLElement | null;
    if (wn) wn.style.display = 'none';
    const btn = document.querySelector('nav.bottom-nav button[data-tab="rink"]') as HTMLElement | null;
    btn?.click();
    const eg = document.getElementById('endGameBtn') as HTMLElement | null;
    if (eg) {
      eg.style.setProperty('display', 'inline-flex', 'important');
      eg.removeAttribute('hidden');
    }
  });
  await page.waitForTimeout(200);
}

for (const vp of VIEWPORTS) {
  test.describe(`landscape (${vp.name} ${vp.width}x${vp.height})`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('no scroll, all critical controls in viewport, rink >= 50% vw, taps >= 44px', async ({ page }) => {
      await gotoRink(page);

      // 1. No scroll: scrollWidth/scrollHeight must equal client dimensions.
      const scroll = await page.evaluate(() => {
        const de = document.documentElement;
        return {
          scrollW: de.scrollWidth, clientW: de.clientWidth,
          scrollH: de.scrollHeight, clientH: de.clientHeight,
        };
      });
      // Allow 1px slack for sub-pixel rounding.
      expect(scroll.scrollW, 'horizontal scroll').toBeLessThanOrEqual(scroll.clientW + 1);
      expect(scroll.scrollH, 'vertical scroll').toBeLessThanOrEqual(scroll.clientH + 1);

      // 2. Critical controls inside viewport.
      const critical = [
        'nav.bottom-nav',                                  // bottom nav
        '#endGameBtn',                                     // end game
        '#headerStats',                                    // score block
        '#globalGameRow',                                  // period selector container
        '#globalGameRow .seg-period button[data-period="1"]',
        '#globalGameRow .seg-period button[data-period="4"]',
        '#lastShotBar',                                    // action bar container
        '#lastShotBar .lsBtn[data-action="goal"]',
        '#lastShotBar .lsBtn[data-action="miss"]',
        '#lastShotBar .lsBtn[data-action="block"]',
        '#lastShotBar .lsBtn[data-action="rebound"]',
        '#lastShotBar .lsBtn[data-action="wraparound"]',
        '#lastShotBar .lsBtn[data-action="tip"]',
        '#lastShotBar .lsBtn[data-action="breakaway"]',
        '#faceoffBtn',
        '#rinkSvg',
      ];
      for (const sel of critical) {
        const ok = await inViewport(page, sel);
        expect(ok, `${sel} should be inside viewport`).toBe(true);
      }

      // 3. Rink width >= 50% of viewport width.
      const rink = await elementSize(page, '.rink-wrap');
      expect(rink, 'rink-wrap exists').not.toBeNull();
      expect(rink!.w / vp.width, 'rink width / viewport width').toBeGreaterThanOrEqual(0.5);

      // 4. 44x44 minimum on every tappable control we listed (excluding the
      //    container divs and the SVG which are not tap targets themselves).
      const tapTargets = [
        '#endGameBtn',
        '#globalGameRow .seg-period button[data-period="1"]',
        '#globalGameRow .seg-period button[data-period="4"]',
        '#lastShotBar .lsBtn[data-action="goal"]',
        '#lastShotBar .lsBtn[data-action="miss"]',
        '#lastShotBar .lsBtn[data-action="block"]',
        '#lastShotBar .lsBtn[data-action="rebound"]',
        '#lastShotBar .lsBtn[data-action="wraparound"]',
        '#lastShotBar .lsBtn[data-action="tip"]',
        '#lastShotBar .lsBtn[data-action="breakaway"]',
        '#faceoffBtn',
      ];
      for (const sel of tapTargets) {
        const sz = await elementSize(page, sel);
        expect(sz, `${sel} measurable`).not.toBeNull();
        // Allow 0.5px slack for sub-pixel rounding.
        expect(sz!.w, `${sel} width >= 44`).toBeGreaterThanOrEqual(43.5);
        expect(sz!.h, `${sel} height >= 44`).toBeGreaterThanOrEqual(43.5);
      }

      // 5. No element overlaps another among the critical rails. Spot-check
      //    that the right rail's lastShotBar doesn't overlap the FACEOFF
      //    button, and that neither overlaps the bottom-nav.
      const lsb = (await elementSize(page, '#lastShotBar'))!;
      const fco = (await elementSize(page, '#faceoffBtn'))!;
      const nav = (await elementSize(page, 'nav.bottom-nav'))!;
      expect(lsb.bottom, 'lastShotBar above faceoff').toBeLessThanOrEqual(fco.top + 0.5);
      expect(fco.bottom, 'faceoff above bottom-nav').toBeLessThanOrEqual(nav.top + 0.5);
    });
  });
}
