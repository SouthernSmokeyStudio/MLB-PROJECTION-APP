import type { GameStarterIntelligenceRow, RawGameStarterIntelligenceRow, StarterSourceRow } from "./types";

/**
 * Upsert payload for a single game's starter intelligence.
 * The canonical key is game_id — one record per game, upsert on conflict.
 * Per-side fields are optional: callers may write partial intelligence
 * when only one side is known.
 */
export interface UpsertGameStarterIntelligencePayload {
  readonly game_id: string;
  readonly game_date: string;
  readonly away_team_abbreviation: string;
  readonly home_team_abbreviation: string;

  readonly away_starter_player_id?: string | null;
  readonly away_starter_mlb_stats_api_id?: string | null;
  readonly away_starter_full_name?: string | null;
  readonly away_starter_source_key?: string | null;
  readonly away_starter_source_tier?: string | null;
  readonly away_starter_confidence?: number | null;
  readonly away_starter_freshness_status?: string | null;
  readonly away_starter_observed_at?: string | null;
  readonly away_starter_source_updated_at?: string | null;
  readonly away_starter_status?: string | null;
  readonly away_starter_raw_ref?: Record<string, unknown> | null;

  readonly home_starter_player_id?: string | null;
  readonly home_starter_mlb_stats_api_id?: string | null;
  readonly home_starter_full_name?: string | null;
  readonly home_starter_source_key?: string | null;
  readonly home_starter_source_tier?: string | null;
  readonly home_starter_confidence?: number | null;
  readonly home_starter_freshness_status?: string | null;
  readonly home_starter_observed_at?: string | null;
  readonly home_starter_source_updated_at?: string | null;
  readonly home_starter_status?: string | null;
  readonly home_starter_raw_ref?: Record<string, unknown> | null;

  readonly resolution_notes?: string | null;
}

/**
 * Type-safe repository interface for starter intelligence storage.
 * Slice 1: contract boundary only. Implementation deferred to Slice 2.
 */
export interface StarterIntelligenceRepository {
  readStarterSources(): Promise<readonly StarterSourceRow[]>;

  readGameStarterIntelligence(
    gameId: string,
    gameDate: string
  ): Promise<GameStarterIntelligenceRow | null>;

  readGameStarterIntelligenceByDate(
    gameDate: string
  ): Promise<readonly GameStarterIntelligenceRow[]>;

  upsertGameStarterIntelligence(
    payload: UpsertGameStarterIntelligencePayload
  ): Promise<RawGameStarterIntelligenceRow>;
}

/**
 * Creates the starter intelligence repository bound to a Supabase client.
 * Placeholder — throws until Slice 2 implementation is wired.
 */
export const createStarterIntelligenceRepository = (
  _client: unknown
): StarterIntelligenceRepository => {
  throw new Error(
    "createStarterIntelligenceRepository: not implemented — Slice 2 implementation required."
  );
};
