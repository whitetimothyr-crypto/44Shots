/**
 * 44 Shots / NOMOS hockey domain types.
 *
 * Sourced from:
 *   - js/game.js (nomos_game shape via insert at line 113)
 *   - js/sync.js (nomos_event row shape via insert at line 243, event_type
 *     CHECK constraint enumerated in comment block lines 76-78)
 *   - index.html state.events shape (rink-tap handler builds payload at
 *     line 2259; state object initialized around line 1632)
 *   - supabase/migrations/10..14 (column constraints, RLS context)
 *   - CLAUDE.md (NomosConsensus and submitter_trust references)
 *
 * Live production tables: nomos_game, nomos_submission, nomos_event,
 * nomos_consensus, submitter_trust, external_id_map. Pre-V3.0 schema.
 *
 * V3.0 alt-schema (shot_events / game_observations / consensus_events)
 * is defined in migration 02 but unused by current client code. Schema
 * unification decision is pending per project memory.
 *
 * Coordinate space note: shot x/y fields persist as SVG viewBox px in
 * a 1000x425 space (post-2026-05-11 NHL regulation rescale). Range:
 * x in [60, 940], y in [28, 397].
 */

// === Enumerations ============================================

export type Period = 1 | 2 | 3 | 4;

export type GameState = "5v5" | "pp" | "pk" | "4v4" | "3v3" | "en";

export type TeamSide = "home" | "away";

export type ForOrAgainst = "for" | "against";

export type ShotResult = "shot" | "goal" | "miss" | "block";

export type ShotStyle = "rebound" | "wraparound" | "tip" | "breakaway";

export type GameStatus = "scheduled" | "in_progress" | "completed";

export type AttackingNet = "left" | "right";

/**
 * EventType enumeration from nomos_event.event_type CHECK constraint.
 * Mapped from client-side ShotResult by js/sync.js deriveEventType().
 */
export type EventType =
  | "shot"
  | "goal"
  | "save"
  | "miss"
  | "faceoff_won"
  | "faceoff_lost"
  | "penalty";

// === Client-side shot payload (lives inside nomos_event.payload JSON) ===

export interface GoalieRef {
  name: string;
  num: string | number;
  // Catch hand. "left" = regular (glove on goalie's left), "right" = full
  // right (glove on goalie's right). Drives net-zone Glove/Blocker labels
  // per index.html:2946-2961. Optional for backward compatibility with
  // pre-Phase-4 events.
  hand?: "left" | "right";
}

/**
 * Shape stored at nomos_event.payload (JSONB column, no DB-level schema).
 * Mirrors window.state.events[i] in current index.html monolith.
 */
export interface ShotEventPayload {
  client_event_id?: string;
  x: number;
  y: number;
  result: ShotResult;
  styles: ShotStyle[];
  linkedTo: number | null;
  period: Period;
  attackingNet: AttackingNet;
  forOrAgainst: ForOrAgainst;
  gameState: GameState;
  weAre: TeamSide;
  goalie: GoalieRef | null;
  t: number;
}

/**
 * Net-tap payload (goalie-zone hit). Shares most fields with shot payload
 * but adds zone (1-9 grid) and omits x/y rink coordinates.
 */
export interface NetEventPayload {
  client_event_id?: string;
  zone: number;
  result: ShotResult;
  period: Period;
  forOrAgainst: ForOrAgainst;
  gameState: GameState;
  weAre: TeamSide;
  goalie: GoalieRef | null;
  t: number;
}

/**
 * Faceoff payload. Built by handleFaceoffPick() in index.html.
 */
export interface FaceoffPayload {
  client_event_id?: string;
  kind: "faceoff";
  face_winner: "home" | "away" | "neutral";
  face_dot: number;
  period: Period;
  weAre: TeamSide;
  t: number;
}

// === Database row types ======================================

/**
 * nomos_game row. Tables created via Supabase dashboard pre-migration system.
 * Columns inferred from js/game.js insert at line 113 plus migrations 11-14.
 */
export interface NomosGame {
  id: string;
  match_probe: string;
  client_game_id: string | null;
  created_by: string | null;
  game_date: string;
  home_team_name: string;
  away_team_name: string | null;
  rink_name: string | null;
  age_bracket: string | null;
  status: GameStatus;
  created_at?: string;
}

/**
 * nomos_submission row. One per scorer per game (compound business key:
 * game_id + submitter_id). Links a stream of nomos_event rows to a single
 * observer.
 */
export interface NomosSubmission {
  id: string;
  game_id: string;
  submitter_id: string;
  trust_weight?: number;
  created_at?: string;
}

/**
 * nomos_event row. Append-only audit log of shots, goals, saves, misses,
 * faceoffs, penalties. RLS in migration 13 enforces submission ownership
 * on INSERT. payload generic so consumers can narrow to ShotEventPayload,
 * NetEventPayload, or FaceoffPayload as needed.
 */
export interface NomosEvent<P = ShotEventPayload | NetEventPayload | FaceoffPayload> {
  id?: string;
  submission_id: string;
  event_type: EventType;
  team_side: TeamSide;
  period: Period;
  timestamp_seconds: number;
  payload: P;
  schema_v: number;
  created_at?: string;
}

/**
 * nomos_consensus row. Output of reconciliation engine (migration 04).
 * Aggregates contributing nomos_event ids into a single resolved record.
 * Shape inferred from CLAUDE.md context plus reconciliation_engine.sql
 * column references. Field set may shift once schema unification decision
 * lands.
 */
export interface NomosConsensus {
  id: string;
  game_id: string;
  client_event_id?: string;
  period: Period;
  event_type: EventType;
  team_side: TeamSide;
  resolved_payload: ShotEventPayload;
  contributing_event_ids: string[];
  confidence: number;
  resolved_at: string;
}

// === Live in-memory shot-tracking state (window.state in index.html) ===

/**
 * Mirrors window.state object built in index.html around line 1632.
 * Hot-path read/write via localStorage key "felix-shot-tracker-v1".
 * Forward-compat target: SwiftData @Model TrackerState in V4.0.
 */
export interface TrackerState {
  events: ShotEventPayload[];
  netEvents: NetEventPayload[];
  faceoffs: FaceoffPayload[];
  goalies: GoalieRef[];
  activeGoalie: GoalieRef | null;
  armedForRebound: boolean;
  lastShotIdForRebound: number | null;
  armTimer: number | null;
  pendingNetGoalTeam: ForOrAgainst | null;
  period: Period;
  gameState: GameState;
  gameStateExpiresAt: number | null;
  weAre: TeamSide;
  rinkRotation: 0 | 180;
  gameInfo?: TrackerGameInfo;
}

export interface TrackerGameInfo {
  configured?: boolean;
  opponent?: string;
  ourTeam?: string;
  endGameNotes?: string;
  // Per-game default goalie hand. Used by net-zone label math when
  // activeGoalie.hand is absent. Mirrors legacy
  // index.html:3654 (load-game modal field).
  goalieHandedness?: "left" | "right";
}

// === Whiteboard module types (js/whiteboard.js) ===

export type WhiteboardTool = "pen" | "eraser";
export type WhiteboardColor = "black" | "blue" | "red";
export type WhiteboardMarkerColor = "red" | "blue";

export interface WhiteboardStroke {
  id: string;
  color: string;
  size: number;
  points: Array<{ x: number; y: number }>;
  pointerId?: number;
}

export interface WhiteboardMarker {
  id: string;
  color: WhiteboardMarkerColor;
  x: number;
  y: number;
}
