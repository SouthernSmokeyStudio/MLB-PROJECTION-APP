/**
 * merge-law.ts
 *
 * Deterministic merge / override contract for the three-tier source model:
 *   official (Tier 1) > projected (Tier 2) > inferred (Tier 3) > none
 *
 * The merge law defines:
 *   1. Source tier precedence — strictly ordered, no blending
 *   2. Winner-selection for starters and lineups independently
 *   3. Provenance metadata — which tier won, which lost, and why
 *   4. Canonical merged output types consumed by downstream preparation
 *
 * The merge is per-side (away/home) and per-slot (starter/lineup).
 * Within a single slot, the highest-tier non-null source wins entirely.
 * There is NO partial blending — e.g., official starter + inferred lineup
 * is two independent slot decisions, not a blend.
 */

import type { GameId, Handedness, PlayerId, PlayerPosition, StartingStatus, TeamId } from "./types";
import type { InferenceConfidence } from "./inferred-source";

// ---------------------------------------------------------------------------
// Source tier
// ---------------------------------------------------------------------------

/**
 * Strictly ordered source tiers.  Lower numeric value = higher precedence.
 * The merge function compares these values — it never compares tier names
 * as strings.
 */
export const SOURCE_TIER = {
  official: 1,
  projected: 2,
  inferred: 3,
} as const;

export type SourceTier = keyof typeof SOURCE_TIER;

// ---------------------------------------------------------------------------
// Normalized merge inputs — tier-tagged slots
// ---------------------------------------------------------------------------

/**
 * A starter candidate from any tier, normalized to a common shape.
 * Each tier adapter strips its own metadata and tags the result.
 */
export interface MergeStarterCandidate {
  readonly tier: SourceTier;
  readonly player_id: PlayerId;
  readonly team_id: TeamId;
  readonly handedness: Handedness;
  readonly starting_status: StartingStatus;
  /** Only present for inferred tier — carries the inference confidence. */
  readonly inference_confidence?: InferenceConfidence;
  /** Only present for projected tier — carries the projection confidence. */
  readonly projection_confidence?: "high" | "medium" | "low";
}

/**
 * A lineup candidate from any tier, normalized to a common shape.
 */
export interface MergeLineupCandidate {
  readonly tier: SourceTier;
  readonly entries: readonly MergeLineupEntryCandidate[];
}

export interface MergeLineupEntryCandidate {
  readonly player_id: PlayerId;
  readonly team_id: TeamId;
  readonly batting_order: number;
  readonly position: PlayerPosition;
  readonly starting_status: StartingStatus;
}

// ---------------------------------------------------------------------------
// Merge inputs — one side of one game
// ---------------------------------------------------------------------------

/**
 * All available candidates for a single side (away or home) of a game.
 * Each slot can have 0–3 candidates (one per tier).
 * Null means that tier had no data for this slot.
 */
export interface MergeSideInput {
  readonly starter: {
    readonly official: MergeStarterCandidate | null;
    readonly projected: MergeStarterCandidate | null;
    readonly inferred: MergeStarterCandidate | null;
  };
  readonly lineup: {
    readonly official: MergeLineupCandidate | null;
    readonly projected: MergeLineupCandidate | null;
    readonly inferred: MergeLineupCandidate | null;
  };
}

/**
 * Full merge input for one game.
 */
export interface MergeGameInput {
  readonly game_id: GameId;
  readonly away: MergeSideInput;
  readonly home: MergeSideInput;
}

// ---------------------------------------------------------------------------
// Merge result — provenance-tagged outputs
// ---------------------------------------------------------------------------

/**
 * Explanation of which tier won and which tiers were available but lost.
 */
export interface MergeExplanation {
  readonly winner_tier: SourceTier;
  /** Tiers that had data but were overridden by a higher tier. */
  readonly overridden_tiers: readonly SourceTier[];
  /** Tiers that had no data for this slot. */
  readonly absent_tiers: readonly SourceTier[];
  /** Human-readable explanation. */
  readonly reason: string;
}

/**
 * A "none" explanation when no tier had data for the slot.
 */
export interface MergeNoneExplanation {
  readonly winner_tier: null;
  readonly overridden_tiers: readonly [];
  readonly absent_tiers: readonly SourceTier[];
  readonly reason: string;
}

export type MergeSlotExplanation = MergeExplanation | MergeNoneExplanation;

/**
 * Merged starter output — the winner plus provenance.
 */
export interface MergedStarter {
  readonly player_id: PlayerId;
  readonly team_id: TeamId;
  readonly handedness: Handedness;
  readonly starting_status: StartingStatus;
  readonly source_tier: SourceTier;
  readonly merge_explanation: MergeExplanation;
}

/**
 * Merged lineup entry — same canonical shape, tagged with source tier.
 */
export interface MergedLineupEntry {
  readonly player_id: PlayerId;
  readonly team_id: TeamId;
  readonly batting_order: number;
  readonly position: PlayerPosition;
  readonly starting_status: StartingStatus;
}

/**
 * Merged lineup output — the winning lineup plus provenance.
 */
export interface MergedLineup {
  readonly entries: readonly MergedLineupEntry[];
  readonly source_tier: SourceTier;
  readonly merge_explanation: MergeExplanation;
}

/**
 * Merged result for one side of a game.
 */
export interface MergedSide {
  readonly starter: MergedStarter | null;
  readonly starter_explanation: MergeSlotExplanation;
  readonly lineup: MergedLineup | null;
  readonly lineup_explanation: MergeSlotExplanation;
}

/**
 * Merged result for one game — both sides resolved.
 */
export interface MergedGame {
  readonly game_id: GameId;
  readonly away: MergedSide;
  readonly home: MergedSide;
}
