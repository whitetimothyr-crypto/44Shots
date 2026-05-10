import { test, expect, Page } from '@playwright/test';

/**
 * LINEUP module verification (PR 3 of LINEUP sprint).
 *
 * Asserts:
 *   - FelixLineupApi exposes the full method set
 *   - Panel scaffold renders on tab activation
 *   - Anonymous user sees the "sign in as coach" hint (RLS gating)
 *   - With a stubbed coach team_id, pool + grid + config selector
 *     render from listPlayers / listConfigs / listSlots
 *   - Add Player modal opens, fills, and closes on save
 *   - CSV parser handles quoted fields and aliased headers
 *   - CSV import preview shows valid rows and enables commit
 *
 * Coach-write E2E (Tim signed in → real INSERT lands in production)
 * is out of scope for the headless run — RLS coach gating means the
 * test environment can't verify those code paths against the real DB.
 * They run via stubs here; the real-auth path is left for live review.
 */

const COACH_TEAM_ID = '00000000-0000-4000-8000-000000000001';

async function dismissModals(page: Page) {
  await page.evaluate(() => {
    const wn = document.querySelector('#whatsNewBackdrop') as HTMLElement | null;
    if (wn) wn.style.display = 'none';
    const lg = document.querySelector('#loadGameModal') as HTMLElement | null;
    if (lg) lg.style.display = 'none';
  });
}

async function activateLineup(page: Page) {
  await page.click('nav.bottom-nav button[data-tab="lineup"]');
  await page.waitForTimeout(300);
}

async function stubCoachSession(page: Page) {
  await page.evaluate((teamId) => {
    (window as any).FelixLineup._state.team_id = teamId;
    const A = (window as any).FelixLineupApi;
    A.getCurrentTeamId      = async () => teamId;
    A.ensureDefaultConfig   = async () => ({ id: 'cfg-1', team_id: teamId, name: 'Standard', is_default: true });
    A.listPlayers           = async () => [
      { id: 'p1', jersey_number: '14', first_name: 'Tim',  last_name: 'Smith', position: 'F', handedness: 'L' },
    ];
    A.listConfigs           = async () => [
      { id: 'cfg-1', team_id: teamId, name: 'Standard', is_default: true },
    ];
    A.listSlots             = async () => [
      { id: 's1', config_id: 'cfg-1', group_label: 'Line 1', group_order: 0, slot_position: 'LW', slot_order: 0, player_id: null },
      { id: 's2', config_id: 'cfg-1', group_label: 'Line 1', group_order: 0, slot_position: 'C',  slot_order: 1, player_id: null },
      { id: 's3', config_id: 'cfg-1', group_label: 'Line 1', group_order: 0, slot_position: 'RW', slot_order: 2, player_id: null },
    ];
    A.addPlayer             = async (_t: string, p: any) =>
      ({ id: 'new-' + Math.random(), team_id: teamId, ...p });
    A.bulkAddPlayers        = async (_t: string, rows: any[]) =>
      ({ inserted: rows.map((r, i) => ({ id: 'b' + i, team_id: teamId, ...r })), skipped: [] });
  }, COACH_TEAM_ID);
}

test.describe('LINEUP module — PR 3', () => {
  test.use({ viewport: { width: 414, height: 896 } });

  test('FelixLineupApi exposes the expected method surface', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    const methods: string[] = await page.evaluate(() => {
      const A = (window as any).FelixLineupApi;
      return A ? Object.keys(A).filter((k) => typeof A[k] === 'function').sort() : [];
    });
    for (const m of [
      'addPlayer','assignPlayerToSlot','bulkAddPlayers','createConfig',
      'deleteConfig','deleteGroup','deletePlayer','deleteSlot',
      'ensureDefaultConfig','getCurrentTeamId','getCurrentUser','getDefaultConfig',
      'listConfigs','listPlayers','listSlots','mapHeaders','parseCSV',
      'renameGroup','reorderGroups','reorderSlots','setDefaultConfig',
      'updatePlayer','updateSlot','addSlot',
    ]) {
      expect(methods, `${m} missing from FelixLineupApi`).toContain(m);
    }
  });

  test('panel scaffold renders, anon user sees "sign in" hint', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    await dismissModals(page);
    await activateLineup(page);

    const state = await page.evaluate(() => ({
      active: !!document.getElementById('panel-lineup')?.classList.contains('active'),
      hasRoot: !!document.getElementById('lineup-root'),
      hasTopbar: !!document.getElementById('lineupTopbar'),
      hasPool: !!document.getElementById('lineupPool'),
      hasGrid: !!document.getElementById('lineupGrid'),
      hintShown: getComputedStyle(document.getElementById('lineupEmptyHint')!).display !== 'none',
    }));
    expect(state.active).toBe(true);
    expect(state.hasRoot).toBe(true);
    expect(state.hasTopbar).toBe(true);
    expect(state.hasPool).toBe(true);
    expect(state.hasGrid).toBe(true);
    expect(state.hintShown, 'sign-in hint visible for anon').toBe(true);
  });

  test('with stubbed coach session: pool + grid + config select render', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    await dismissModals(page);
    await activateLineup(page);
    await stubCoachSession(page);
    await page.evaluate(() => (window as any).FelixLineup._refresh());
    await page.waitForTimeout(300);

    const r = await page.evaluate(() => ({
      poolTiles: document.querySelectorAll('#lineupPool .lineup-player-tile').length,
      groupCount: document.querySelectorAll('#lineupGrid .lineup-group').length,
      slotCount: document.querySelectorAll('#lineupGrid .lineup-slot').length,
      configValue: (document.getElementById('lineupConfigSelect') as HTMLSelectElement | null)?.value,
      hintHidden: getComputedStyle(document.getElementById('lineupEmptyHint')!).display === 'none',
    }));
    expect(r.poolTiles).toBe(1);
    expect(r.groupCount).toBe(1);
    expect(r.slotCount).toBe(3);
    expect(r.configValue).toBe('cfg-1');
    expect(r.hintHidden).toBe(true);
  });

  test('Add Player modal opens, accepts input, saves, and closes', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    await dismissModals(page);
    await activateLineup(page);
    await stubCoachSession(page);
    await page.evaluate(() => (window as any).FelixLineup._refresh());
    await page.waitForTimeout(200);

    await page.click('#lineupAddPlayerBtn');
    await page.waitForTimeout(120);
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('lineupPlayerModal')!).display))
      .toBe('flex');

    await page.fill('#lineupPlayerJersey', '99');
    await page.fill('#lineupPlayerFirst', 'Wayne');
    await page.fill('#lineupPlayerLast', 'Gretzky');
    await page.click('#lineupPlayerPosSeg button[data-pos="F"]');
    await page.click('#lineupPlayerHandSeg button[data-hand="L"]');
    await page.click('#lineupPlayerSaveBtn');
    await page.waitForTimeout(300);

    expect(await page.evaluate(() => getComputedStyle(document.getElementById('lineupPlayerModal')!).display))
      .toBe('none');
  });

  test('CSV parser handles quoted fields and aliased headers', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    const out = await page.evaluate(() => {
      const A = (window as any).FelixLineupApi;
      const csv = 'number,first_name,last_name,position,handedness\n14,"Pat, Jr.","Jones",D,R\n21,Foo,Bar,G,';
      const rows = A.parseCSV(csv);
      const map  = A.mapHeaders(rows[0]);
      const altMap = A.mapHeaders(['#', 'First', 'Last', 'Pos', 'Stick']);
      return { rowCount: rows.length, firstDataRow: rows[1], map, altMap };
    });
    expect(out.rowCount).toBe(3);
    expect(out.firstDataRow).toEqual(['14', 'Pat, Jr.', 'Jones', 'D', 'R']);
    expect(out.map).toEqual({
      jersey_number: 0, first_name: 1, last_name: 2, position: 3, handedness: 4,
    });
    expect(out.altMap).toEqual({
      jersey_number: 0, first_name: 1, last_name: 2, position: 3, handedness: 4,
    });
  });

  test('CSV import: paste, preview, commit', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    await dismissModals(page);
    await activateLineup(page);
    await stubCoachSession(page);
    await page.evaluate(() => (window as any).FelixLineup._refresh());
    await page.waitForTimeout(200);

    await page.click('#lineupImportCsvBtn');
    await page.waitForTimeout(100);
    await page.fill('#lineupCsvText',
      'number,first_name,last_name,position,handedness\n14,Tim,Smith,F,L\n21,Pat,Jones,D,R\n44,Foo,Bar,G,');
    await page.click('#lineupCsvParseBtn');
    await page.waitForTimeout(150);

    const ui = await page.evaluate(() => ({
      previewVisible: getComputedStyle(document.getElementById('lineupCsvPreview')!).display !== 'none',
      commitEnabled: !(document.getElementById('lineupCsvCommitBtn') as HTMLButtonElement).disabled,
      previewRows: document.querySelectorAll('.lineup-csv-preview tbody tr').length,
    }));
    expect(ui.previewVisible).toBe(true);
    expect(ui.commitEnabled).toBe(true);
    expect(ui.previewRows).toBe(3);

    await page.click('#lineupCsvCommitBtn');
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('lineupCsvModal')!).display))
      .toBe('none');
  });
});
