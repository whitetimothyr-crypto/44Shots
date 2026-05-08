import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const BASE_URL = process.env.AUDIT_BASE_URL || 'https://44shots.com';

test.describe('Accessibility audit (axe-core, WCAG 2.1 AA)', () => {

  test('homepage: zero critical or serious violations', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const blocking = results.violations.filter(
      v => v.impact === 'critical' || v.impact === 'serious'
    );

    if (blocking.length > 0) {
      console.log('\n=== A11Y VIOLATIONS (homepage) ===');
      blocking.forEach(v => {
        console.log(`[${v.impact}] ${v.id}: ${v.description}`);
        console.log(`  Help: ${v.helpUrl}`);
        console.log(`  Affected nodes: ${v.nodes.length}`);
        v.nodes.slice(0, 3).forEach(n => {
          console.log(`    - ${n.target.join(' ')}`);
          console.log(`      HTML: ${n.html.substring(0, 100)}`);
        });
      });
    }

    expect(blocking).toEqual([]);
  });

  test('signin modal: zero critical or serious violations', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');

    const accountBtn = page.locator('[data-tab="account"], #accountTab, button:has-text("Account")').first();
    if (await accountBtn.isVisible()) {
      await accountBtn.click();
      await page.waitForTimeout(500);
    }

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const blocking = results.violations.filter(
      v => v.impact === 'critical' || v.impact === 'serious'
    );

    if (blocking.length > 0) {
      console.log('\n=== A11Y VIOLATIONS (signin) ===');
      blocking.forEach(v => {
        console.log(`[${v.impact}] ${v.id}: ${v.description}`);
        console.log(`  Affected nodes: ${v.nodes.length}`);
      });
    }

    expect(blocking).toEqual([]);
  });

  test('color contrast: zero violations on rink tab', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');

    const results = await new AxeBuilder({ page })
      .withRules(['color-contrast'])
      .analyze();

    const contrastViolations = results.violations.filter(v => v.id === 'color-contrast');

    if (contrastViolations.length > 0) {
      console.log('\n=== COLOR CONTRAST VIOLATIONS ===');
      contrastViolations[0].nodes.forEach(n => {
        console.log(`  - ${n.target.join(' ')}`);
        console.log(`    ${n.failureSummary}`);
      });
    }

    expect(contrastViolations).toEqual([]);
  });
});
