import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { asGameId, asISOTimestamp, asPlayerId } from "@lib/contracts/types";
import { STARTER_INTELLIGENCE_TABLE, STARTER_SOURCES_TABLE } from "./constants";
import type {
  GameStarterIntelligenceRow,
  RawGameStarterIntelligenceRow,
  StarterFreshnessStatus,
  StarterSourceRow,
  StarterSourceTier,
  StarterStatus
} from "./types";

// ---------------------------------------------------------------------------
// Raw → parsed row helper
// ---------------------------------------------------------------------------

const parseRawRow = (raw: RawGameStarterIntelligenceRow): GameStarterIntelligenceRow => ({
  id: raw.id,
  game_id: asGameId(raw.game_id),
  game_date: raw.game_date,
  away_team_abbreviation: raw.away_team_abbreviation,
  home_team_abbreviation: raw.home_team_abbreviation,
  away: {
    player_id: raw.away_starter_player_id !== null ? asPlayerId(raw.away_starter_player_id) : null,
    mlb_stats_api_id: raw.away_starter_mlb_stats_api_id,
    full_name: raw.away_starter_full_name,
    source_key: raw.away_starter_source_key,
    source_tier: raw.away_starter_source_tier as StarterSourceTier | null,
    confidence: raw.away_starter_confidence,
    freshness_status: raw.away_starter_freshness_status as StarterFreshnessStatus | null,
    observed_at: raw.away_starter_observed_at !== null ? asISOTimestamp(raw.away_starter_observed_at) : null,
    source_updated_at: raw.away_starter_source_updated_at !== null ? asISOTimestamp(raw.away_starter_source_updated_at) : null,
    status: raw.away_starter_status as StarterStatus | null,
    raw_ref: raw.away_starter_raw_ref
  },
  home: {
    player_id: raw.home_starter_player_id !== null ? asPlayerId(raw.home_starter_player_id) : null,
    mlb_stats_api_id: raw.home_starter_mlb_stats_api_id,
    full_name: raw.home_starter_full_name,
    source_key: raw.home_starter_source_key,
    source_tier: raw.home_starter_source_tier as StarterSourceTier | null,
    confidence: raw.home_starter_confidence,
    freshness_status: raw.home_starter_freshness_status as StarterFreshnessStatus | null,
    observed_at: raw.home_starter_observed_at !== null ? asISOTimestamp(raw.home_starter_observed_at) : null,
    source_updated_at: raw.home_starter_source_updated_at !== null ? asISOTimestamp(raw.home_starter_source_updated_at) : null,
    status: raw.home_starter_status as StarterStatus | null,
    raw_ref: raw.home_starter_raw_ref
  },
  resolution_notes: raw.resolution_notes,
  created_at: asISOTimestamp(raw.created_at),
  updated_at: asISOTimestamp(raw.updated_at)
});

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
    interface QueryResult {
      readonly data: unknown;
      readonly error: PostgrestError | null;
    }

    const { data, error } = (await client
      .from(STARTER_SOURCES_TABLE)
      .select("id, source_key, source_name, source_type, is_active, created_at, updated_at")
      .order("source_key")) as QueryResult;

    if (error) {
      throw new Error(`Failed to read starter sources: ${error.message}`);
    }

    if (!Array.isArray(data)) {
      throw new Error("Failed to read starter sources: response was not an array.");
    }

    return data as readonly StarterSourceRow[];
  },

  readGameStarterIntelligence: async (
    gameId: string,
    gameDate: string
  ): Promise<GameStarterIntelligenceRow | null> => {
    interface SingleQueryResult {
      readonly data: RawGameStarterIntelligenceRow | null;
      readonly error: PostgrestError | null;
    }

    const { data, error } = (await client
      .from(STARTER_INTELLIGENCE_TABLE)
      .select("*")
      .eq("game_id", gameId)
      .eq("game_date", gameDate)
      .maybeSingle()) as SingleQueryResult;

    if (error) {
      throw new Error(`Failed to read game starter intelligence [${gameId}]: ${error.message}`);
    }

    return data !== null ? parseRawRow(data) : null;
  },

  readGameStarterIntelligenceByDate: async (
    gameDate: string
  ): Promise<readonly GameStarterIntelligenceRow[]> => {
    interface QueryResult {
      readonly data: unknown;
      readonly error: PostgrestError | null;
    }

    const { data, error } = (await client
      .from(STARTER_INTELLIGENCE_TABLE)
      .select("*")
      .eq("game_date", gameDate)
      .order("game_id")) as QueryResult;

    if (error) {
      throw new Error(`Failed to read starter intelligence for date ${gameDate}: ${error.message}`);
    }

    if (!Array.isArray(data)) {
      throw new Error(`Failed to read starter intelligence for date ${gameDate}: response was not an array.`);
    }

    return (data as RawGameStarterIntelligenceRow[]).map(parseRawRow);
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
