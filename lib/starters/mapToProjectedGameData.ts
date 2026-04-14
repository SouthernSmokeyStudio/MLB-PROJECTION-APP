/**
 * mapToProjectedGameData.ts
 *
 * Pure mapper: GameStarterIntelligenceRow → ProjectedGameData.
 *
 * Used in the read path to supply owned Starter Intelligence as the projected
 * tier input for the merge law.  The merge law (official > projected > inferred)
 * resolves precedence — this mapper only converts shape.
 *
 * Fail-closed rules:
 *  - Side with null player_id → null starter (no data to project).
 *  - Side with freshness_status === "stale" → null starter (reject stale truth).
 */

import type { GameStarterIntelligenceRow, StarterSideIntelligence } from "./types";
import type { ProjectedGameData, ProjectedStarter } from "@lib/contracts/projected-source";
import type { GameId, StartingStatus } from "@lib/contracts/types";
import { asTeamId } from "@lib/contracts/types";

const mapStartingStatus = (status: string | null): StartingStatus => {
  switch (status) {
    case "confirmed":
      return "confirmed";
    case "projected":
      return "probable";
    case "reported":
      return "expected";
    default:
      return "unknown";
  }
};

const mapConfidence = (confidence: number | null): "high" | "medium" | "low" => {
  if (confidence === null) return "low";
  if (confidence >= 0.85) return "high";
  if (confidence >= 0.60) return "medium";
  return "low";
};

const mapSide = (
  side: StarterSideIntelligence,
  teamAbbreviation: string
): ProjectedStarter | null => {
  // Fail closed: no player identity → nothing to project.
  if (side.player_id === null) return null;

  // Fail closed: stale intelligence must not overwrite valid truth downstream.
  if (side.freshness_status === "stale") return null;

  return {
    player_id: side.player_id,
    full_name: side.full_name,
    team_id: asTeamId(teamAbbreviation),
    // SI rows do not carry handedness; "unknown" is the correct canonical
    // default and will be refined by the stats API fetch downstream.
    handedness: "unknown",
    starting_status: mapStartingStatus(side.status),
    confidence: mapConfidence(side.confidence)
  };
};

/**
 * Map one GameStarterIntelligenceRow to the canonical ProjectedGameData shape.
 * Sides with no usable player identity are represented as null starters.
 */
export const mapRowToProjectedGameData = (
  row: GameStarterIntelligenceRow
): ProjectedGameData => ({
  game_id: row.game_id,
  away_starter: mapSide(row.away, row.away_team_abbreviation),
  home_starter: mapSide(row.home, row.home_team_abbreviation),
  away_lineup: null,
  home_lineup: null
});

/**
 * Map a collection of rows to a GameId-keyed map ready for loadLiveSlate().
 * Games with no usable starters on either side are still included — they get
 * null starters, which the merge law treats as absent (no-op).
 */
export const mapStarterIntelligenceToProjectedGamesMap = (
  rows: readonly GameStarterIntelligenceRow[]
): ReadonlyMap<GameId, ProjectedGameData> =>
  new Map(rows.map((row) => [row.game_id, mapRowToProjectedGameData(row)]));
