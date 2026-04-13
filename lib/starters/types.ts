import type { GameId, ISOTimestamp, PlayerId } from "@lib/contracts/types";
import type {
  STARTER_SOURCE_TIERS,
  STARTER_STATUSES,
  STARTER_FRESHNESS_STATUSES,
  STARTER_SOURCE_TYPES
} from "./constants";

export type StarterSourceTier = (typeof STARTER_SOURCE_TIERS)[number];
export type StarterStatus = (typeof STARTER_STATUSES)[number];
export type StarterFreshnessStatus = (typeof STARTER_FRESHNESS_STATUSES)[number];
export type StarterSourceType = (typeof STARTER_SOURCE_TYPES)[number];

/** Parsed row from starter_sources. */
export interface StarterSourceRow {
  readonly id: string;
  readonly source_key: string;
  readonly source_name: string;
  readonly source_type: StarterSourceType;
  readonly is_active: boolean;
  readonly created_at: ISOTimestamp;
  readonly updated_at: ISOTimestamp;
}

/**
 * Per-side starter intelligence with independent provenance, confidence,
 * freshness, observed time, and source-updated time.
 * Used in application-layer code; branded types applied after DB parse.
 */
export interface StarterSideIntelligence {
  readonly player_id: PlayerId | null;
  readonly mlb_stats_api_id: string | null;
  readonly full_name: string | null;
  readonly source_key: string | null;
  readonly source_tier: StarterSourceTier | null;
  readonly confidence: number | null;
  readonly freshness_status: StarterFreshnessStatus | null;
  readonly observed_at: ISOTimestamp | null;
  readonly source_updated_at: ISOTimestamp | null;
  readonly status: StarterStatus | null;
  readonly raw_ref: Record<string, unknown> | null;
}

/** Parsed canonical row from game_starter_intelligence. */
export interface GameStarterIntelligenceRow {
  readonly id: string;
  readonly game_id: GameId;
  readonly game_date: string;
  readonly away_team_abbreviation: string;
  readonly home_team_abbreviation: string;
  readonly away: StarterSideIntelligence;
  readonly home: StarterSideIntelligence;
  readonly resolution_notes: string | null;
  readonly created_at: ISOTimestamp;
  readonly updated_at: ISOTimestamp;
}

/**
 * Flat DB row as returned by Supabase before parsing.
 * All per-side fields are nullable — truth may be unknown at write time.
 */
export interface RawGameStarterIntelligenceRow {
  readonly id: string;
  readonly game_id: string;
  readonly game_date: string;
  readonly away_team_abbreviation: string;
  readonly home_team_abbreviation: string;

  readonly away_starter_player_id: string | null;
  readonly away_starter_mlb_stats_api_id: string | null;
  readonly away_starter_full_name: string | null;
  readonly away_starter_source_key: string | null;
  readonly away_starter_source_tier: string | null;
  readonly away_starter_confidence: number | null;
  readonly away_starter_freshness_status: string | null;
  readonly away_starter_observed_at: string | null;
  readonly away_starter_source_updated_at: string | null;
  readonly away_starter_status: string | null;
  readonly away_starter_raw_ref: Record<string, unknown> | null;

  readonly home_starter_player_id: string | null;
  readonly home_starter_mlb_stats_api_id: string | null;
  readonly home_starter_full_name: string | null;
  readonly home_starter_source_key: string | null;
  readonly home_starter_source_tier: string | null;
  readonly home_starter_confidence: number | null;
  readonly home_starter_freshness_status: string | null;
  readonly home_starter_observed_at: string | null;
  readonly home_starter_source_updated_at: string | null;
  readonly home_starter_status: string | null;
  readonly home_starter_raw_ref: Record<string, unknown> | null;

  readonly resolution_notes: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}
