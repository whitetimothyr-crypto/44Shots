/**
 * indexed-db.ts
 *
 * IndexedDB wrapper for offline submission queue (Phase 6).
 * Ports legacy felix_db schema from js/db.js to TypeScript.
 *
 * Schema version 2 (mirrors js/db.js exactly):
 *   submission_queue: keyPath id, indexes status + created_at
 *   game_archive:     keyPath id, indexes ended_at + team_id
 *   auth_session:     keyPath key
 *   media:            keyPath id, indexes game_id + captured_at + period
 *
 * Disk format uses snake_case to match Supabase columns and
 * forward-compat SwiftData V4.0 shapes. React layer uses
 * QueuedSubmission camelCase. Boundary translation lives in
 * toRow / fromRow helpers below.
 *
 * Every IDB call is wrapped in try/catch. SSR or unsupported
 * environments degrade to no-op so UI never crashes.
 */

import type { QueuedSubmission } from "@/hooks/useShotTracker";

const DB_NAME = "felix_db";
const DB_VERSION = 2;
const QUEUE_STORE = "submission_queue";

let dbPromise: Promise<IDBDatabase | null> | null = null;

function hasIDB(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.indexedDB !== "undefined"
  );
}

// === Init ========================================================

export function initDB(): Promise<IDBDatabase | null> {
  if (!hasIDB()) return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase | null>((resolve, reject) => {
    try {
      const req = window.indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains("submission_queue")) {
          const s = db.createObjectStore("submission_queue", { keyPath: "id" });
          s.createIndex("status", "status");
          s.createIndex("created_at", "created_at");
        }
        if (!db.objectStoreNames.contains("game_archive")) {
          const s = db.createObjectStore("game_archive", { keyPath: "id" });
          s.createIndex("ended_at", "ended_at");
          s.createIndex("team_id", "team_id");
        }
        if (!db.objectStoreNames.contains("auth_session")) {
          db.createObjectStore("auth_session", { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains("media")) {
          const s = db.createObjectStore("media", { keyPath: "id" });
          s.createIndex("game_id", "game_id");
          s.createIndex("captured_at", "captured_at");
          s.createIndex("period", "period");
        }
      };

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error("indexed-db open blocked"));
    } catch (err) {
      reject(err);
    }
  }).catch((err) => {
    console.warn("[indexed-db] init failed", err);
    dbPromise = null;
    return null;
  });

  return dbPromise;
}

// === Row <-> domain translation ==================================

interface QueueRow {
  id: string;
  game_id: string | null;
  events: QueuedSubmission["events"];
  net_events: QueuedSubmission["netEvents"];
  faceoffs: QueuedSubmission["faceoffs"];
  created_at: number;
  status: QueuedSubmission["status"];
  retry_count: number;
  last_error: string | null;
}

function toRow(sub: QueuedSubmission): QueueRow {
  return {
    id: sub.id,
    game_id: sub.gameId,
    events: sub.events,
    net_events: sub.netEvents,
    faceoffs: sub.faceoffs,
    created_at: sub.createdAt,
    status: sub.status,
    retry_count: sub.retryCount,
    last_error: sub.lastError,
  };
}

function fromRow(row: QueueRow): QueuedSubmission {
  return {
    id: row.id,
    gameId: row.game_id ?? null,
    events: row.events ?? [],
    netEvents: row.net_events ?? [],
    faceoffs: row.faceoffs ?? [],
    createdAt: row.created_at,
    status: row.status,
    retryCount: row.retry_count ?? 0,
    lastError: row.last_error ?? null,
  };
}

// === Queue ops ===================================================

export async function saveToQueue(
  submission: QueuedSubmission
): Promise<boolean> {
  try {
    const db = await initDB();
    if (!db) return false;
    const row = toRow(submission);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(QUEUE_STORE, "readwrite");
      tx.objectStore(QUEUE_STORE).put(row);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    return true;
  } catch (err) {
    console.warn("[indexed-db] saveToQueue failed", err);
    return false;
  }
}

export async function getPendingQueue(): Promise<QueuedSubmission[]> {
  try {
    const db = await initDB();
    if (!db) return [];
    const rows = await new Promise<QueueRow[]>((resolve, reject) => {
      const tx = db.transaction(QUEUE_STORE, "readonly");
      const idx = tx.objectStore(QUEUE_STORE).index("status");
      const req = idx.getAll("pending");
      req.onsuccess = () => resolve(req.result as QueueRow[]);
      req.onerror = () => reject(req.error);
    });
    return rows.map(fromRow);
  } catch (err) {
    console.warn("[indexed-db] getPendingQueue failed", err);
    return [];
  }
}

export async function markAsSynced(id: string): Promise<boolean> {
  try {
    const db = await initDB();
    if (!db) return false;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(QUEUE_STORE, "readwrite");
      const store = tx.objectStore(QUEUE_STORE);
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const existing = getReq.result as QueueRow | undefined;
        if (!existing) {
          resolve();
          return;
        }
        store.put({ ...existing, status: "synced" });
      };
      getReq.onerror = () => reject(getReq.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    return true;
  } catch (err) {
    console.warn("[indexed-db] markAsSynced failed", err);
    return false;
  }
}
