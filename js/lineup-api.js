// js/lineup-api.js — Supabase calls for the LINEUP module.
//
// Mirrors the js/sync.js shape (memoized client, scoped getClient).
// All SELECT methods rely on RLS allowing authenticated reads on the
// new tables (migration 15). All write methods rely on RLS coach gates,
// so the calling user must be in team_members with team_role IN
// ('head_coach','assistant_coach') for the team_id in question.
//
// Cross-row constraint: a player can occupy at most one slot in a given
// config. Enforced at the application layer in assignPlayerToSlot()
// because Postgres can't express "unique within sibling rows" without a
// trigger or partial index, and the V3.0 beta scale doesn't justify it.

(function () {
  "use strict";

  const SUPABASE_URL = "https://qshgschhudiryjnslzof.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_hdrc9mYaGocDhJVesn0FRw_wELl6Tnv";

  let _client = null;
  function getClient() {
    if (_client) return _client;
    if (typeof window.supabase === "undefined") return null;
    _client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
    return _client;
  }

  async function getCurrentUser() {
    const c = getClient();
    if (!c) return null;
    const { data } = await c.auth.getUser();
    return (data && data.user) || null;
  }

  // First team where the current user is head_coach or assistant_coach.
  // Returns null if not signed in or not a coach of any team.
  async function getCurrentTeamId() {
    const c = getClient();
    if (!c) return null;
    const user = await getCurrentUser();
    if (!user) return null;
    const { data, error } = await c
      .from("team_members")
      .select("team_id, team_role, joined_at")
      .eq("user_id", user.id)
      .in("team_role", ["head_coach", "assistant_coach"])
      .order("joined_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return data.team_id;
  }

  // ────────────────────────────────────────────────────────── Players ──
  async function listPlayers(team_id) {
    const c = getClient();
    if (!c) throw new Error("Supabase SDK not loaded");
    const { data, error } = await c
      .from("players")
      .select("*")
      .eq("team_id", team_id)
      .order("jersey_number", { ascending: true });
    if (error) throw new Error("listPlayers: " + error.message);
    return data || [];
  }

  function _normalizePlayerInput(p) {
    return {
      jersey_number: String(p.jersey_number || "").trim(),
      first_name:    String(p.first_name    || "").trim(),
      last_name:     String(p.last_name     || "").trim(),
      position:      p.position ? String(p.position).trim().toUpperCase() : null,
      handedness:    p.handedness ? String(p.handedness).trim().toUpperCase() : null,
    };
  }

  async function addPlayer(team_id, fields) {
    const c = getClient();
    if (!c) throw new Error("Supabase SDK not loaded");
    const row = Object.assign({ team_id }, _normalizePlayerInput(fields));
    if (!row.jersey_number) throw new Error("jersey_number required");
    if (!row.first_name)    throw new Error("first_name required");
    if (!row.last_name)     throw new Error("last_name required");
    if (row.position && !["F", "D", "G"].includes(row.position))
      throw new Error("position must be F, D, or G");
    if (row.handedness && !["L", "R"].includes(row.handedness)) row.handedness = null;
    const { data, error } = await c.from("players").insert(row).select().single();
    if (error) throw new Error("addPlayer: " + error.message);
    return data;
  }

  async function updatePlayer(player_id, fields) {
    const c = getClient();
    if (!c) throw new Error("Supabase SDK not loaded");
    const patch = _normalizePlayerInput(fields);
    Object.keys(patch).forEach((k) => { if (patch[k] === "" || patch[k] === null) delete patch[k]; });
    if (Object.keys(patch).length === 0) throw new Error("no fields to update");
    const { data, error } = await c
      .from("players").update(patch).eq("id", player_id).select().single();
    if (error) throw new Error("updatePlayer: " + error.message);
    return data;
  }

  async function deletePlayer(player_id) {
    const c = getClient();
    if (!c) throw new Error("Supabase SDK not loaded");
    const { error } = await c.from("players").delete().eq("id", player_id);
    if (error) throw new Error("deletePlayer: " + error.message);
  }

  // Bulk insert. Validates each row, drops the invalid ones, returns
  // { inserted: [...], skipped: [{row, reason}] } so the UI can surface
  // which CSV rows didn't make it.
  async function bulkAddPlayers(team_id, rows) {
    const c = getClient();
    if (!c) throw new Error("Supabase SDK not loaded");
    const skipped = [];
    const valid = [];
    rows.forEach((r, i) => {
      const n = _normalizePlayerInput(r);
      if (!n.jersey_number) { skipped.push({ row: i, reason: "missing jersey_number" }); return; }
      if (!n.first_name)    { skipped.push({ row: i, reason: "missing first_name" });    return; }
      if (!n.last_name)     { skipped.push({ row: i, reason: "missing last_name" });     return; }
      if (n.position && !["F", "D", "G"].includes(n.position))
        { skipped.push({ row: i, reason: "bad position " + n.position }); return; }
      if (n.handedness && !["L", "R"].includes(n.handedness)) n.handedness = null;
      valid.push(Object.assign({ team_id }, n));
    });
    if (valid.length === 0) return { inserted: [], skipped };
    const { data, error } = await c.from("players").insert(valid).select();
    if (error) throw new Error("bulkAddPlayers: " + error.message);
    return { inserted: data || [], skipped };
  }

  // ────────────────────────────────────────────────── Lineup configs ──
  async function listConfigs(team_id) {
    const c = getClient();
    if (!c) throw new Error("Supabase SDK not loaded");
    const { data, error } = await c
      .from("lineup_configs")
      .select("*")
      .eq("team_id", team_id)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: true });
    if (error) throw new Error("listConfigs: " + error.message);
    return data || [];
  }

  async function getDefaultConfig(team_id) {
    const c = getClient();
    if (!c) throw new Error("Supabase SDK not loaded");
    const { data, error } = await c
      .from("lineup_configs").select("*")
      .eq("team_id", team_id).eq("is_default", true)
      .maybeSingle();
    if (error) throw new Error("getDefaultConfig: " + error.message);
    return data || null;
  }

  async function createConfig(team_id, name, is_default) {
    const c = getClient();
    if (!c) throw new Error("Supabase SDK not loaded");
    const user = await getCurrentUser();
    const row = { team_id, name: String(name || "Untitled"), is_default: !!is_default };
    if (user) row.created_by = user.id;
    const { data, error } = await c
      .from("lineup_configs").insert(row).select().single();
    if (error) throw new Error("createConfig: " + error.message);
    return data;
  }

  async function setDefaultConfig(team_id, config_id) {
    const c = getClient();
    if (!c) throw new Error("Supabase SDK not loaded");
    // Two-step: clear any existing default, then set the target.
    // Race-safe enough for a single coach; if two coaches race, the
    // partial UNIQUE on (team_id) WHERE is_default = true forces one
    // to lose with 23505 — acceptable for V3.0 beta.
    await c.from("lineup_configs")
      .update({ is_default: false })
      .eq("team_id", team_id).eq("is_default", true);
    const { data, error } = await c
      .from("lineup_configs").update({ is_default: true })
      .eq("id", config_id).select().single();
    if (error) throw new Error("setDefaultConfig: " + error.message);
    return data;
  }

  async function deleteConfig(config_id) {
    const c = getClient();
    if (!c) throw new Error("Supabase SDK not loaded");
    const { error } = await c.from("lineup_configs").delete().eq("id", config_id);
    if (error) throw new Error("deleteConfig: " + error.message);
  }

  // The 17-slot "Standard" template — matches the spec: 3 forward
  // lines (LW/C/RW), 3 D-pairs (LD/RD), 2 goalie slots.
  const DEFAULT_TEMPLATE = [
    { group_label: "Line 1",   group_order: 0, slot_position: "LW", slot_order: 0 },
    { group_label: "Line 1",   group_order: 0, slot_position: "C",  slot_order: 1 },
    { group_label: "Line 1",   group_order: 0, slot_position: "RW", slot_order: 2 },
    { group_label: "Line 2",   group_order: 1, slot_position: "LW", slot_order: 0 },
    { group_label: "Line 2",   group_order: 1, slot_position: "C",  slot_order: 1 },
    { group_label: "Line 2",   group_order: 1, slot_position: "RW", slot_order: 2 },
    { group_label: "Line 3",   group_order: 2, slot_position: "LW", slot_order: 0 },
    { group_label: "Line 3",   group_order: 2, slot_position: "C",  slot_order: 1 },
    { group_label: "Line 3",   group_order: 2, slot_position: "RW", slot_order: 2 },
    { group_label: "D Pair 1", group_order: 3, slot_position: "LD", slot_order: 0 },
    { group_label: "D Pair 1", group_order: 3, slot_position: "RD", slot_order: 1 },
    { group_label: "D Pair 2", group_order: 4, slot_position: "LD", slot_order: 0 },
    { group_label: "D Pair 2", group_order: 4, slot_position: "RD", slot_order: 1 },
    { group_label: "D Pair 3", group_order: 5, slot_position: "LD", slot_order: 0 },
    { group_label: "D Pair 3", group_order: 5, slot_position: "RD", slot_order: 1 },
    { group_label: "Goalies",  group_order: 6, slot_position: "G",  slot_order: 0 },
    { group_label: "Goalies",  group_order: 6, slot_position: "G",  slot_order: 1 },
  ];

  // Idempotent: if the team already has any default config, returns it.
  // Otherwise creates "Standard" + the 17-slot template in one round trip.
  async function ensureDefaultConfig(team_id) {
    const c = getClient();
    if (!c) throw new Error("Supabase SDK not loaded");
    const existing = await getDefaultConfig(team_id);
    if (existing) return existing;
    const cfg = await createConfig(team_id, "Standard", true);
    const slotsToInsert = DEFAULT_TEMPLATE.map((s) => Object.assign({ config_id: cfg.id }, s));
    const { error } = await c.from("lineup_slots").insert(slotsToInsert);
    if (error) throw new Error("ensureDefaultConfig (slots): " + error.message);
    return cfg;
  }

  // ──────────────────────────────────────────────────── Lineup slots ──
  async function listSlots(config_id) {
    const c = getClient();
    if (!c) throw new Error("Supabase SDK not loaded");
    const { data, error } = await c
      .from("lineup_slots")
      .select("*")
      .eq("config_id", config_id)
      .order("group_order", { ascending: true })
      .order("slot_order",  { ascending: true });
    if (error) throw new Error("listSlots: " + error.message);
    return data || [];
  }

  async function addSlot(config_id, fields) {
    const c = getClient();
    if (!c) throw new Error("Supabase SDK not loaded");
    const row = Object.assign({ config_id }, fields);
    const { data, error } = await c.from("lineup_slots").insert(row).select().single();
    if (error) throw new Error("addSlot: " + error.message);
    return data;
  }

  async function updateSlot(slot_id, fields) {
    const c = getClient();
    if (!c) throw new Error("Supabase SDK not loaded");
    const { data, error } = await c
      .from("lineup_slots").update(fields).eq("id", slot_id).select().single();
    if (error) throw new Error("updateSlot: " + error.message);
    return data;
  }

  async function deleteSlot(slot_id) {
    const c = getClient();
    if (!c) throw new Error("Supabase SDK not loaded");
    const { error } = await c.from("lineup_slots").delete().eq("id", slot_id);
    if (error) throw new Error("deleteSlot: " + error.message);
  }

  // Cross-row enforcement: a player can occupy at most one slot in a
  // given config. Clears any other slot in the same config holding this
  // player before assigning. Pass player_id = null to vacate.
  async function assignPlayerToSlot(config_id, slot_id, player_id) {
    const c = getClient();
    if (!c) throw new Error("Supabase SDK not loaded");
    if (player_id) {
      await c.from("lineup_slots")
        .update({ player_id: null })
        .eq("config_id", config_id).eq("player_id", player_id).neq("id", slot_id);
    }
    const { data, error } = await c
      .from("lineup_slots").update({ player_id: player_id || null })
      .eq("id", slot_id).select().single();
    if (error) throw new Error("assignPlayerToSlot: " + error.message);
    return data;
  }

  // ───────────────────────────────────────────────── Group operations ──
  // Rename a group: updates every slot whose group_label matches.
  async function renameGroup(config_id, oldLabel, newLabel) {
    const c = getClient();
    if (!c) throw new Error("Supabase SDK not loaded");
    const { error } = await c.from("lineup_slots")
      .update({ group_label: newLabel })
      .eq("config_id", config_id).eq("group_label", oldLabel);
    if (error) throw new Error("renameGroup: " + error.message);
  }

  // Delete a group: drops every slot in that group_label.
  async function deleteGroup(config_id, groupLabel) {
    const c = getClient();
    if (!c) throw new Error("Supabase SDK not loaded");
    const { error } = await c.from("lineup_slots")
      .delete().eq("config_id", config_id).eq("group_label", groupLabel);
    if (error) throw new Error("deleteGroup: " + error.message);
  }

  // Reorder groups: updates group_order on every slot whose group_label
  // matches each entry. Pass an array of {group_label, group_order}.
  async function reorderGroups(config_id, ordering) {
    const c = getClient();
    if (!c) throw new Error("Supabase SDK not loaded");
    for (const entry of ordering) {
      const { error } = await c.from("lineup_slots")
        .update({ group_order: entry.group_order })
        .eq("config_id", config_id).eq("group_label", entry.group_label);
      if (error) throw new Error("reorderGroups: " + error.message);
    }
  }

  // Reorder slots within a group. Pass an array of {id, slot_order}.
  async function reorderSlots(updates) {
    const c = getClient();
    if (!c) throw new Error("Supabase SDK not loaded");
    for (const u of updates) {
      const { error } = await c.from("lineup_slots")
        .update({ slot_order: u.slot_order }).eq("id", u.id);
      if (error) throw new Error("reorderSlots: " + error.message);
    }
  }

  // ───────────────────────────────────────────────── CSV parsing ──────
  // Tiny RFC-4180-ish parser: handles quoted fields with embedded commas
  // and escaped quotes ("" inside a "..."). Returns rows[][].
  function parseCSV(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;
    let i = 0;
    while (i < text.length) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += ch; i++; continue;
      }
      if (ch === '"') { inQuotes = true; i++; continue; }
      if (ch === ",") { row.push(field); field = ""; i++; continue; }
      if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(field); field = "";
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = []; i++; continue;
      }
      field += ch; i++;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  // Map header row → column index per known field. Returns
  // { number, first_name, last_name, position, handedness } each set
  // to a column index or -1 when absent. Case-insensitive, accepts
  // common alternate names.
  function mapHeaders(headerRow) {
    const norm = (s) => String(s || "").trim().toLowerCase().replace(/[\s_-]+/g, "_");
    const want = {
      jersey_number: ["number", "jersey", "jersey_number", "no", "#"],
      first_name:    ["first_name", "first", "firstname", "given_name"],
      last_name:     ["last_name", "last", "lastname", "surname", "family_name"],
      position:      ["position", "pos"],
      handedness:    ["handedness", "hand", "shoots", "shot", "stick"],
    };
    const map = { jersey_number: -1, first_name: -1, last_name: -1, position: -1, handedness: -1 };
    headerRow.forEach((cell, i) => {
      const n = norm(cell);
      Object.keys(want).forEach((key) => {
        if (want[key].some((alias) => norm(alias) === n) && map[key] === -1) map[key] = i;
      });
    });
    return map;
  }

  // ──────────────────────────────────────────────────── Public API ────
  window.FelixLineupApi = {
    getCurrentTeamId,
    getCurrentUser,
    // Players
    listPlayers, addPlayer, updatePlayer, deletePlayer, bulkAddPlayers,
    // Configs
    listConfigs, getDefaultConfig, createConfig, setDefaultConfig,
    deleteConfig, ensureDefaultConfig,
    // Slots
    listSlots, addSlot, updateSlot, deleteSlot, assignPlayerToSlot,
    // Groups
    renameGroup, deleteGroup, reorderGroups, reorderSlots,
    // CSV
    parseCSV, mapHeaders,
    // Constants
    DEFAULT_TEMPLATE,
  };
})();
