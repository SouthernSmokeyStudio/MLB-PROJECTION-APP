/**
 * mergeGameSources.ts
 *
 * Pure, deterministic merge function implementing the three-tier override law:
 *   official (Tier 1) > projected (Tier 2) > inferred (Tier 3) > none
 *
 * Each slot (starter, lineup) on each side (away, home) is resolved
 * independently.  The highest-tier non-null candidate wins entirely —
 * there is NO partial blending across tiers within a slot.
 *
 * This is a pure function with zero side effects.
 */

import type {
  MergeGameInput,
  MergedGame,
  MergedLineup,
  MergedLineupEntry,
  MergedSide,
  MergedStarter,
  MergeExplanation,
  MergeLineupCandidate,
  MergeNoneExplanation,
  MergeSlotExplanation,
  MergeStarterCandidate,
  SourceTier
} from "@lib/contracts/merge-law";
import { SOURCE_TIER } from "@lib/contracts/merge-law";

// ---------------------------------------------------------------------------
// Tier ordering helpers
// ---------------------------------------------------------------------------

const ALL_TIERS: readonly SourceTier[] = ["official", "projected", "inferred"] as const;

/**
 * Returns the winning tier from a set of candidates, or null if all are null.
 * Candidates are checked in strict precedence order.
 */
const pickWinner = <T extends { readonly tier: SourceTier }>(
  candidates: { readonly official: T | null; readonly projected: T | null; readonly inferred: T | null }
): T | null => {
  // Strict precedence order — no comparison needed, just first non-null
  if (candidates.official !== null) return candidates.official;
  if (candidates.projected !== null) return candidates.projected;
  if (candidates.inferred !== null) return candidates.inferred;
  return null;
};

/**
 * Build the merge explanation for a slot.
 */
const buildExplanation = (
  winnerTier: SourceTier | null,
  available: { readonly official: unknown | null; readonly projected: unknown | null; readonly inferred: unknown | null }
): MergeSlotExplanation => {
  const presentTiers = ALL_TIERS.filter((t) => available[t] !== null);
  const absentTiers = ALL_TIERS.filter((t) => available[t] === null);

  if (winnerTier === null) {
    const explanation: MergeNoneExplanation = {
      winner_tier: null,
      overridden_tiers: [],
      absent_tiers: absentTiers,
      reason: "No tier had data for this slot"
    };
    return explanation;
  }

  const overriddenTiers = presentTiers.filter((t) => t !== winnerTier);

  const explanation: MergeExplanation = {
    winner_tier: winnerTier,
    overridden_tiers: overriddenTiers,
    absent_tiers: absentTiers,
    reason: overriddenTiers.length > 0
      ? `${winnerTier} (tier ${SOURCE_TIER[winnerTier]}) overrides ${overriddenTiers.join(", ")}`
      : `${winnerTier} (tier ${SOURCE_TIER[winnerTier]}) is the only available source`
  };
  return explanation;
};

// ---------------------------------------------------------------------------
// Slot merge functions
// ---------------------------------------------------------------------------

const mergeStarter = (
  candidates: { readonly official: MergeStarterCandidate | null; readonly projected: MergeStarterCandidate | null; readonly inferred: MergeStarterCandidate | null }
): { starter: MergedStarter | null; explanation: MergeSlotExplanation } => {
  const winner = pickWinner(candidates);

  if (winner === null) {
    return {
      starter: null,
      explanation: buildExplanation(null, candidates)
    };
  }

  const explanation = buildExplanation(winner.tier, candidates) as MergeExplanation;

  return {
    starter: {
      player_id: winner.player_id,
      team_id: winner.team_id,
      handedness: winner.handedness,
      starting_status: winner.starting_status,
      source_tier: winner.tier,
      merge_explanation: explanation
    },
    explanation
  };
};

const mergeLineup = (
  candidates: { readonly official: MergeLineupCandidate | null; readonly projected: MergeLineupCandidate | null; readonly inferred: MergeLineupCandidate | null }
): { lineup: MergedLineup | null; explanation: MergeSlotExplanation } => {
  const winner = pickWinner(candidates);

  if (winner === null) {
    return {
      lineup: null,
      explanation: buildExplanation(null, candidates)
    };
  }

  const explanation = buildExplanation(winner.tier, candidates) as MergeExplanation;

  const entries: readonly MergedLineupEntry[] = winner.entries.map((e) => ({
    player_id: e.player_id,
    team_id: e.team_id,
    batting_order: e.batting_order,
    position: e.position,
    starting_status: e.starting_status
  }));

  return {
    lineup: {
      entries,
      source_tier: winner.tier,
      merge_explanation: explanation
    },
    explanation
  };
};

// ---------------------------------------------------------------------------
// Side merge
// ---------------------------------------------------------------------------

const mergeSide = (side: {
  readonly starter: { readonly official: MergeStarterCandidate | null; readonly projected: MergeStarterCandidate | null; readonly inferred: MergeStarterCandidate | null };
  readonly lineup: { readonly official: MergeLineupCandidate | null; readonly projected: MergeLineupCandidate | null; readonly inferred: MergeLineupCandidate | null };
}): MergedSide => {
  const starterResult = mergeStarter(side.starter);
  const lineupResult = mergeLineup(side.lineup);

  return {
    starter: starterResult.starter,
    starter_explanation: starterResult.explanation,
    lineup: lineupResult.lineup,
    lineup_explanation: lineupResult.explanation
  };
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Merge all available source tiers for one game into a single resolved output.
 *
 * Pure function — no side effects, fully deterministic.
 */
export const mergeGameSources = (input: MergeGameInput): MergedGame => ({
  game_id: input.game_id,
  away: mergeSide(input.away),
  home: mergeSide(input.home)
});
