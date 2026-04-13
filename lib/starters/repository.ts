import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { STARTER_INTELLIGENCE_TABLE, STARTER_SOURCES_TABLE } from "./constants";
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
 */
export interface StarterIntelligenceRepository {
  /**
   * Asserts the given source_key exists in starter_sources.
   * Throws loudly if missing — fail closed before any ingest proceeds.
   */
  assertStarterSourceRegistered(sourceKey: string): Promise<void>;

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
 * read* methods are deferred (Slice 3+). upsertGameStarterIntelligence is
 * fully implemented for the Slice 2 ingest path.
 */
export const createStarterIntelligenceRepository = (
  client: SupabaseClient
): StarterIntelligenceRepository => ({
  assertStarterSourceRegistered: async (sourceKey: string): Promise<void> => {
    interface AssertQueryResult {
      readonly data: { readonly source_key: string } | null;
      readonly error: PostgrestError | null;
    }

    const { data, error } = (await client
      .from(STARTER_SOURCES_TABLE)
      .select("source_key")
      .eq("source_key", sourceKey)
      .single()) as AssertQueryResult;

    if (error !== null || data === null) {
      throw new Error(
        `Starter source not registered: "${sourceKey}". ` +
        `Run supabase/migrations/20260413000001_seed_starter_sources.sql before ingesting.`
      );
    }
  },

  readStarterSources: async (): Promise<readonly StarterSourceRow[]> => {
    throw new Error("readStarterSources: not implemented — read path deferred.");
  },

  readGameStarterIntelligence: async (
    _gameId: string,
    _gameDate: string
  ): Promise<GameStarterIntelligenceRow | null> => {
    throw new Error("readGameStarterIntelligence: not implemented — read path deferred.");
  },

  readGameStarterIntelligenceByDate: async (
    _gameDate: string
  ): Promise<readonly GameStarterIntelligenceRow[]> => {
    throw new Error("readGameStarterIntelligenceByDate: not implemented — read path deferred.");
  },

  upsertGameStarterIntelligence: async (
    payload: UpsertGameStarterIntelligencePayload
  ): Promise<RawGameStarterIntelligenceRow> => {
    interface SupabaseQueryResult {
      readonly data: unknown;
      readonly error: PostgrestError | null;
    }

    const { data, error } = (await client
      .from(STARTER_INTELLIGENCE_TABLE)
      .upsert(
        { ...payload, updated_at: new Date().toISOString() },
        { onConflict: "game_id" }
      )
      .select()
      .single()) as SupabaseQueryResult;

    if (error) {
      throw new Error(`Failed to upsert game starter intelligence [${payload.game_id}]: ${error.message}`);
    }

    return data as RawGameStarterIntelligenceRow;
  }
});
