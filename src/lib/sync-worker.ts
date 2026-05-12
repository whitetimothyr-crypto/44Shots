/**
 * sync-worker.ts
 *
 * Phase 7: bridge between IndexedDB queue and Supabase cloud.
 *
 * processQueue() drains "pending" rows from felix_db.submission_queue
 * (via getPendingQueue) and writes them to nomos_submission + nomos_event.
 * On success, flips row status via markAsSynced(id) in IDB and invokes
 * an onSubmissionSynced callback so React state can mirror sync status.
 *
 * Mapping helpers (deriveEventType, deriveTeamSide, deriveTimestampSeconds)
 * are ported verbatim from js/sync.js so CHECK constraints on
 * nomos_event.event_type and nomos_event.team_side stay satisfied.
 *
 * Connection management: attachConnectionListener wires window 'online'
 * to a callback. startAutoSync composes that listener with processQueue
 * so a flaky network at a rink recovers without user action.
 *
 * Guardrails:
 *   - Reentrancy guard (_syncing) blocks overlapping passes.
 *   - SSR-safe: window/navigator refs are guarded with typeof checks.
 *   - Every Supabase call lives inside try/catch; failures leave row
 *     status at "pending" so a later pass can retry.
 *   - Idempotency: nomos_submission upsert keyed on id (= queue row id).
 *     Event inserts are not currently deduped at DB level; matches
 *     legacy js/sync.js behaviour.
 */

import { getPendingQueue, markAsSynced } from "@/lib/indexed-db";

// Lazy supabase import: keeps SSR/prerender clean when env vars are
// not present at build time. Top-level import would eagerly throw
// from supabase.ts module-eval. Runtime path is client-only anyway.
async function getSupabase() {
  const mod = await import("@/lib/supabase");
  return mod.supabase;
}
import type { QueuedSubmission } from "@/hooks/useShotTracker";
import type {
  ShotEventPayload,
  NetEventPayload,
  FaceoffPayload,
  EventType,
  TeamSide,
  Period,
} from "@/types/hockey";

// === Types =======================================================

type AnyEventPayload =
  | ShotEventPayload
  | NetEventPayload
  | FaceoffPayload;

interface EventRow {
  submission_id: string;
  event_type: EventType;
  team_side: TeamSide;
  period: Period;
  timestamp_seconds: number;
  payload: AnyEventPayload;
  schema_v: number;
}

export interface SyncOptions {
  onSubmissionSynced?: (id: string) => void;
}

export interface SyncResult {
  attempted: number;
  succeeded: number;
  failed: number;
  skipped?: "already_syncing" | "offline" | "no_user" | "no_pending";
}

// === Module state ================================================

let _syncing = false;
const DEFAULT_TRUST_WEIGHT = 0.4;
const SCHEMA_V = 1;

// === Mapping helpers (ported from js/sync.js) ====================
//
// CHECK constraint values from migration metadata:
//   event_type IN (shot, goal, save, miss, faceoff_won, faceoff_lost, penalty)
//   team_side  IN (home, away)

function deriveTeamSide(ev: AnyEventPayload): TeamSide {
  // Faceoff payload carries face_winner directly (home / away / neutral).
  // Neutral collapses to "home" so a CHECK violation cannot occur.
  if ("face_winner" in ev) {
    return ev.face_winner === "away" ? "away" : "home";
  }
  const shotLike = ev as ShotEventPayload | NetEventPayload;
  if (shotLike.weAre && shotLike.forOrAgainst) {
    return shotLike.forOrAgainst === "for"
      ? shotLike.weAre
      : shotLike.weAre === "home"
      ? "away"
      : "home";
  }
  return shotLike.weAre === "away" ? "away" : "home";
}

function deriveEventType(ev: AnyEventPayload): EventType {
  // Faceoff: won when face_winner matches our side, lost otherwise.
  if ("kind" in ev && ev.kind === "faceoff") {
    return ev.face_winner === ev.weAre ? "faceoff_won" : "faceoff_lost";
  }
  // Net-zone tap marks where a goal entered.
  if ("zone" in ev) return "goal";

  const shot = ev as ShotEventPayload;
  switch (shot.result) {
    case "shot":
      return "save";
    case "goal":
      return "goal";
    case "miss":
      return "miss";
    case "block":
      return "miss";
    default:
      return "shot";
  }
}

function deriveTimestampSeconds(t: number | undefined): number {
  return Math.floor((t ?? Date.now()) / 1000);
}

function buildEventRow(
  submissionId: string,
  ev: AnyEventPayload
): EventRow {
  return {
    submission_id: submissionId,
    event_type: deriveEventType(ev),
    team_side: deriveTeamSide(ev),
    period: ev.period,
    timestamp_seconds: deriveTimestampSeconds(ev.t),
    payload: ev,
    schema_v: SCHEMA_V,
  };
}

// === Per-submission sync =========================================

async function syncOne(
  submission: QueuedSubmission,
  submitterId: string
): Promise<void> {
  if (!submission.gameId) {
    throw new Error("missing gameId on queued submission");
  }

  const supabase = await getSupabase();

  // Step 1: upsert nomos_submission row keyed by queue row id (idempotent).
  const { error: subErr } = await supabase
    .from("nomos_submission")
    .upsert(
      {
        id: submission.id,
        game_id: submission.gameId,
        submitter_id: submitterId,
        raw_stats: {
          source: "44shots-next",
          schema_v: SCHEMA_V,
          event_count: submission.events.length,
          net_event_count: submission.netEvents.length,
          faceoff_count: submission.faceoffs.length,
          created_at_ms: submission.createdAt,
        },
        weight_at_submission: DEFAULT_TRUST_WEIGHT,
        schema_v: SCHEMA_V,
      },
      { onConflict: "id" }
    );
  if (subErr) throw new Error("nomos_submission upsert: " + subErr.message);

  // Step 2: assemble event rows from all 3 payload arrays.
  const rows: EventRow[] = [
    ...submission.events.map((ev) => buildEventRow(submission.id, ev)),
    ...submission.netEvents.map((ev) => buildEventRow(submission.id, ev)),
    ...submission.faceoffs.map((ev) => buildEventRow(submission.id, ev)),
  ];
  if (rows.length === 0) return;

  // Step 3: bulk insert nomos_event rows in a single round-trip.
  const { error: evErr } = await supabase.from("nomos_event").insert(rows);
  if (evErr) throw new Error("nomos_event insert: " + evErr.message);
}

// === Public: processQueue ========================================

export async function processQueue(
  opts: SyncOptions = {}
): Promise<SyncResult> {
  if (_syncing) {
    return { attempted: 0, succeeded: 0, failed: 0, skipped: "already_syncing" };
  }
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { attempted: 0, succeeded: 0, failed: 0, skipped: "offline" };
  }

  _syncing = true;
  let succeeded = 0;
  let failed = 0;
  let attempted = 0;

  try {
    const supabase = await getSupabase();
    const { data: authData, error: authErr } = await supabase.auth.getUser();
    if (authErr || !authData?.user) {
      return { attempted: 0, succeeded: 0, failed: 0, skipped: "no_user" };
    }
    const submitterId = authData.user.id;

    const pending = await getPendingQueue();
    attempted = pending.length;
    if (attempted === 0) {
      return { attempted: 0, succeeded: 0, failed: 0, skipped: "no_pending" };
    }

    for (const submission of pending) {
      try {
        await syncOne(submission, submitterId);
        await markAsSynced(submission.id);
        opts.onSubmissionSynced?.(submission.id);
        succeeded++;
      } catch (err) {
        console.warn(
          "[sync-worker] submission failed",
          submission.id,
          err
        );
        failed++;
      }
    }

    return { attempted, succeeded, failed };
  } catch (err) {
    console.warn("[sync-worker] processQueue threw", err);
    return { attempted, succeeded, failed };
  } finally {
    _syncing = false;
  }
}

// === Public: connection management ===============================

export function attachConnectionListener(
  onOnline: () => void
): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => {
    try {
      onOnline();
    } catch (err) {
      console.warn("[sync-worker] online handler threw", err);
    }
  };
  window.addEventListener("online", handler);
  return () => {
    window.removeEventListener("online", handler);
  };
}

export function startAutoSync(opts: SyncOptions = {}): () => void {
  if (typeof window === "undefined") return () => {};
  const trigger = () => {
    void processQueue(opts);
  };
  // Fire once on attach if already online so pending rows from a
  // prior session drain on app load.
  if (typeof navigator !== "undefined" && navigator.onLine) {
    trigger();
  }
  return attachConnectionListener(trigger);
}
