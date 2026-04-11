/**
 * projected-source.ts
 *
 * Provider-neutral contract for projected starters and lineups.
 *
 * Any projected-source adapter (Rotowire, FanGraphs, manual entry, etc.)
 * must produce these canonical shapes.  Provider-specific fields stay inside
 * the adapter — they never leak into this contract or downstream consumers.
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
// Canonical projected entries
// ---------------------------------------------------------------------------

/**
 * A projected starting pitcher for one side of a game.
 * Mirrors the existing ProbablePitcher shape so it can merge into
 * TeamGameContext without conversion.
 */
export interface ProjectedStarter {
  readonly player_id: PlayerId;
  readonly full_name: string | null;
  readonly team_id: TeamId;
  readonly handedness: Handedness;
  readonly starting_status: StartingStatus;
  readonly confidence: "high" | "medium" | "low";
}

/**
 * A single projected lineup entry for one batter.
 * Mirrors the existing LineupEntry shape so it can merge into
 * TeamGameContext without conversion.
 */
export interface ProjectedLineupEntry {
  readonly player_id: PlayerId;
  readonly team_id: TeamId;
  readonly batting_order: number;
  readonly position: PlayerPosition;
  readonly starting_status: StartingStatus;
}

/**
 * One game's worth of projected data from a single provider.
 */
export interface ProjectedGameData {
  readonly game_id: GameId;
  readonly away_starter: ProjectedStarter | null;
  readonly home_starter: ProjectedStarter | null;
  readonly away_lineup: readonly ProjectedLineupEntry[] | null;
  readonly home_lineup: readonly ProjectedLineupEntry[] | null;
}

// ---------------------------------------------------------------------------
// Adapter result
// ---------------------------------------------------------------------------

/**
 * Metadata about the provider that sourced the projected data.
 * Stays at the adapter boundary — downstream consumers see only
 * the canonical ProjectedGameData entries.
 */
export interface ProjectedSourceProviderMeta {
  readonly provider: string;
  readonly fetched_at: ISOTimestamp;
  readonly source_url: string | null;
}

/**
 * The canonical result shape every projected-source adapter must return.
 * Uses the standard Result<T, string> pattern from the codebase.
 *
 * On success: contains provider metadata + an array of ProjectedGameData.
 * On failure: contains an error string.  The caller treats adapter failure
 * as "no projected data available" — fail-closed.
 */
export interface ProjectedSourceResult {
  readonly provider_meta: ProjectedSourceProviderMeta;
  readonly date: string;
  readonly generated_at: ISOTimestamp;
  readonly games: readonly ProjectedGameData[];
}

// ---------------------------------------------------------------------------
// Adapter interface
// ---------------------------------------------------------------------------

/**
 * The swappable adapter boundary.  Any provider implements this interface.
 * The `source` discriminant ensures callers cannot accidentally mix providers.
 */
export interface ProjectedSourceAdapter {
  readonly source: string;
  fetchProjectedData(
    date: string
  ): Promise<import("./types").Result<ProjectedSourceResult, string>>;
}
