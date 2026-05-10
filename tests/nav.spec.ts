import { test, expect } from '@playwright/test';

/**
 * 5-tab modular nav verification (PR 1 of LINEUP sprint refactor).
 *
 * Asserts:
 *   - Bottom nav renders RINK / WHITEBOARD / FEED / LINEUP / MORE
 *   - NET tab is removed from the visible rail (panel-net stays in DOM)
 *   - Tab clicks toggle .panel.active correctly
 *   - Whiteboard / Feed / Lineup stub modules render their placeholders
 *   - MORE panel hosts Stats / Report / Settings / Profile entries
 *   - MORE -> Stats activates panel-stats via legacy switchTab()
 *   - Tab order persists to localStorage["felix.tabOrder"]
 *   - FelixNav public API exists on window
 *
 * Runs against BASE_URL (defaults to production per playwright.config.ts).
 */

async function dismissModals(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const wn = document.querySelector('#whatsNewBackdrop') as HTMLElement | null;
    if (wn) wn.style.display = 'none';
    const lg = document.querySelector('#loadGameModal') as HTMLElement | null;
    if (lg) lg.style.display = 'none';
  });
}

test.describe('Modular bottom nav', () => {
  test.use({ viewport: { width: 414, height: 896 } });

  test('renders 5 tabs in the coach default order, no NET tab', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    await dismissModals(page);

    const tabs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('nav.bottom-nav button')).map((b) => (b as HTMLElement).dataset.tab)
    );
    expect(tabs).toEqual(['rink', 'whiteboard', 'feed', 'lineup', 'more']);
    // RINK active by default
    const active = await page.evaluate(() => {
      const b = document.querySelector('nav.bottom-nav button.active') as HTMLElement | null;
      return b ? b.dataset.tab : null;
    });
    expect(active).toBe('rink');
  });

  test('clicking each new tab activates its panel; whiteboard/feed render the stub, lineup renders its full root', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    await dismissModals(page);

    // Whiteboard + Feed are still stub modules (real builds next sprint).
    for (const id of ['whiteboard', 'feed']) {
      await page.click(`nav.bottom-nav button[data-tab="${id}"]`);
      await page.waitForTimeout(120);
      const r = await page.evaluate((tabId) => {
        const p = document.getElementById('panel-' + tabId);
        const stub = p?.querySelector('.stub-panel');
        return {
          panelActive: !!p?.classList.contains('active'),
          hasStub: !!stub,
          h2: stub?.querySelector('h2')?.textContent || '',
        };
      }, id);
      expect(r.panelActive, `${id} panel active`).toBe(true);
      expect(r.hasStub, `${id} renders stub-panel`).toBe(true);
      expect(r.h2.toLowerCase(), `${id} title matches`).toContain(id);
    }

    // Lineup is now the full module (PR 3+). Asserts the real scaffold,
    // not the stub.
    await page.click('nav.bottom-nav button[data-tab="lineup"]');
    await page.waitForTimeout(120);
    const lineup = await page.evaluate(() => {
      const p = document.getElementById('panel-lineup');
      return {
        panelActive: !!p?.classList.contains('active'),
        hasRoot: !!document.getElementById('lineup-root'),
        hasTopbar: !!document.getElementById('lineupTopbar'),
        hasPool: !!document.getElementById('lineupPool'),
      };
    });
    expect(lineup.panelActive, 'lineup panel active').toBe(true);
    expect(lineup.hasRoot, 'lineup-root rendered').toBe(true);
    expect(lineup.hasTopbar, 'lineup topbar rendered').toBe(true);
    expect(lineup.hasPool, 'lineup pool rendered').toBe(true);
  });

  test('MORE panel hosts Stats / Report / Settings / Profile and switches via legacy switchTab', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    await dismissModals(page);

    await page.click('nav.bottom-nav button[data-tab="more"]');
    await page.waitForTimeout(120);
    const items = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#panel-more .more-item')).map((b) => (b as HTMLElement).dataset.more)
    );
    expect(items).toEqual(['stats', 'report', 'settings', 'profile']);

    // MORE -> Stats: should activate panel-stats
    await page.click('#panel-more [data-more="stats"]');
    await page.waitForTimeout(150);
    const statsActive = await page.evaluate(() =>
      !!document.getElementById('panel-stats')?.classList.contains('active')
    );
    expect(statsActive, 'panel-stats active after MORE->Stats').toBe(true);
  });

  test('FelixNav.setOrder persists to localStorage and re-renders the rail', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    await dismissModals(page);

    await page.evaluate(() => {
      (window as any).FelixNav.setOrder(['rink', 'lineup', 'feed', 'whiteboard', 'more']);
    });
    await page.waitForTimeout(50);

    const persisted = await page.evaluate(() => ({
      stored: JSON.parse(localStorage.getItem('felix.tabOrder') || 'null'),
      rendered: Array.from(document.querySelectorAll('nav.bottom-nav button')).map((b) => (b as HTMLElement).dataset.tab),
    }));
    expect(persisted.stored).toEqual(['rink', 'lineup', 'feed', 'whiteboard', 'more']);
    expect(persisted.rendered).toEqual(['rink', 'lineup', 'feed', 'whiteboard', 'more']);
  });

  test('FelixNav public API exists', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    const api = await page.evaluate(() => {
      const N = (window as any).FelixNav;
      return {
        exists: !!N,
        methods: N ? Object.keys(N).filter((k) => typeof N[k] === 'function').sort() : [],
      };
    });
    expect(api.exists).toBe(true);
    expect(api.methods).toEqual(['activate', 'getOrder', 'registerTab', 'render', 'saveOrder', 'setOrder']);
  });
});
