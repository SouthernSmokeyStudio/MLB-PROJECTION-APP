/**
 * resolveGameSources.ts
 *
 * Orchestrates the full normalize → merge pipeline for one game.
 * Takes native tier types, normalizes to merge candidates, runs the
 * merge law, and returns the resolved MergedGame.
 *
 * Also provides applyMergedStarterToCanonical to patch a CanonicalGame's
 * probable_pitcher based on merge winners, so the existing preparation
 * pipeline can consume the merge result without changes.
 *
 * Pure functions — no side effects.
 */

import type { CanonicalGame, ProbablePitcher } from "@lib/contracts/canonical";
import type { ProjectedGameData } from "@lib/contracts/projected-source";
import type { InferredGameData } from "@lib/contracts/inferred-source";
import type { MergedGame } from "@lib/contracts/merge-law";
import { mergeGameSources } from "./mergeGameSources";
import { buildMergeGameInput, type PerGameSourceData } from "./normalizeToMergeInput";

/**
 * Resolve all available source tiers for one game into a MergedGame.
 *
 * This is the primary integration point — callers pass the canonical game
 * plus optional projected/inferred data, and get back a fully resolved
 * MergedGame with provenance metadata.
 */
export const resolveGameSources = (
  canonicalGame: CanonicalGame,
  projected?: ProjectedGameData | null,
  inferred?: InferredGameData | null
): MergedGame => {
  const sources: PerGameSourceData = {
    official: {
      away_starter: canonicalGame.away.probable_pitcher,
      home_starter: canonicalGame.home.probable_pitcher,
      away_lineup: canonicalGame.away.lineup,
      home_lineup: canonicalGame.home.lineup,
      away_team_id: canonicalGame.away.team.team_id,
      home_team_id: canonicalGame.home.team.team_id
    },
    projected: projected ?? null,
    inferred: inferred ?? null
  };

  const mergeInput = buildMergeGameInput(canonicalGame.game_id, sources);
  return mergeGameSources(mergeInput);
};

/**
 * Apply merge winners to a CanonicalGame's probable_pitcher fields.
 *
 * When the merge winner is from a non-official tier, we create a synthetic
 * ProbablePitcher from the merge winner's identity so the existing
 * preparation pipeline (prepareGameInputs) can consume it unchanged.
 *
 * When the merge winner is official (or null), the canonical game is
 * returned as-is — zero behavioral change from the pre-merge path.
 *
 * This function does NOT modify lineups — lineup merge winners are
 * consumed separately downstream (future sub-slice).
 */
export const applyMergedStartersToCanonical = (
  canonicalGame: CanonicalGame,
  merged: MergedGame
): CanonicalGame => {
  const awayStarter = patchProbablePitcher(
    canonicalGame.away.probable_pitcher,
    merged.away.starter
  );
  const homeStarter = patchProbablePitcher(
    canonicalGame.home.probable_pitcher,
    merged.home.starter
  );

  // Short-circuit: if nothing changed, return the original object
  if (
    awayStarter === canonicalGame.away.probable_pitcher &&
    homeStarter === canonicalGame.home.probable_pitcher
  ) {
    return canonicalGame;
  }

  return {
    ...canonicalGame,
    away: {
      ...canonicalGame.away,
      probable_pitcher: awayStarter
    },
    home: {
      ...canonicalGame.home,
      probable_pitcher: homeStarter
    }
  };
};

/**
 * Patch a single side's probable_pitcher based on the merge winner.
 *
 * Returns the ORIGINAL pitcher (same reference) when:
 *   - merge winner is null (no data from any tier)
 *   - merge winner is official tier (already matches canonical)
 *
 * Returns a synthetic ProbablePitcher when merge winner is projected/inferred.
 */
const patchProbablePitcher = (
  original: ProbablePitcher | null,
  mergedStarter: MergedGame["away"]["starter"]
): ProbablePitcher | null => {
  // No merge winner → keep original (which may also be null)
  if (mergedStarter === null) return original;

  // Official tier won → canonical already has the right pitcher
  if (mergedStarter.source_tier === "official") return original;

  // Non-official tier won → synthesize a ProbablePitcher from merge winner.
  // Propagate mlb_stats_api_id from the original when available: this preserves
  // the numeric id when official data existed before being superseded by a
  // projected/inferred winner (e.g. a same-day swap).  When original is null
  // (no official pitcher was ever listed), mlb_stats_api_id stays null here and
  // is back-filled from the boxscore in loadLiveSlate before reconciliation runs.
  return {
    player_id: mergedStarter.player_id,
    mlb_stats_api_id: original?.mlb_stats_api_id ?? null,
    starting_status: mergedStarter.starting_status,
    handedness: mergedStarter.handedness
  };
};
