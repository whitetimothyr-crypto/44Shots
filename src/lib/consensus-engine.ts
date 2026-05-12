/**
 * 44 Shots / NOMOS consensus engine.
 *
 * Pure TypeScript port of Postgres reconciliation + trust update functions.
 * Source of truth:
 *   supabase/migrations/04_reconciliation_engine.sql
 *   supabase/migrations/05_trust_update_engine.sql
 *   supabase/migrations/07_trust_v2_goal_attendance.sql
 *   supabase/migrations/08_trust_v3_anomaly_vs_variance.sql
 *
 * Client-side use cases:
 *   1. Coach-side preview before server reconciliation runs
 *   2. Offline / cached game review with no Supabase round trip
 *   3. SwiftData V4.0 forward path where Postgres is replaced
 *
 * Hard constraints (per NOMOS_AUDIT.md):
 *   - Zero React, zero DOM, zero window, zero side effects
 *   - Spatial math operates strictly in 1000x425 SVG viewBox px
 *   - All functions are pure: same input, same output
 *
 * Coordinate space note: source SQL operates in normalized [0,1] rink
 * space and uses isotropic Euclidean distance with threshold 0.15:
 *   sqrt((dx_norm)^2 + (dy_norm)^2) <= 0.15
 * Inputs to this module live in 1000x425 viewBox px (per NOMOS_AUDIT).
 * Conversion is exact: divide each axis by its viewBox extent before
 * computing distance. Algebraic equivalent in viewBox px is an ellipse
 * with semi-axes 150 (x) and 63.75 (y). This module uses normalized
 * form internally for bit-for-bit parity with Postgres reconciliation.
 */

import type {
  NomosEvent,
  NomosSubmission,
  ShotEventPayload,
  Period,
  GameState,
  ForOrAgainst,
  ShotResult,
  ShotStyle,
  TeamSide,
  EventType,
} from "@/types/hockey";

// === Constants ===================================================

export const VIEWBOX_W = 1000;
export const VIEWBOX_H = 425;

/**
 * Spatial proximity threshold in normalized [0,1] rink coordinates.
 * Lifted verbatim from public._events_are_same() in migration 04.
 * Two events cluster if Euclidean normalized distance <= this value.
 */
export const SPATIAL_PROXIMITY_NORMALIZED = 0.15;

/** Time-window threshold in seconds for same-event clustering. */
export const TIME_WINDOW_SECONDS = 15;

/** Agreement score below this value flags a cluster as disputed. */
export const AGREEMENT_DISPUTED_THRESHOLD = 0.6;

/** Single-observer clusters get a fixed confidence baseline. */
export const SINGLE_OBSERVER_CONFIDENCE = 0.5;

/** Mirrors js/sync.js DEFAULT_TRUST_WEIGHT for new scorers. */
export const DEFAULT_TRUST_WEIGHT = 0.5;

/** EMA learning rate for trust score updates. */
export const TRUST_EMA_ALPHA = 0.2;

// === Helper types ================================================

export interface TrustedEvent {
  event: NomosEvent<ShotEventPayload>;
  scorerId: string;
  trust: number;
}

export interface SubmissionWithEvents {
  submission: NomosSubmission;
  events: NomosEvent<ShotEventPayload>[];
}

export interface EventCluster {
  id: number;
  members: TrustedEvent[];
}

export interface ConsensusRecord {
  period: Period;
  gameState: GameState;
  forOrAgainst: ForOrAgainst;
  result: ShotResult;
  shotStyle: ShotStyle | null;
  teamSide: TeamSide;
  x: number | null;
  y: number | null;
  observerCount: number;
  agreementScore: number;
  contributingEventIds: string[];
  disputed: boolean;
}

// === Coordinate-space helpers ====================================

/**
 * Clamp value into [lo, hi].
 */
export function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

/**
 * Euclidean distance in normalized [0,1] rink space. Inputs are viewBox
 * px (1000x425); each axis is divided by its viewBox extent before
 * squaring. Output matches Postgres _events_are_same() bit-for-bit:
 *   sqrt((dx/VIEWBOX_W)^2 + (dy/VIEWBOX_H)^2)
 * Returns null if either point lacks coordinates.
 *
 * Algebraic equivalent in viewBox px is an ellipse with semi-axes
 * VIEWBOX_W * 0.15 = 150 (x) and VIEWBOX_H * 0.15 = 63.75 (y), but
 * computing in normalized space avoids any rounding choice between
 * 63.75 and 64 and preserves absolute parity with Postgres.
 */
export function spatialDistanceNormalized(
  a: { x: number | null; y: number | null },
  b: { x: number | null; y: number | null }
): number | null {
  if (a.x == null || a.y == null || b.x == null || b.y == null) return null;
  const dxNorm = (a.x - b.x) / VIEWBOX_W;
  const dyNorm = (a.y - b.y) / VIEWBOX_H;
  return Math.sqrt(dxNorm * dxNorm + dyNorm * dyNorm);
}

// === Weighted aggregations =======================================

/**
 * Trust-weighted median. Sorts paired (value, weight) tuples by value,
 * walks cumulative weight, picks value at half-total crossover. Returns
 * null on empty input. Used for outlier-resistant spatial resolution
 * when robustness matters more than smoothness.
 */
export function calculateWeightedMedian(
  values: number[],
  weights: number[]
): number | null {
  if (values.length === 0 || values.length !== weights.length) return null;
  const pairs = values
    .map((v, i) => ({ v, w: Math.max(0, weights[i]) }))
    .filter((p) => Number.isFinite(p.v) && p.w > 0)
    .sort((p, q) => p.v - q.v);
  if (pairs.length === 0) return null;
  const total = pairs.reduce((acc, p) => acc + p.w, 0);
  if (total <= 0) return null;
  const half = total / 2;
  let running = 0;
  for (const p of pairs) {
    running += p.w;
    if (running >= half) return p.v;
  }
  return pairs[pairs.length - 1].v;
}

/**
 * Trust-weighted mean. Skips null / NaN values; their weights are
 * dropped from numerator and denominator. Returns null if no valid
 * sample remains. Matches SQL pattern at migration 04 lines 177-179.
 */
export function calculateWeightedMean(
  values: Array<number | null | undefined>,
  weights: number[]
): number | null {
  let num = 0;
  let den = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    const w = weights[i];
    if (v == null || !Number.isFinite(v) || !Number.isFinite(w) || w <= 0) continue;
    num += v * w;
    den += w;
  }
  if (den <= 0) return null;
  return num / den;
}

/**
 * Trust-weighted modal value. Returns key whose cumulative weight is
 * highest. Ties broken by first-seen order. Used for outcome, zone,
 * shot_modifier resolution per migration 04 lines 149-174.
 */
export function calculateWeightedMode<K extends string | number>(
  keys: Array<K | null | undefined>,
  weights: number[]
): K | null {
  const tally = new Map<K, number>();
  const order: K[] = [];
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const w = weights[i];
    if (k == null || !Number.isFinite(w) || w <= 0) continue;
    if (!tally.has(k)) {
      tally.set(k, 0);
      order.push(k);
    }
    tally.set(k, (tally.get(k) ?? 0) + w);
  }
  if (order.length === 0) return null;
  let best = order[0];
  let bestW = tally.get(best) ?? 0;
  for (const k of order) {
    const w = tally.get(k) ?? 0;
    if (w > bestW) {
      best = k;
      bestW = w;
    }
  }
  return best;
}

// === Trust score EMA =============================================

/**
 * Exponential moving average update for a scorer trust score.
 *   next = alpha * latestAgreement + (1 - alpha) * currentTrust
 *
 * Bounded to [0, 1]. Default alpha 0.2 (each game shifts trust by
 * up to 20% of agreement delta). Mirrors trust_update_engine shape
 * in migration 05; v2/v3 variants extend with attendance + variance
 * factors and can be layered by composing this function.
 */
export function updateTrustScore(
  currentTrust: number,
  latestAgreement: number,
  alpha: number = TRUST_EMA_ALPHA
): number {
  const safeCurrent = clamp(Number.isFinite(currentTrust) ? currentTrust : DEFAULT_TRUST_WEIGHT, 0, 1);
  const safeLatest = clamp(Number.isFinite(latestAgreement) ? latestAgreement : 0, 0, 1);
  const safeAlpha = clamp(Number.isFinite(alpha) ? alpha : TRUST_EMA_ALPHA, 0, 1);
  const next = safeAlpha * safeLatest + (1 - safeAlpha) * safeCurrent;
  return clamp(next, 0, 1);
}

/**
 * Batch EMA: walk through a series of agreement scores updating
 * trust after each game. Returns final trust value. Useful for
 * replay reconciliation when a scorer has historical games.
 */
export function updateTrustScoreBatch(
  currentTrust: number,
  agreementHistory: number[],
  alpha: number = TRUST_EMA_ALPHA
): number {
  let t = currentTrust;
  for (const a of agreementHistory) {
    t = updateTrustScore(t, a, alpha);
  }
  return t;
}

// === Event equivalence + clustering ==============================

/**
 * Returns true if two events plausibly describe a single real-world event.
 * Bit-for-bit port of public._events_are_same() from migration 04 lines
 * 23-47. Spatial check uses normalized Euclidean distance against the
 * SQL threshold 0.15, evaluated identically to Postgres.
 */
export function eventsAreSame(
  a: NomosEvent<ShotEventPayload>,
  b: NomosEvent<ShotEventPayload>
): boolean {
  if (a.period !== b.period) return false;
  if (a.payload.gameState !== b.payload.gameState) return false;
  if (a.payload.forOrAgainst !== b.payload.forOrAgainst) return false;

  const clockDiff = Math.abs((a.timestamp_seconds ?? 0) - (b.timestamp_seconds ?? 0));
  if (clockDiff > TIME_WINDOW_SECONDS) return false;

  const dist = spatialDistanceNormalized(
    { x: a.payload.x, y: a.payload.y },
    { x: b.payload.x, y: b.payload.y }
  );
  if (dist != null && dist > SPATIAL_PROXIMITY_NORMALIZED) return false;

  return true;
}

/**
 * Greedy single-pass clustering. Walks events chronologically and
 * assigns each to an existing cluster (matching eventsAreSame) or
 * starts a new one. One event per scorer per cluster, mirroring
 * migration 04 lines 82-123.
 */
export function clusterEvents(events: TrustedEvent[]): EventCluster[] {
  const sorted = [...events].sort((a, b) => {
    if (a.event.period !== b.event.period) return a.event.period - b.event.period;
    const at = a.event.timestamp_seconds ?? 0;
    const bt = b.event.timestamp_seconds ?? 0;
    return at - bt;
  });

  const clusters: EventCluster[] = [];
  let nextId = 1;

  for (const te of sorted) {
    let target: EventCluster | null = null;
    for (const cluster of clusters) {
      const hasScorer = cluster.members.some((m) => m.scorerId === te.scorerId);
      if (hasScorer) continue;
      const matchesAny = cluster.members.some((m) => eventsAreSame(te.event, m.event));
      if (matchesAny) {
        target = cluster;
        break;
      }
    }
    if (!target) {
      target = { id: nextId++, members: [] };
      clusters.push(target);
    }
    target.members.push(te);
  }

  return clusters;
}

// === Cluster resolution ==========================================

/**
 * Compute trust-weighted consensus for a single cluster. Mirrors
 * migration 04 lines 126-218. Returns one ConsensusRecord per cluster.
 */
export function resolveCluster(cluster: EventCluster): ConsensusRecord {
  const members = cluster.members;
  const weights = members.map((m) => m.trust);
  const totalTrust = weights.reduce((acc, w) => acc + Math.max(0, w), 0);

  const outcomes = members.map((m) => m.event.payload.result);
  const modalResult = (calculateWeightedMode(outcomes, weights) ?? "shot") as ShotResult;

  const styles: Array<ShotStyle | null> = members.map((m) => {
    const arr = m.event.payload.styles;
    return arr && arr.length > 0 ? arr[0] : null;
  });
  const modalStyle = calculateWeightedMode(styles, weights);

  const xs = members.map((m) => m.event.payload.x);
  const ys = members.map((m) => m.event.payload.y);
  const meanX = calculateWeightedMean(xs, weights);
  const meanY = calculateWeightedMean(ys, weights);

  const scorerIds = new Set(members.map((m) => m.scorerId));
  const observerCount = scorerIds.size;

  let agreement: number;
  if (observerCount <= 1) {
    agreement = SINGLE_OBSERVER_CONFIDENCE;
  } else {
    const agreeingWeight = members
      .filter((m) => m.event.payload.result === modalResult)
      .reduce((acc, m) => acc + Math.max(0, m.trust), 0);
    agreement = totalTrust > 0 ? agreeingWeight / totalTrust : 0;
  }

  const firstEvent = members[0].event;
  const teamSide: TeamSide = firstEvent.team_side;
  const contributingEventIds = members
    .map((m) => m.event.id)
    .filter((id): id is string => typeof id === "string");

  return {
    period: firstEvent.period,
    gameState: firstEvent.payload.gameState,
    forOrAgainst: firstEvent.payload.forOrAgainst,
    result: modalResult,
    shotStyle: modalStyle as ShotStyle | null,
    teamSide,
    x: meanX != null ? clamp(meanX, 0, VIEWBOX_W) : null,
    y: meanY != null ? clamp(meanY, 0, VIEWBOX_H) : null,
    observerCount,
    agreementScore: Number(agreement.toFixed(3)),
    contributingEventIds,
    disputed: agreement < AGREEMENT_DISPUTED_THRESHOLD,
  };
}

// === Top-level entrypoint ========================================

/**
 * Reconcile a full game. Joins events with their scorer trust, clusters,
 * resolves each cluster, returns array ready for persistence to
 * nomos_consensus or for coach-side preview display.
 *
 * Inputs:
 *   submissions   array of submission + event bundles, one per scorer
 *   scorerTrust   optional override map; missing entries fall back to
 *                 submission.trust_weight, then DEFAULT_TRUST_WEIGHT
 */
export function resolveGameConsensus(
  submissions: SubmissionWithEvents[],
  scorerTrust?: Map<string, number>
): ConsensusRecord[] {
  const trusted: TrustedEvent[] = [];
  for (const bundle of submissions) {
    const scorerId = bundle.submission.submitter_id;
    const overrideTrust = scorerTrust?.get(scorerId);
    const fallbackTrust = bundle.submission.trust_weight ?? DEFAULT_TRUST_WEIGHT;
    const trust = clamp(overrideTrust ?? fallbackTrust, 0, 1);
    for (const event of bundle.events) {
      trusted.push({ event, scorerId, trust });
    }
  }

  const clusters = clusterEvents(trusted);
  return clusters.map(resolveCluster);
}

/**
 * Filter consensus records by event type (e.g. only goals, only shots).
 * Helper for stat reconciliation surfaces that show one outcome at a time.
 */
export function filterConsensusByResult(
  records: ConsensusRecord[],
  result: ShotResult
): ConsensusRecord[] {
  return records.filter((r) => r.result === result);
}

/**
 * Tally per-team shot + goal counts from a resolved consensus list.
 * Mirrors what buildBrief() in index.html line 4038 does locally but
 * operates on resolved consensus instead of raw client-side events.
 */
export function tallyConsensus(records: ConsensusRecord[]): {
  home: { goals: number; shots: number };
  away: { goals: number; shots: number };
} {
  const out = {
    home: { goals: 0, shots: 0 },
    away: { goals: 0, shots: 0 },
  };
  for (const r of records) {
    const bucket = r.teamSide === "home" ? out.home : out.away;
    if (r.result === "goal") bucket.goals += 1;
    if (r.result === "goal" || r.result === "shot") bucket.shots += 1;
  }
  return out;
}
