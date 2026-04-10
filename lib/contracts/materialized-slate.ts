import type { GameId, ISOTimestamp } from "./types";
import type { PreparedGameInputs } from "./prepared";

/**
 * A single game entry inside a materialized slate artifact.
 */
export interface MaterializedGameEntry {
  readonly game_id: GameId;
  readonly prepared: PreparedGameInputs;
}

/**
 * On-disk artifact representing pre-computed PreparedGameInputs for a date.
 *
 * Future sub-slices will populate these artifacts from scheduled
 * materialization runs (projected inputs, inferred inputs, etc.).
 * For now, A2 establishes the contract, loader, and integration point.
 */
export interface MaterializedSlate {
  readonly version: 1;
  readonly date: string;
  readonly generated_at: ISOTimestamp;
  readonly source: string;
  readonly games: readonly MaterializedGameEntry[];
}

/**
 * Metadata returned alongside a successfully loaded materialized slate,
 * providing freshness and staleness information at the loader boundary.
 */
export interface MaterializedSlateMetadata {
  readonly artifact_path: string;
  readonly loaded_at: ISOTimestamp;
  readonly is_stale: boolean;
  readonly stale_reason: string | null;
  readonly age_ms: number;
  readonly games_available: number;
}

/**
 * Complete result of loading a materialized slate from disk.
 */
export interface LoadedMaterializedSlate {
  readonly slate: MaterializedSlate;
  readonly metadata: MaterializedSlateMetadata;
}
