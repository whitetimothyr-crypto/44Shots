// js/backup.js — Cloud backup of saved games (replaces "Drive sync, coming in v2.3").
//
// Every ended game is archived on the device (localStorage felix-archive-v1 +
// IndexedDB). When the user is signed in with a real account (Google or an
// email code, not a guest), each archived game is also upserted into
// public.game_backups (migration 19, owner-only RLS) so a lost or replaced
// phone can restore its history: Settings -> Cloud Backup -> Restore.
//
// Triggers: shortly after load, on sign-in, after End Game (index.html calls
// FelixBackup.backupAll()), and the "Back up now" buttons. Already-uploaded
// ids are remembered in localStorage so nothing is re-sent needlessly.
// Offline: skipped quietly and retried on the next trigger / 'online' event.

(function () {
  "use strict";

  const ARCHIVE_KEY = "felix-archive-v1";
  const DONE_KEY = "felix.backup.done";
  const LAST_KEY = "felix.backup.last";
  const listeners = [];
  let _busy = false;
  let _lastError = "";

  function readArchive() {
    try { const a = JSON.parse(localStorage.getItem(ARCHIVE_KEY) || "[]"); return Array.isArray(a) ? a : []; } catch (_) { return []; }
  }
  function writeArchive(arr) {
    localStorage.setItem(ARCHIVE_KEY, JSON.stringify(arr.slice(-50)));
  }
  function readDone() {
    try { return JSON.parse(localStorage.getItem(DONE_KEY) || "{}") || {}; } catch (_) { return {}; }
  }
  function writeDone(d) { try { localStorage.setItem(DONE_KEY, JSON.stringify(d)); } catch (_) {} }
  function idOf(g) { return g && g.archivedAt ? String(g.archivedAt) : null; }
  function emit() { const s = status(); listeners.forEach((fn) => { try { fn(s); } catch (_) {} }); }
  function client() { return (window.FelixAuth && FelixAuth.client && FelixAuth.client()) || null; }

  async function realUser() {
    if (typeof FelixAuth === "undefined") return null;
    try { const u = await FelixAuth.getUser(); return u && !u.is_anonymous ? u : null; } catch (_) { return null; }
  }

  function status() {
    const arr = readArchive();
    const done = readDone();
    const pending = arr.filter((g) => idOf(g) && !done[idOf(g)]).length;
    const last = parseInt(localStorage.getItem(LAST_KEY) || "0", 10);
    let text;
    if (_busy) text = "Backing up…";
    else if (_lastError) text = "Last attempt failed: " + _lastError;
    else if (!arr.length) text = "No saved games yet";
    else if (pending) text = pending + " game(s) not backed up yet";
    else text = "All " + arr.length + " game(s) backed up" + (last ? " · " + new Date(last).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");
    return { pending, total: arr.length, last, busy: _busy, error: _lastError, text };
  }

  // Upload archived games that are not backed up yet (or all, with force).
  async function backupAll(opts = {}) {
    const user = await realUser();
    if (!user) {
      if (opts.force) throw new Error("Sign in with Google or an email code to use cloud backup");
      return { uploaded: 0, skipped: "not_signed_in" };
    }
    if (navigator.onLine === false) {
      if (opts.force) throw new Error("You're offline. Backup will run when you reconnect.");
      return { uploaded: 0, skipped: "offline" };
    }
    if (_busy) return { uploaded: 0, skipped: "busy" };
    const c = client();
    if (!c) throw new Error("Database unavailable. Reload the app.");
    const done = opts.force ? {} : readDone();
    const todo = readArchive().filter((g) => idOf(g) && !done[idOf(g)]);
    if (!todo.length) { _lastError = ""; emit(); return { uploaded: 0 }; }
    _busy = true; emit();
    try {
      const rows = todo.map((g) => ({
        user_id: user.id,
        id: idOf(g),
        game: g,
        ended_at: new Date(g.archivedAt).toISOString(),
        updated_at: new Date().toISOString(),
      }));
      for (let i = 0; i < rows.length; i += 10) {
        const { error } = await c.from("game_backups").upsert(rows.slice(i, i + 10), { onConflict: "user_id,id" });
        if (error) throw new Error(error.message);
      }
      const d = readDone();
      rows.forEach((r) => { d[r.id] = Date.now(); });
      writeDone(d);
      localStorage.setItem(LAST_KEY, String(Date.now()));
      _lastError = "";
      return { uploaded: rows.length };
    } catch (e) {
      _lastError = (e && e.message) || "unknown error";
      throw e;
    } finally {
      _busy = false; emit();
    }
  }

  // Pull this account's backups and merge any missing games into the archive.
  async function restore() {
    const user = await realUser();
    if (!user) throw new Error("Sign in with Google or an email code to restore backups");
    const c = client();
    if (!c) throw new Error("Database unavailable. Reload the app.");
    const { data, error } = await c.from("game_backups").select("id, game").order("ended_at", { ascending: true }).limit(500);
    if (error) throw new Error(error.message);
    const arr = readArchive();
    const seen = new Set(arr.map(idOf));
    let added = 0;
    (data || []).forEach((r) => {
      const g = r.game;
      if (!g || !g.archivedAt || seen.has(String(g.archivedAt))) return;
      arr.push(g); seen.add(String(g.archivedAt)); added++;
    });
    if (added) {
      arr.sort((a, b) => (a.archivedAt || 0) - (b.archivedAt || 0));
      writeArchive(arr);
    }
    const d = readDone();
    (data || []).forEach((r) => { d[r.id] = d[r.id] || Date.now(); });
    writeDone(d);
    emit();
    return { added, total: (data || []).length };
  }

  function quiet() { backupAll().catch((e) => console.warn("Cloud backup:", e && e.message)); }

  window.FelixBackup = {
    backupAll,
    restore,
    status,
    onChange(fn) { listeners.push(fn); },
  };

  window.addEventListener("online", quiet);
  if (typeof FelixAuth !== "undefined" && FelixAuth.onAuthChange) {
    FelixAuth.onAuthChange((evt) => { if (evt && evt.session && evt.session.user && !evt.session.user.is_anonymous) setTimeout(quiet, 1500); });
  }
  setTimeout(quiet, 4000);
})();
