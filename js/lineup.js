// js/lineup.js — Lineup tab module (PR 3 of LINEUP sprint).
//
// PR 3 ships:
//   - Default config seeded on first activation ("Standard": 3F/3D/2G)
//   - Player pool + Add Player + long-press Edit/Remove
//   - CSV import with auto-header-match and column mapping fallback
//   - Active config selector + New Config button
//   - Lineup grid display (groups + empty slots) — drag/drop & group
//     management land in PR 4
//
// All Supabase calls go through window.FelixLineupApi (js/lineup-api.js).
// Coach-only writes are RLS-enforced server-side; this module assumes
// the current user has coach role on the resolved team_id and surfaces
// errors via toast() on RLS denial.

(function () {
  "use strict";

  const _state = {
    team_id: null,
    players: [],
    configs: [],
    activeConfig: null,   // {id, name, is_default, ...}
    slots: [],            // for activeConfig
    initialized: false,
  };

  let _root = null;       // The panel-lineup section element
  let _refreshing = false;
  let _longPressTimer = null;

  function toast(msg) {
    if (typeof window.toast === "function") return window.toast(msg);
    // Lightweight fallback if main IIFE's toast isn't exposed.
    const el = document.createElement("div");
    el.textContent = msg;
    el.style.cssText = "position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.85);color:#fff;padding:10px 16px;border-radius:8px;font-family:var(--sans);font-size:12px;letter-spacing:.06em;z-index:3000;pointer-events:none";
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1800);
  }

  function esc(s) { return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

  // ── Top-level scaffold ────────────────────────────────────────────
  function buildScaffold(root) {
    root.innerHTML = `
      <div class="lineup-root" id="lineup-root">
        <div class="lineup-topbar" id="lineupTopbar"></div>
        <div class="lineup-pool-section">
          <div class="lineup-section-head">
            <span>Roster</span>
            <button type="button" class="lineup-btn-ghost" id="lineupAddPlayerBtn">+ Add Player</button>
          </div>
          <div class="lineup-pool" id="lineupPool"></div>
        </div>
        <div class="lineup-grid-section">
          <div class="lineup-section-head">
            <span id="lineupConfigName">Lineup</span>
          </div>
          <div class="lineup-grid" id="lineupGrid"></div>
        </div>
        <p class="lineup-empty-hint" id="lineupEmptyHint" style="display:none">
          Sign in as a coach to manage your lineup. (Open Settings &raquo; Account.)
        </p>
      </div>

      <!-- Add/Edit player modal -->
      <div class="lineup-modal-backdrop" id="lineupPlayerModal" style="display:none">
        <div class="lineup-modal">
          <div class="lineup-modal-head">
            <h3 id="lineupPlayerModalTitle">Add Player</h3>
            <button type="button" class="lineup-modal-close" data-close>&times;</button>
          </div>
          <div class="lineup-modal-body">
            <input type="hidden" id="lineupPlayerId" />
            <label>Jersey #</label>
            <input type="text" id="lineupPlayerJersey" inputmode="numeric" maxlength="3" autocomplete="off" />
            <label>First name</label>
            <input type="text" id="lineupPlayerFirst" autocomplete="off" />
            <label>Last name</label>
            <input type="text" id="lineupPlayerLast" autocomplete="off" />
            <label>Position</label>
            <div class="lineup-seg" id="lineupPlayerPosSeg">
              <button type="button" data-pos="F">Forward</button>
              <button type="button" data-pos="D">Defense</button>
              <button type="button" data-pos="G">Goalie</button>
            </div>
            <label>Handedness</label>
            <div class="lineup-seg" id="lineupPlayerHandSeg">
              <button type="button" data-hand="L">Left</button>
              <button type="button" data-hand="R">Right</button>
              <button type="button" data-hand="">Skip</button>
            </div>
          </div>
          <div class="lineup-modal-foot">
            <button type="button" class="lineup-btn-danger" id="lineupPlayerDeleteBtn" style="display:none">Remove</button>
            <button type="button" class="lineup-btn-ghost" data-close>Cancel</button>
            <button type="button" class="lineup-btn-primary" id="lineupPlayerSaveBtn">Save</button>
          </div>
        </div>
      </div>

      <!-- New config modal -->
      <div class="lineup-modal-backdrop" id="lineupConfigModal" style="display:none">
        <div class="lineup-modal">
          <div class="lineup-modal-head">
            <h3>New Config</h3>
            <button type="button" class="lineup-modal-close" data-close>&times;</button>
          </div>
          <div class="lineup-modal-body">
            <label>Config name</label>
            <input type="text" id="lineupConfigName_input" placeholder="e.g. Power Play" />
          </div>
          <div class="lineup-modal-foot">
            <button type="button" class="lineup-btn-ghost" data-close>Cancel</button>
            <button type="button" class="lineup-btn-primary" id="lineupConfigCreateBtn">Create</button>
          </div>
        </div>
      </div>

      <!-- CSV import modal -->
      <div class="lineup-modal-backdrop" id="lineupCsvModal" style="display:none">
        <div class="lineup-modal lineup-modal-wide">
          <div class="lineup-modal-head">
            <h3>Import CSV</h3>
            <button type="button" class="lineup-modal-close" data-close>&times;</button>
          </div>
          <div class="lineup-modal-body">
            <p class="lineup-hint">
              Expected columns: <code>number, first_name, last_name, position, handedness</code>.
              Position is F / D / G; handedness is L / R (optional).
            </p>
            <label>Paste CSV</label>
            <textarea id="lineupCsvText" rows="6" placeholder="number,first_name,last_name,position,handedness
14,Tim,Smith,F,L
21,Pat,Jones,D,R"></textarea>
            <label>or upload .csv</label>
            <input type="file" id="lineupCsvFile" accept=".csv,text/csv" />
            <div id="lineupCsvMapping" style="display:none"></div>
            <div id="lineupCsvPreview" style="display:none"></div>
          </div>
          <div class="lineup-modal-foot">
            <button type="button" class="lineup-btn-ghost" data-close>Cancel</button>
            <button type="button" class="lineup-btn-ghost" id="lineupCsvParseBtn">Preview</button>
            <button type="button" class="lineup-btn-primary" id="lineupCsvCommitBtn" disabled>Import</button>
          </div>
        </div>
      </div>
    `;
  }

  // ── Render top bar ────────────────────────────────────────────────
  function renderTopBar() {
    const tb = document.getElementById("lineupTopbar");
    if (!tb) return;
    const opts = _state.configs.map((c) =>
      `<option value="${esc(c.id)}"${_state.activeConfig && _state.activeConfig.id === c.id ? " selected" : ""}>${esc(c.name)}${c.is_default ? " (default)" : ""}</option>`
    ).join("");
    tb.innerHTML = `
      <select id="lineupConfigSelect" aria-label="Active config">
        ${opts || '<option>(no configs)</option>'}
      </select>
      <button type="button" class="lineup-btn-ghost" id="lineupNewConfigBtn">+ New Config</button>
      <button type="button" class="lineup-btn-ghost" id="lineupImportCsvBtn">Import CSV</button>
    `;
    document.getElementById("lineupConfigSelect").addEventListener("change", async (e) => {
      const cfg = _state.configs.find((c) => c.id === e.target.value);
      if (cfg) await setActiveConfig(cfg);
    });
    document.getElementById("lineupNewConfigBtn").addEventListener("click", () => openConfigModal());
    document.getElementById("lineupImportCsvBtn").addEventListener("click", () => openCsvModal());
  }

  // ── Render player pool ────────────────────────────────────────────
  function renderPool() {
    const pool = document.getElementById("lineupPool");
    if (!pool) return;
    if (_state.players.length === 0) {
      pool.innerHTML = `<div class="lineup-empty">No players yet. Add one or import a CSV.</div>`;
      return;
    }
    pool.innerHTML = _state.players.map((p) => `
      <div class="lineup-player-tile" data-player-id="${esc(p.id)}" tabindex="0">
        <div class="lineup-tile-jersey">#${esc(p.jersey_number)}</div>
        <div class="lineup-tile-name">${esc(p.first_name)} ${esc(p.last_name)}</div>
        ${p.position ? `<div class="lineup-tile-meta">${esc(p.position)}${p.handedness ? " " + esc(p.handedness) : ""}</div>` : ""}
      </div>
    `).join("");
    // Long-press → edit/remove menu. Tap = edit (PR 3 default; PR 4
    // makes the tile a drag source and a tap could conflict).
    Array.from(pool.querySelectorAll(".lineup-player-tile")).forEach((tile) => {
      tile.addEventListener("pointerdown", onTilePointerDown);
      tile.addEventListener("pointerup", onTilePointerUp);
      tile.addEventListener("pointercancel", onTilePointerCancel);
      tile.addEventListener("click", (e) => {
        // If long-press fired, suppress the trailing click.
        if (tile._longPressFired) { tile._longPressFired = false; return; }
        const id = tile.dataset.playerId;
        const p = _state.players.find((x) => x.id === id);
        if (p) openEditPlayerModal(p);
      });
    });
  }

  function onTilePointerDown(e) {
    const tile = e.currentTarget;
    tile._longPressFired = false;
    clearTimeout(_longPressTimer);
    _longPressTimer = setTimeout(() => {
      tile._longPressFired = true;
      const id = tile.dataset.playerId;
      const p = _state.players.find((x) => x.id === id);
      if (!p) return;
      openTileMenu(tile, p, e.clientX, e.clientY);
    }, 500);
  }
  function onTilePointerUp() { clearTimeout(_longPressTimer); }
  function onTilePointerCancel() { clearTimeout(_longPressTimer); }

  function openTileMenu(tile, player, x, y) {
    closeTileMenu();
    const menu = document.createElement("div");
    menu.className = "lineup-context-menu";
    menu.id = "lineupTileMenu";
    menu.style.left = (x - 8) + "px";
    menu.style.top  = (y - 8) + "px";
    menu.innerHTML = `
      <button type="button" data-act="edit">Edit</button>
      <button type="button" data-act="remove">Remove from team</button>
    `;
    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener("click", _tileMenuOutsideClick, { once: true }), 0);
    menu.addEventListener("click", async (e) => {
      const act = e.target.dataset.act;
      closeTileMenu();
      if (act === "edit") openEditPlayerModal(player);
      if (act === "remove") {
        if (!confirm(`Remove ${player.first_name} ${player.last_name} from the team?`)) return;
        try {
          await window.FelixLineupApi.deletePlayer(player.id);
          await refresh();
          toast("Player removed");
        } catch (e) { toast("Remove failed: " + e.message); }
      }
    });
  }
  function _tileMenuOutsideClick(e) {
    const m = document.getElementById("lineupTileMenu");
    if (m && !m.contains(e.target)) closeTileMenu();
  }
  function closeTileMenu() {
    const m = document.getElementById("lineupTileMenu");
    if (m) m.remove();
  }

  // ── Render lineup grid ────────────────────────────────────────────
  function renderGrid() {
    const grid = document.getElementById("lineupGrid");
    const head = document.getElementById("lineupConfigName");
    if (!grid) return;
    if (head) head.textContent = _state.activeConfig ? _state.activeConfig.name : "Lineup";
    if (!_state.activeConfig) {
      grid.innerHTML = `<div class="lineup-empty">No config selected.</div>`;
      return;
    }
    if (_state.slots.length === 0) {
      grid.innerHTML = `<div class="lineup-empty">No slots yet. Add a group in PR 4.</div>`;
      return;
    }
    // Group slots by group_label, preserving group_order
    const byGroup = new Map();
    _state.slots.forEach((s) => {
      if (!byGroup.has(s.group_label)) byGroup.set(s.group_label, { order: s.group_order, slots: [] });
      byGroup.get(s.group_label).slots.push(s);
    });
    const groups = Array.from(byGroup.entries())
      .sort((a, b) => a[1].order - b[1].order);
    grid.innerHTML = groups.map(([label, g]) => {
      const slotHtml = g.slots
        .slice()
        .sort((a, b) => a.slot_order - b.slot_order)
        .map((s) => {
          const p = s.player_id ? _state.players.find((x) => x.id === s.player_id) : null;
          return `
            <div class="lineup-slot${p ? ' filled' : ''}" data-slot-id="${esc(s.id)}" data-position="${esc(s.slot_position)}">
              <div class="lineup-slot-pos">${esc(s.slot_position)}</div>
              ${p ? `
                <div class="lineup-slot-player">
                  <span class="lineup-slot-jersey">#${esc(p.jersey_number)}</span>
                  <span class="lineup-slot-name">${esc(p.last_name)}</span>
                </div>` : `<div class="lineup-slot-empty">Empty</div>`}
            </div>`;
        }).join("");
      return `
        <div class="lineup-group" data-group-label="${esc(label)}">
          <div class="lineup-group-head"><span>${esc(label)}</span></div>
          <div class="lineup-group-slots">${slotHtml}</div>
        </div>`;
    }).join("");
  }

  // ── Modals: Player ────────────────────────────────────────────────
  function openAddPlayerModal() {
    const m = document.getElementById("lineupPlayerModal");
    document.getElementById("lineupPlayerModalTitle").textContent = "Add Player";
    document.getElementById("lineupPlayerId").value = "";
    document.getElementById("lineupPlayerJersey").value = "";
    document.getElementById("lineupPlayerFirst").value = "";
    document.getElementById("lineupPlayerLast").value = "";
    setSegActive("lineupPlayerPosSeg", "");
    setSegActive("lineupPlayerHandSeg", "");
    document.getElementById("lineupPlayerDeleteBtn").style.display = "none";
    m.style.display = "flex";
    document.getElementById("lineupPlayerJersey").focus();
  }
  function openEditPlayerModal(p) {
    const m = document.getElementById("lineupPlayerModal");
    document.getElementById("lineupPlayerModalTitle").textContent = "Edit Player";
    document.getElementById("lineupPlayerId").value = p.id;
    document.getElementById("lineupPlayerJersey").value = p.jersey_number || "";
    document.getElementById("lineupPlayerFirst").value = p.first_name || "";
    document.getElementById("lineupPlayerLast").value = p.last_name || "";
    setSegActive("lineupPlayerPosSeg", p.position || "");
    setSegActive("lineupPlayerHandSeg", p.handedness || "");
    document.getElementById("lineupPlayerDeleteBtn").style.display = "";
    m.style.display = "flex";
  }
  function setSegActive(segId, value) {
    const seg = document.getElementById(segId);
    if (!seg) return;
    Array.from(seg.querySelectorAll("button")).forEach((b) => {
      const v = b.dataset.pos !== undefined ? b.dataset.pos : b.dataset.hand;
      b.classList.toggle("on", v === value);
    });
  }
  function getSegValue(segId) {
    const on = document.querySelector("#" + segId + " button.on");
    if (!on) return "";
    return on.dataset.pos !== undefined ? on.dataset.pos : on.dataset.hand;
  }

  function wirePlayerModal() {
    const m = document.getElementById("lineupPlayerModal");
    Array.from(m.querySelectorAll("[data-close]")).forEach((b) =>
      b.addEventListener("click", () => { m.style.display = "none"; }));
    ["lineupPlayerPosSeg", "lineupPlayerHandSeg"].forEach((id) => {
      const seg = document.getElementById(id);
      seg.addEventListener("click", (e) => {
        const b = e.target.closest("button"); if (!b) return;
        Array.from(seg.querySelectorAll("button")).forEach((x) => x.classList.remove("on"));
        b.classList.add("on");
      });
    });
    document.getElementById("lineupPlayerSaveBtn").addEventListener("click", async () => {
      if (!_state.team_id) { toast("No team. Sign in as coach."); return; }
      const id = document.getElementById("lineupPlayerId").value;
      const fields = {
        jersey_number: document.getElementById("lineupPlayerJersey").value,
        first_name:    document.getElementById("lineupPlayerFirst").value,
        last_name:     document.getElementById("lineupPlayerLast").value,
        position:      getSegValue("lineupPlayerPosSeg") || null,
        handedness:    getSegValue("lineupPlayerHandSeg") || null,
      };
      try {
        if (id) {
          await window.FelixLineupApi.updatePlayer(id, fields);
          toast("Player updated");
        } else {
          await window.FelixLineupApi.addPlayer(_state.team_id, fields);
          toast("Player added");
        }
        m.style.display = "none";
        await refresh();
      } catch (e) { toast("Save failed: " + e.message); }
    });
    document.getElementById("lineupPlayerDeleteBtn").addEventListener("click", async () => {
      const id = document.getElementById("lineupPlayerId").value;
      if (!id) return;
      if (!confirm("Remove this player from the team?")) return;
      try {
        await window.FelixLineupApi.deletePlayer(id);
        m.style.display = "none";
        await refresh();
        toast("Player removed");
      } catch (e) { toast("Remove failed: " + e.message); }
    });
  }

  // ── Modals: New Config ────────────────────────────────────────────
  function openConfigModal() {
    const m = document.getElementById("lineupConfigModal");
    document.getElementById("lineupConfigName_input").value = "";
    m.style.display = "flex";
    document.getElementById("lineupConfigName_input").focus();
  }
  function wireConfigModal() {
    const m = document.getElementById("lineupConfigModal");
    Array.from(m.querySelectorAll("[data-close]")).forEach((b) =>
      b.addEventListener("click", () => { m.style.display = "none"; }));
    document.getElementById("lineupConfigCreateBtn").addEventListener("click", async () => {
      if (!_state.team_id) { toast("No team. Sign in as coach."); return; }
      const name = document.getElementById("lineupConfigName_input").value.trim();
      if (!name) { toast("Name required"); return; }
      try {
        const cfg = await window.FelixLineupApi.createConfig(_state.team_id, name, false);
        m.style.display = "none";
        await refresh();
        const found = _state.configs.find((c) => c.id === cfg.id);
        if (found) await setActiveConfig(found);
        toast("Config created");
      } catch (e) { toast("Create failed: " + e.message); }
    });
  }

  // ── Modals: CSV Import ────────────────────────────────────────────
  let _csvParsed = null; // { headers, mapping, rows }

  function openCsvModal() {
    const m = document.getElementById("lineupCsvModal");
    document.getElementById("lineupCsvText").value = "";
    document.getElementById("lineupCsvFile").value = "";
    document.getElementById("lineupCsvMapping").style.display = "none";
    document.getElementById("lineupCsvPreview").style.display = "none";
    document.getElementById("lineupCsvCommitBtn").disabled = true;
    _csvParsed = null;
    m.style.display = "flex";
  }
  function wireCsvModal() {
    const m = document.getElementById("lineupCsvModal");
    Array.from(m.querySelectorAll("[data-close]")).forEach((b) =>
      b.addEventListener("click", () => { m.style.display = "none"; }));
    document.getElementById("lineupCsvFile").addEventListener("change", (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = (ev) => { document.getElementById("lineupCsvText").value = ev.target.result; };
      reader.readAsText(f);
    });
    document.getElementById("lineupCsvParseBtn").addEventListener("click", () => {
      const text = document.getElementById("lineupCsvText").value;
      if (!text.trim()) { toast("Paste CSV or upload a file"); return; }
      const rows = window.FelixLineupApi.parseCSV(text);
      if (rows.length < 2) { toast("CSV needs a header row + at least one data row"); return; }
      const headers = rows[0];
      const mapping = window.FelixLineupApi.mapHeaders(headers);
      const dataRows = rows.slice(1);
      _csvParsed = { headers, mapping, rows: dataRows };
      const allMapped = mapping.jersey_number !== -1 && mapping.first_name !== -1 && mapping.last_name !== -1;
      const mapEl = document.getElementById("lineupCsvMapping");
      if (!allMapped) {
        mapEl.innerHTML = renderMappingUI(headers, mapping);
        mapEl.style.display = "block";
        mapEl.querySelectorAll("select").forEach((sel) => {
          sel.addEventListener("change", (e) => {
            const idx = parseInt(e.target.dataset.col, 10);
            const field = e.target.value;
            // Reset that field across all selects, then set target
            Object.keys(mapping).forEach((k) => { if (mapping[k] === idx) mapping[k] = -1; });
            if (field) mapping[field] = idx;
            renderCsvPreview();
          });
        });
      } else {
        mapEl.style.display = "none";
      }
      renderCsvPreview();
    });
    document.getElementById("lineupCsvCommitBtn").addEventListener("click", async () => {
      if (!_csvParsed || !_state.team_id) return;
      const players = csvToPlayerObjects(_csvParsed);
      try {
        const { inserted, skipped } = await window.FelixLineupApi.bulkAddPlayers(_state.team_id, players);
        m.style.display = "none";
        await refresh();
        if (skipped.length) toast(`Imported ${inserted.length}, skipped ${skipped.length}`);
        else toast(`Imported ${inserted.length} players`);
      } catch (e) { toast("Import failed: " + e.message); }
    });
  }
  function renderMappingUI(headers, mapping) {
    const fieldOpts = ["", "jersey_number", "first_name", "last_name", "position", "handedness"];
    return `
      <p class="lineup-hint">Headers didn't auto-match. Map each column:</p>
      <div class="lineup-csv-map">
        ${headers.map((h, i) => `
          <label>${esc(h || "(col " + (i + 1) + ")")}</label>
          <select data-col="${i}">
            ${fieldOpts.map((f) => {
              const sel = Object.keys(mapping).find((k) => mapping[k] === i);
              return `<option value="${f}"${sel === f || (!sel && !f) ? " selected" : ""}>${f || "(skip)"}</option>`;
            }).join("")}
          </select>
        `).join("")}
      </div>`;
  }
  function csvToPlayerObjects(parsed) {
    const m = parsed.mapping;
    return parsed.rows.map((r) => ({
      jersey_number: m.jersey_number !== -1 ? r[m.jersey_number] : "",
      first_name:    m.first_name    !== -1 ? r[m.first_name]    : "",
      last_name:     m.last_name     !== -1 ? r[m.last_name]     : "",
      position:      m.position      !== -1 ? r[m.position]      : null,
      handedness:    m.handedness    !== -1 ? r[m.handedness]    : null,
    }));
  }
  function renderCsvPreview() {
    if (!_csvParsed) return;
    const players = csvToPlayerObjects(_csvParsed);
    const valid = players.filter((p) => p.jersey_number && p.first_name && p.last_name);
    const previewEl = document.getElementById("lineupCsvPreview");
    previewEl.innerHTML = `
      <p class="lineup-hint">Preview (${valid.length} valid of ${players.length} rows):</p>
      <table class="lineup-csv-preview">
        <thead><tr><th>#</th><th>First</th><th>Last</th><th>Pos</th><th>Hand</th></tr></thead>
        <tbody>${valid.slice(0, 10).map((p) => `
          <tr><td>${esc(p.jersey_number)}</td><td>${esc(p.first_name)}</td><td>${esc(p.last_name)}</td><td>${esc(p.position || "")}</td><td>${esc(p.handedness || "")}</td></tr>
        `).join("")}${valid.length > 10 ? `<tr><td colspan="5" class="lineup-csv-more">… ${valid.length - 10} more</td></tr>` : ""}</tbody>
      </table>
    `;
    previewEl.style.display = "block";
    document.getElementById("lineupCsvCommitBtn").disabled = valid.length === 0;
  }

  // ── State / refresh ───────────────────────────────────────────────
  async function setActiveConfig(cfg) {
    _state.activeConfig = cfg;
    if (cfg) {
      try {
        _state.slots = await window.FelixLineupApi.listSlots(cfg.id);
      } catch (e) { _state.slots = []; toast("Load slots: " + e.message); }
    } else {
      _state.slots = [];
    }
    renderTopBar();
    renderGrid();
  }

  async function refresh() {
    if (_refreshing) return;
    _refreshing = true;
    try {
      _state.team_id = await window.FelixLineupApi.getCurrentTeamId();
      const hint = document.getElementById("lineupEmptyHint");
      if (!_state.team_id) {
        if (hint) hint.style.display = "block";
        _state.players = []; _state.configs = []; _state.activeConfig = null; _state.slots = [];
        renderTopBar(); renderPool(); renderGrid();
        return;
      }
      if (hint) hint.style.display = "none";

      // Default config seed (idempotent — no-op if any default exists)
      try { await window.FelixLineupApi.ensureDefaultConfig(_state.team_id); }
      catch (e) { console.warn("ensureDefaultConfig:", e.message); }

      const [players, configs] = await Promise.all([
        window.FelixLineupApi.listPlayers(_state.team_id),
        window.FelixLineupApi.listConfigs(_state.team_id),
      ]);
      _state.players = players;
      _state.configs = configs;
      const prev = _state.activeConfig;
      const next = (prev && configs.find((c) => c.id === prev.id))
        || configs.find((c) => c.is_default)
        || configs[0]
        || null;
      await setActiveConfig(next);
      renderPool();
    } finally {
      _refreshing = false;
    }
  }

  // ──────────────────────────────────────────────────── Tab interface
  window.FelixLineup = {
    label: "Lineup",
    icon: '<svg viewBox="0 0 24 24"><circle cx="7" cy="8" r="2.5"/><circle cx="17" cy="8" r="2.5"/><circle cx="12" cy="16" r="2.5"/><line x1="9" y1="9.5" x2="11" y2="14"/><line x1="15" y1="9.5" x2="13" y2="14"/></svg>',

    init(root) {
      _root = root;
      buildScaffold(root);
      wirePlayerModal();
      wireConfigModal();
      wireCsvModal();
      document.getElementById("lineupAddPlayerBtn").addEventListener("click", () => {
        if (!_state.team_id) { toast("No team. Sign in as coach."); return; }
        openAddPlayerModal();
      });
      _state.initialized = true;
    },

    onActivate() { refresh().catch((e) => console.warn("Lineup refresh:", e)); },
    onDeactivate() { closeTileMenu(); },

    // Test hook — exposed for headless verification.
    _state,
    _refresh: refresh,
  };
})();
