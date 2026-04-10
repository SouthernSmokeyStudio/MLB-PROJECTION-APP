/**
 * inferred-source.ts
 *
 * Tier 3 contract for internally inferred starters and lineups.
 *
 * Inferred outputs are the lowest-confidence source tier — produced by
 * internal heuristics (rotation patterns, historical lineup tendencies)
 * when neither official (Tier 1) nor projected (Tier 2) data is available.
 *
 * Every inferred output carries explicit confidence and reasoning metadata
 * so downstream consumers can distinguish inferred data from higher-tier
 * sources.  Inference-specific fields (strategy, reasoning) stay at the
 * inference boundary and do NOT leak into canonical contracts.
 */

import type {
  GameId,
  Handedness,
  ISOTimestamp,
  PlayerId,
  PlayerPosition,
  StartingStatus,
  TeamId
} from "./types";

// ---------------------------------------------------------------------------
// Confidence & reasoning metadata
// ---------------------------------------------------------------------------

/**
 * Explicit confidence level for an inferred output.
 * "high": strong historical pattern (e.g., pitcher on normal rotation)
 * "medium": reasonable but uncertain (e.g., lineup with partial data)
 * "low": speculative (e.g., first game of season, no history)
 */
export type InferenceConfidence = "high" | "medium" | "low";

/**
 * Named inference strategy that produced the output.
 * The engine declares which heuristic it used.
 */
export type InferenceStrategy =
  | "rotation-pattern"
  | "recent-lineup-frequency"
  | "season-opener-fallback"
  | "manual-override"
  | "unknown";

/**
 * Reasoning metadata attached to every inferred output.
 * Stays at the inference boundary — downstream canonical consumers
 * never see these fields.
 */
export interface InferenceReasoning {
  readonly strategy: InferenceStrategy;
  readonly confidence: InferenceConfidence;
  readonly reason: string;
  readonly based_on_games: number;
}

// ---------------------------------------------------------------------------
// Canonical inferred entries
// ---------------------------------------------------------------------------

/**
 * An inferred starting pitcher for one side of a game.
 * The canonical fields (player_id, team_id, handedness, starting_status)
 * mirror ProbablePitcher / ProjectedStarter so downstream consumers can
 * use them interchangeably.  The `inference` field is the boundary metadata.
 */
export interface InferredStarter {
  readonly player_id: PlayerId;
  readonly team_id: TeamId;
  readonly handedness: Handedness;
  readonly starting_status: StartingStatus;
  readonly inference: InferenceReasoning;
}

/**
 * A single inferred lineup entry for one batter.
 * Mirrors LineupEntry / ProjectedLineupEntry canonical shape.
 */
export interface InferredLineupEntry {
  readonly player_id: PlayerId;
  readonly team_id: TeamId;
  readonly batting_order: number;
  readonly position: PlayerPosition;
  readonly starting_status: StartingStatus;
  readonly inference: InferenceReasoning;
}

/**
 * One game's worth of inferred data from the inference engine.
 */
export interface InferredGameData {
  readonly game_id: GameId;
  readonly away_starter: InferredStarter | null;
  readonly home_starter: InferredStarter | null;
  readonly away_lineup: readonly InferredLineupEntry[] | null;
  readonly home_lineup: readonly InferredLineupEntry[] | null;
}

// ---------------------------------------------------------------------------
// Engine result
// ---------------------------------------------------------------------------

/**
 * Summary statistics for an inference run.
 */
export interface InferenceRunSummary {
  readonly games_attempted: number;
  readonly starters_inferred: number;
  readonly lineups_inferred: number;
  readonly failures: number;
}

/**
 * The canonical result shape the inference engine returns.
 * Uses the standard Result<T, string> pattern.
 */
export interface InferenceResult {
  readonly engine: string;
  readonly date: string;
  readonly generated_at: ISOTimestamp;
  readonly summary: InferenceRunSummary;
  readonly games: readonly InferredGameData[];
}

// ---------------------------------------------------------------------------
// Engine interface
// ---------------------------------------------------------------------------

/**
 * The inference engine boundary.  Any implementation (rotation heuristic,
 * ML model, stub) satisfies this interface.  The `engine` discriminant
 * identifies which implementation produced the output.
 */
export interface InferenceEngine {
  readonly engine: string;
  infer(
    date: string,
    context: InferenceContext
  ): Promise<import("./types").Result<InferenceResult, string>>;
}

/**
 * Inputs the inference engine receives.  Kept minimal for A4 —
 * future sub-slices will expand with historical game logs, roster data, etc.
 */
export interface InferenceContext {
  readonly date: string;
  readonly game_ids: readonly GameId[];
}
