import { asISOTimestamp, asPlayerId } from "@lib/contracts/types";
import type { StarterFreshnessStatus, StarterSideIntelligence, StarterSourceTier, StarterStatus } from "./types";

// ---------------------------------------------------------------------------
// Candidate shape
// ---------------------------------------------------------------------------

/**
 * One source's view of a starter for a single side of a game.
 * player_id is a raw string here — branding happens when the winner is
 * converted to StarterSideIntelligence via candidateToSideIntelligence().
 */
export interface StarterCandidate {
  readonly source_key: string;
  readonly source_tier: StarterSourceTier;
  readonly confidence: number;
  readonly freshness_status: StarterFreshnessStatus;
  readonly observed_at: string;
  readonly source_updated_at: string | null;
  readonly player_id: string | null;
  readonly full_name: string | null;
  readonly mlb_stats_api_id: string | null;
  readonly status: StarterStatus;
  readonly raw_ref: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Resolver input / output
// ---------------------------------------------------------------------------

export interface StarterResolutionInput {
  readonly game_id: string;
  readonly game_date: string;
  readonly away_candidates: readonly StarterCandidate[];
  readonly home_candidates: readonly StarterCandidate[];
}

/**
 * Resolved canonical per-side starter truth for a game.
 * Either side may be null: one-side-known truth is preserved;
 * an unresolvable or ambiguous side remains null.
 * resolution_notes is deterministic and audit-oriented.
 */
export interface StarterResolutionOutput {
  readonly away: StarterSideIntelligence | null;
  readonly home: StarterSideIntelligence | null;
  readonly resolution_notes: string | null;
}

// ---------------------------------------------------------------------------
// Resolution constants
// ---------------------------------------------------------------------------

/**
 * Minimum confidence difference required to declare a clear winner when
 * candidates at the same tier have conflicting names.
 * Below this threshold the resolution fails closed (ambiguous — no winner).
 */
const MATERIAL_CONFIDENCE_DELTA = 0.15;

const TIER_RANK: Readonly<Record<StarterSourceTier, number>> = {
  official: 4,
  reported: 3,
  projected: 2,
  inferred: 1
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const normalizeNameForComparison = (name: string | null): string =>
  (name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

const candidateToSideIntelligence = (c: StarterCandidate): StarterSideIntelligence => ({
  player_id: c.player_id !== null ? asPlayerId(c.player_id) : null,
  mlb_stats_api_id: c.mlb_stats_api_id,
  full_name: c.full_name,
  source_key: c.source_key,
  source_tier: c.source_tier,
  confidence: c.confidence,
  freshness_status: c.freshness_status,
  observed_at: asISOTimestamp(c.observed_at),
  source_updated_at: c.source_updated_at !== null
    ? asISOTimestamp(c.source_updated_at)
    : null,
  status: c.status,
  raw_ref: c.raw_ref
});

// ---------------------------------------------------------------------------
// Side resolver — deterministic, fail-closed on ambiguity
// ---------------------------------------------------------------------------

/**
 * Resolves the canonical starter for one side from a set of ranked candidates.
 *
 * Resolution rules (in priority order):
 * 1. Empty candidates → null — nothing known, nothing fabricated.
 * 2. Single candidate → winner, no ambiguity possible.
 * 3. Multiple candidates → isolate highest tier. If only one at that tier → winner.
 * 4. Multiple at same top tier:
 *    a. No name conflict (convergent sources) → highest confidence wins;
 *       materially equal confidence → deterministic tiebreak by source_key.
 *    b. Name conflict → if confidence delta > MATERIAL_CONFIDENCE_DELTA → higher wins.
 *    c. Name conflict, confidence delta ≤ threshold → AMBIGUOUS → null + notes.
 *
 * Name conflict detection: only non-null names participate. When all candidates
 * lack a name, there is no conflict — they are treated as convergent.
 *
 * All decisions are recorded in @param notes for audit.
 */
const resolveOneSide = (
  candidates: readonly StarterCandidate[],
  side: "away" | "home",
  notes: string[]
): StarterSideIntelligence | null => {
  if (candidates.length === 0) {
    return null;
  }

  if (candidates.length === 1) {
    const c = candidates[0]!;
    notes.push(
      `${side}: resolved single source=${c.source_key} tier=${c.source_tier} conf=${c.confidence.toFixed(2)}`
    );
    return candidateToSideIntelligence(c);
  }

  // Multiple candidates — isolate highest tier
  const maxRank = Math.max(...candidates.map((c) => TIER_RANK[c.source_tier]));
  const topTier = candidates.filter((c) => TIER_RANK[c.source_tier] === maxRank);
  const tierName = topTier[0]!.source_tier;

  if (topTier.length === 1) {
    const winner = topTier[0]!;
    const lowerCount = candidates.length - 1;
    notes.push(
      `${side}: resolved tier=${tierName} source=${winner.source_key} conf=${winner.confidence.toFixed(2)} over ${lowerCount} lower-tier candidate(s)`
    );
    return candidateToSideIntelligence(winner);
  }

  // Multiple at same top tier — check for name conflict among non-null names
  const namedCandidates = topTier.filter((c) => c.full_name !== null);
  const uniqueNonNullNames = new Set(namedCandidates.map((c) => normalizeNameForComparison(c.full_name)));
  const hasNameConflict = uniqueNonNullNames.size > 1;

  if (!hasNameConflict) {
    // Convergent: same player (or no names) from multiple same-tier sources
    const sorted = [...topTier].sort((a, b) => {
      const cDiff = b.confidence - a.confidence;
      if (cDiff !== 0) return cDiff;
      return a.source_key < b.source_key ? -1 : 1;
    });
    const winner = sorted[0]!;
    notes.push(
      `${side}: resolved convergent tier=${tierName} count=${topTier.length} source=${winner.source_key} conf=${winner.confidence.toFixed(2)}`
    );
    return candidateToSideIntelligence(winner);
  }

  // Name conflict — apply confidence delta tiebreaker
  const confSorted = [...topTier].sort((a, b) => {
    const cDiff = b.confidence - a.confidence;
    if (cDiff !== 0) return cDiff;
    return a.source_key < b.source_key ? -1 : 1;
  });
  const best = confSorted[0]!;
  const secondBest = confSorted[1]!;
  const delta = best.confidence - secondBest.confidence;

  if (delta > MATERIAL_CONFIDENCE_DELTA) {
    notes.push(
      `${side}: resolved by confidence tier=${tierName} winner=${best.full_name ?? "(null)"}[${best.source_key}] conf=${best.confidence.toFixed(2)} delta=${delta.toFixed(2)} > threshold`
    );
    return candidateToSideIntelligence(best);
  }

  // Fail closed — ambiguous
  const conflictDesc = topTier
    .map((c) => `${c.full_name ?? "(null)"}[${c.source_key}@${c.confidence.toFixed(2)}]`)
    .sort()
    .join(", ");
  notes.push(
    `${side}: AMBIGUOUS tier=${tierName} count=${topTier.length} candidates=[${conflictDesc}] delta=${delta.toFixed(2)} <= ${MATERIAL_CONFIDENCE_DELTA.toFixed(2)} — no winner chosen`
  );
  return null;
};

// ---------------------------------------------------------------------------
// Public resolver
// ---------------------------------------------------------------------------

/**
 * Resolves canonical current-row starter truth for a game from per-side candidate sets.
 * Side-aware and deterministic. Fails closed on ambiguity.
 * One-side-known truth is always preserved on the non-ambiguous side.
 */
export const resolveGameStarters = (
  input: StarterResolutionInput
): StarterResolutionOutput => {
  const notes: string[] = [];
  const away = resolveOneSide(input.away_candidates, "away", notes);
  const home = resolveOneSide(input.home_candidates, "home", notes);
  return {
    away,
    home,
    resolution_notes: notes.length > 0 ? notes.join(" | ") : null
  };
};
