/**
 * normalizeToMergeInput.ts
 *
 * Pure functions that convert each source tier's native types into the
 * tier-tagged merge-law candidates.  This is the boundary between
 * provider-specific shapes and the provider-neutral merge law.
 *
 * No side effects, no I/O.
 */

import type { ProbablePitcher, LineupEntry } from "@lib/contracts/canonical";
import type { ProjectedStarter, ProjectedLineupEntry, ProjectedGameData } from "@lib/contracts/projected-source";
import type { InferredStarter, InferredLineupEntry, InferredGameData } from "@lib/contracts/inferred-source";
import type {
  MergeGameInput,
  MergeLineupCandidate,
  MergeLineupEntryCandidate,
  MergeSideInput,
  MergeStarterCandidate
} from "@lib/contracts/merge-law";
import type { GameId, TeamId } from "@lib/contracts/types";

// ---------------------------------------------------------------------------
// Official tier (from canonical ProbablePitcher / LineupEntry)
// ---------------------------------------------------------------------------

/**
 * Normalize an official ProbablePitcher into a merge starter candidate.
 * Returns null when the canonical game has no probable pitcher for this side.
 */
export const officialStarterToCandidate = (
  pitcher: ProbablePitcher | null,
  teamId: TeamId
): MergeStarterCandidate | null => {
  if (pitcher === null) return null;
  return {
    tier: "official",
    player_id: pitcher.player_id,
    team_id: teamId,
    handedness: pitcher.handedness,
    starting_status: pitcher.starting_status
  };
};

/**
 * Normalize official lineup entries into a merge lineup candidate.
 * Returns null when the canonical game has no lineup for this side.
 */
export const officialLineupToCandidate = (
  lineup: readonly LineupEntry[] | null,
  teamId: TeamId
): MergeLineupCandidate | null => {
  if (lineup === null || lineup.length === 0) return null;
  return {
    tier: "official",
    entries: lineup.map<MergeLineupEntryCandidate>((e) => ({
      player_id: e.player_id,
      team_id: teamId,
      batting_order: e.batting_order ?? 0,
      position: e.position,
      starting_status: e.starting_status
    }))
  };
};

// ---------------------------------------------------------------------------
// Projected tier (from ProjectedStarter / ProjectedLineupEntry)
// ---------------------------------------------------------------------------

export const projectedStarterToCandidate = (
  starter: ProjectedStarter | null
): MergeStarterCandidate | null => {
  if (starter === null) return null;
  return {
    tier: "projected",
    player_id: starter.player_id,
    team_id: starter.team_id,
    handedness: starter.handedness,
    starting_status: starter.starting_status,
    projection_confidence: starter.confidence
  };
};

export const projectedLineupToCandidate = (
  lineup: readonly ProjectedLineupEntry[] | null
): MergeLineupCandidate | null => {
  if (lineup === null || lineup.length === 0) return null;
  return {
    tier: "projected",
    entries: lineup.map<MergeLineupEntryCandidate>((e) => ({
      player_id: e.player_id,
      team_id: e.team_id,
      batting_order: e.batting_order,
      position: e.position,
      starting_status: e.starting_status
    }))
  };
};

// ---------------------------------------------------------------------------
// Inferred tier (from InferredStarter / InferredLineupEntry)
// ---------------------------------------------------------------------------

export const inferredStarterToCandidate = (
  starter: InferredStarter | null
): MergeStarterCandidate | null => {
  if (starter === null) return null;
  return {
    tier: "inferred",
    player_id: starter.player_id,
    team_id: starter.team_id,
    handedness: starter.handedness,
    starting_status: starter.starting_status,
    inference_confidence: starter.inference.confidence
  };
};

export const inferredLineupToCandidate = (
  lineup: readonly InferredLineupEntry[] | null
): MergeLineupCandidate | null => {
  if (lineup === null || lineup.length === 0) return null;
  return {
    tier: "inferred",
    entries: lineup.map<MergeLineupEntryCandidate>((e) => ({
      player_id: e.player_id,
      team_id: e.team_id,
      batting_order: e.batting_order,
      position: e.position,
      starting_status: e.starting_status
    }))
  };
};

// ---------------------------------------------------------------------------
// Full-game assembly
// ---------------------------------------------------------------------------

export interface PerGameSourceData {
  /** Official data: from the CanonicalGame's TeamGameContext. */
  readonly official?: {
    readonly away_starter: ProbablePitcher | null;
    readonly home_starter: ProbablePitcher | null;
    readonly away_lineup: readonly LineupEntry[] | null;
    readonly home_lineup: readonly LineupEntry[] | null;
    readonly away_team_id: TeamId;
    readonly home_team_id: TeamId;
  };
  /** Projected data: from a ProjectedSourceAdapter, matched by game_id. */
  readonly projected?: ProjectedGameData | null;
  /** Inferred data: from an InferenceEngine, matched by game_id. */
  readonly inferred?: InferredGameData | null;
}

/**
 * Assemble a full MergeGameInput from all available tier sources for one game.
 *
 * When a tier's data is undefined or null, that tier contributes null
 * candidates — which the merge law correctly treats as absent.
 */
export const buildMergeGameInput = (
  gameId: GameId,
  sources: PerGameSourceData
): MergeGameInput => {
  const official = sources.official ?? null;
  const projected = sources.projected ?? null;
  const inferred = sources.inferred ?? null;

  const away: MergeSideInput = {
    starter: {
      official: official
        ? officialStarterToCandidate(official.away_starter, official.away_team_id)
        : null,
      projected: projected ? projectedStarterToCandidate(projected.away_starter) : null,
      inferred: inferred ? inferredStarterToCandidate(inferred.away_starter) : null
    },
    lineup: {
      official: official
        ? officialLineupToCandidate(official.away_lineup, official.away_team_id)
        : null,
      projected: projected ? projectedLineupToCandidate(projected.away_lineup) : null,
      inferred: inferred ? inferredLineupToCandidate(inferred.away_lineup) : null
    }
  };

  const home: MergeSideInput = {
    starter: {
      official: official
        ? officialStarterToCandidate(official.home_starter, official.home_team_id)
        : null,
      projected: projected ? projectedStarterToCandidate(projected.home_starter) : null,
      inferred: inferred ? inferredStarterToCandidate(inferred.home_starter) : null
    },
    lineup: {
      official: official
        ? officialLineupToCandidate(official.home_lineup, official.home_team_id)
        : null,
      projected: projected ? projectedLineupToCandidate(projected.home_lineup) : null,
      inferred: inferred ? inferredLineupToCandidate(inferred.home_lineup) : null
    }
  };

  return { game_id: gameId, away, home };
};
