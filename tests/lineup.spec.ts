import { test, expect, Page } from '@playwright/test';

/**
 * LINEUP module verification (PR 3 + PR 4 of LINEUP sprint).
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
    let _slots = [
      { id: 's1', config_id: 'cfg-1', group_label: 'Line 1', group_order: 0, slot_position: 'LW', slot_order: 0, player_id: null as string | null },
      { id: 's2', config_id: 'cfg-1', group_label: 'Line 1', group_order: 0, slot_position: 'C',  slot_order: 1, player_id: null as string | null },
      { id: 's3', config_id: 'cfg-1', group_label: 'Line 1', group_order: 0, slot_position: 'RW', slot_order: 2, player_id: null as string | null },
      { id: 's4', config_id: 'cfg-1', group_label: 'D Pair 1', group_order: 1, slot_position: 'LD', slot_order: 0, player_id: null as string | null },
      { id: 's5', config_id: 'cfg-1', group_label: 'D Pair 1', group_order: 1, slot_position: 'RD', slot_order: 1, player_id: null as string | null },
    ];
    let _players = [
      { id: 'p1', jersey_number: '14', first_name: 'Tim',  last_name: 'Smith', position: 'F', handedness: 'L' },
    ];
    A.getCurrentTeamId      = async () => teamId;
    A.ensureDefaultConfig   = async () => ({ id: 'cfg-1', team_id: teamId, name: 'Standard', is_default: true });
    A.listPlayers           = async () => _players.slice();
    A.listConfigs           = async () => [{ id: 'cfg-1', team_id: teamId, name: 'Standard', is_default: true }];
    A.listSlots             = async () => _slots.slice();
    A.addPlayer             = async (_t: string, p: any) => {
      const row = { id: 'new-' + Math.random().toString(36).slice(2, 8), team_id: teamId, ...p };
      _players.push(row);
      return row;
    };
    A.bulkAddPlayers        = async (_t: string, rows: any[]) => {
      const ins = rows.map((r, i) => ({ id: 'b' + i, team_id: teamId, ...r }));
      _players.push(...ins);
      return { inserted: ins, skipped: [] };
    };
    A.assignPlayerToSlot    = async (cfg: string, slotId: string, playerId: string | null) => {
      if (playerId) _slots.forEach((s) => { if (s.config_id === cfg && s.player_id === playerId && s.id !== slotId) s.player_id = null; });
      const s = _slots.find((x) => x.id === slotId);
      if (s) s.player_id = playerId;
      return s;
    };
    A.addSlot               = async (cfg: string, fields: any) => {
      const row = { id: 'ns-' + Math.random().toString(36).slice(2, 8), config_id: cfg, ...fields, player_id: null };
      _slots.push(row);
      return row;
    };
    A.deleteSlot            = async (slotId: string) => { _slots = _slots.filter((s) => s.id !== slotId); };
    A.renameGroup           = async (_cfg: string, oldL: string, newL: string) => {
      _slots.forEach((s) => { if (s.group_label === oldL) s.group_label = newL; });
    };
    A.deleteGroup           = async (_cfg: string, label: string) => { _slots = _slots.filter((s) => s.group_label !== label); };
    A.reorderSlots          = async (updates: any[]) => {
      updates.forEach((u) => { const s = _slots.find((x) => x.id === u.id); if (s) s.slot_order = u.slot_order; });
    };
    A.reorderGroups         = async (_cfg: string, ordering: any[]) => {
      ordering.forEach((o) => { _slots.forEach((s) => { if (s.group_label === o.group_label) s.group_order = o.group_order; }); });
    };
    (window as any).__lineupTestSlots = () => _slots;
    (window as any).__lineupTestPlayers = () => _players;
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
    expect(r.groupCount).toBe(2);   // Line 1 + D Pair 1
    expect(r.slotCount).toBe(5);    // 3 forwards + 2 D
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

  // ─────────────────────── PR 4 — drag/drop + group management ──────
  test('PR 4 — SortableJS loaded and Add Group button rendered', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    await dismissModals(page);
    await activateLineup(page);
    await stubCoachSession(page);
    await page.evaluate(() => (window as any).FelixLineup._refresh());
    await page.waitForTimeout(300);

    const r = await page.evaluate(() => ({
      sortable: typeof (window as any).Sortable !== 'undefined',
      addBtn: !!document.getElementById('lineupAddGroupBtn'),
    }));
    expect(r.sortable, 'SortableJS loaded from CDN').toBe(true);
    expect(r.addBtn, '+ Add Group button rendered').toBe(true);
  });

  test('PR 4 — pointer drag from pool tile to slot calls assignPlayerToSlot', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    await dismissModals(page);
    await activateLineup(page);
    await stubCoachSession(page);
    await page.evaluate(() => (window as any).FelixLineup._refresh());
    await page.waitForTimeout(300);

    const result = await page.evaluate(async () => {
      const tile = document.querySelector('.lineup-player-tile') as HTMLElement;
      const slot = document.querySelector('.lineup-slot[data-slot-id="s2"]') as HTMLElement;
      const tr = tile.getBoundingClientRect();
      const sr = slot.getBoundingClientRect();
      tile.dispatchEvent(new PointerEvent('pointerdown', {
        pointerId: 1, clientX: tr.left + 5, clientY: tr.top + 5, bubbles: true,
      }));
      // Two pointer-moves: first crosses the 8px drag threshold; second
      // arrives over the target slot.
      document.dispatchEvent(new PointerEvent('pointermove', {
        pointerId: 1, clientX: tr.left + 30, clientY: tr.top + 30, bubbles: true,
      }));
      document.dispatchEvent(new PointerEvent('pointermove', {
        pointerId: 1, clientX: sr.left + sr.width / 2, clientY: sr.top + sr.height / 2, bubbles: true,
      }));
      document.dispatchEvent(new PointerEvent('pointerup', {
        pointerId: 1, clientX: sr.left + sr.width / 2, clientY: sr.top + sr.height / 2, bubbles: true,
      }));
      await new Promise((r) => setTimeout(r, 250));
      const slots = (window as any).__lineupTestSlots();
      return { s2Player: slots.find((s: any) => s.id === 's2').player_id };
    });
    expect(result.s2Player).toBe('p1');
  });

  test('PR 4 — assigning a player to slot B clears their previous slot A', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    await dismissModals(page);
    await activateLineup(page);
    await stubCoachSession(page);
    await page.evaluate(() => (window as any).FelixLineup._refresh());
    await page.waitForTimeout(200);

    const r = await page.evaluate(async () => {
      const A = (window as any).FelixLineupApi;
      await A.assignPlayerToSlot('cfg-1', 's2', 'p1');
      await A.assignPlayerToSlot('cfg-1', 's3', 'p1');
      const slots = (window as any).__lineupTestSlots();
      return {
        s2: slots.find((s: any) => s.id === 's2').player_id,
        s3: slots.find((s: any) => s.id === 's3').player_id,
      };
    });
    expect(r.s2, 's2 vacated when player moved to s3').toBeNull();
    expect(r.s3, 's3 holds the player').toBe('p1');
  });

  test('PR 4 — long-press group header opens 4-item context menu', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    await dismissModals(page);
    await activateLineup(page);
    await stubCoachSession(page);
    await page.evaluate(() => (window as any).FelixLineup._refresh());
    await page.waitForTimeout(300);

    await page.evaluate(() => {
      const head = document.querySelector('.lineup-group .lineup-group-head') as HTMLElement;
      const r = head.getBoundingClientRect();
      head.dispatchEvent(new PointerEvent('pointerdown', {
        pointerId: 1, clientX: r.left + 10, clientY: r.top + 10, bubbles: true,
      }));
    });
    await page.waitForTimeout(700);
    const menu = await page.evaluate(() => {
      const m = document.getElementById('lineupGroupMenu');
      return m ? Array.from(m.querySelectorAll('button')).map((b) => (b as HTMLElement).dataset.act) : null;
    });
    expect(menu).toEqual(['add-slot', 'remove-slot', 'rename', 'delete']);
  });

  test('PR 4 — Add Group, Rename Group, Delete Group via the API persist', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    await dismissModals(page);
    await activateLineup(page);
    await stubCoachSession(page);
    await page.evaluate(() => (window as any).FelixLineup._refresh());
    await page.waitForTimeout(200);

    // Add a group via direct API + check it renders
    await page.evaluate(async () => {
      const A = (window as any).FelixLineupApi;
      await A.addSlot('cfg-1', { group_label: 'PP Unit 1', group_order: 99, slot_position: 'F', slot_order: 0 });
      await (window as any).FelixLineup._refresh();
    });
    await page.waitForTimeout(200);
    const newGroup = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.lineup-group')).map((g) => (g as HTMLElement).dataset.groupLabel)
    );
    expect(newGroup).toContain('PP Unit 1');

    // Rename
    await page.evaluate(async () => {
      const A = (window as any).FelixLineupApi;
      await A.renameGroup('cfg-1', 'PP Unit 1', 'Power Play');
      await (window as any).FelixLineup._refresh();
    });
    await page.waitForTimeout(200);
    const renamed = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.lineup-group')).map((g) => (g as HTMLElement).dataset.groupLabel)
    );
    expect(renamed).toContain('Power Play');
    expect(renamed).not.toContain('PP Unit 1');

    // Delete
    await page.evaluate(async () => {
      const A = (window as any).FelixLineupApi;
      await A.deleteGroup('cfg-1', 'Power Play');
      await (window as any).FelixLineup._refresh();
    });
    await page.waitForTimeout(200);
    const afterDelete = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.lineup-group')).map((g) => (g as HTMLElement).dataset.groupLabel)
    );
    expect(afterDelete).not.toContain('Power Play');
  });
});
