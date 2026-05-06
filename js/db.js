// js/db.js — Felix Tracker hybrid storage (IndexedDB layer)
// V3.0 offline-first. SwiftData-forward shapes. Unix ms timestamps.
(function () {
  const DB_NAME = 'felix_db';
  const DB_VERSION = 1;

  let dbPromise = null;
  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('submission_queue')) {
          const s = db.createObjectStore('submission_queue', { keyPath: 'id' });
          s.createIndex('status', 'status');
          s.createIndex('created_at', 'created_at');
        }
        if (!db.objectStoreNames.contains('game_archive')) {
          const s = db.createObjectStore('game_archive', { keyPath: 'id' });
          s.createIndex('ended_at', 'ended_at');
          s.createIndex('team_id', 'team_id');
        }
        if (!db.objectStoreNames.contains('auth_session')) {
          db.createObjectStore('auth_session', { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  const reqP = (r) => new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });

  const txP = async (name, mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(name, mode);
      let value;
      Promise.resolve(fn(t.objectStore(name), t)).then((v) => { value = v; }, reject);
      t.oncomplete = () => resolve(value);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  };

  const uuid = () => (crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });

  window.FelixDB = {
    init: open,
    uuid,

    archiveGame(game) {
      const row = { id: game.id || uuid(), archived_at: Date.now(), ...game };
      return txP('game_archive', 'readwrite', (s) => { s.put(row); return row.id; });
    },
    getArchivedGames() {
      return txP('game_archive', 'readonly', (s) => reqP(s.getAll()));
    },

    queueSubmission(sub) {
      const row = {
        id: sub.id || uuid(),
        game_id: sub.game_id,
        submitter_id: sub.submitter_id,
        events: sub.events || [],
        created_at: sub.created_at || Date.now(),
        status: 'pending',
        retry_count: 0,
        last_error: null
      };
      return txP('submission_queue', 'readwrite', (s) => { s.add(row); return row.id; });
    },
    getQueue(status) {
      return txP('submission_queue', 'readonly', (s) =>
        reqP(status ? s.index('status').getAll(status) : s.getAll()));
    },
    markSubmission(id, patch) {
      return txP('submission_queue', 'readwrite', (s) => new Promise((res, rej) => {
        const g = s.get(id);
        g.onsuccess = () => {
          if (!g.result) return res(false);
          s.put({ ...g.result, ...patch });
          res(true);
        };
        g.onerror = () => rej(g.error);
      }));
    },
    clearSynced() {
      return txP('submission_queue', 'readwrite', (s) => new Promise((res, rej) => {
        const cur = s.index('status').openCursor('synced');
        let n = 0;
        cur.onsuccess = (e) => {
          const c = e.target.result;
          if (c) { c.delete(); n++; c.continue(); } else res(n);
        };
        cur.onerror = () => rej(cur.error);
      }));
    },

    setSession(session) {
      return txP('auth_session', 'readwrite', (s) => {
        s.put({ key: 'current', updated_at: Date.now(), ...session });
        return true;
      });
    },
    getSession() {
      return txP('auth_session', 'readonly', (s) =>
        reqP(s.get('current')).then((r) => r || null));
    },
    clearSession() {
      return txP('auth_session', 'readwrite', (s) => { s.delete('current'); return true; });
    }
  };
})();
