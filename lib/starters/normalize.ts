import type { ProjectedSourceProviderMeta, ProjectedStarter } from "@lib/contracts/projected-source";
import { asISOTimestamp, asPlayerId } from "@lib/contracts/types";
import type { StarterFreshnessStatus, StarterSideIntelligence, StarterSourceTier, StarterStatus } from "./types";

// ---------------------------------------------------------------------------
// Constrained vocabulary constants for the projected-source ingest path
// ---------------------------------------------------------------------------

const ROTOWIRE_SOURCE_KEY = "rotowire";
const ROTOWIRE_SOURCE_TIER: StarterSourceTier = "projected";
const ROTOWIRE_STARTER_STATUS: StarterStatus = "projected";

const CONFIDENCE_MAP: Readonly<Record<"high" | "medium" | "low", number>> = {
  high: 0.9,
  medium: 0.6,
  low: 0.3
};

// ---------------------------------------------------------------------------
// Game-id parsing
// ---------------------------------------------------------------------------

/**
 * Extracts away team abbreviation, home team abbreviation, and game date
 * from a canonical game_id of the form:
 *   mlb-{YYYY}-{MM}-{DD}-{away_lower}-{home_lower}
 *
 * Returns null if the id does not match the expected structure.
 * Exported for testability.
 */
export const parseTeamsFromGameId = (
  gameId: string
): { away: string; home: string; date: string } | null => {
  const parts = gameId.split("-");
  // Require: ["mlb", year, month, day, away, home] = 6 parts minimum
  if (parts.length < 6) return null;
  const prefix = parts[0];
  const year = parts[1];
  const month = parts[2];
  const day = parts[3];
  const awayRaw = parts[4];
  const homeRaw = parts[5];
  if (prefix !== "mlb") return null;
  if (!year || !month || !day || !awayRaw || !homeRaw) return null;
  return {
    away: awayRaw.toUpperCase(),
    home: homeRaw.toUpperCase(),
    date: `${year}-${month}-${day}`
  };
};

// ---------------------------------------------------------------------------
// Projected-source normalization
// ---------------------------------------------------------------------------

/**
 * Normalizes a single projected starter from the RotoWire adapter into
 * the canonical StarterSideIntelligence shape.
 *
 * Returns null when starter is null — partial side truth is preserved;
 * absent side is never fabricated.
 *
 * Mapping rules:
 * - source_key = "rotowire"
 * - source_tier = "projected"
 * - status = "projected"
 * - confidence: high → 0.9, medium → 0.6, low → 0.3
 * - source_updated_at = provider_meta.fetched_at
 * - observed_at = observedAt (ingest execution time)
 * - mlb_stats_api_id = null (not provided by adapter boundary)
 * - raw_ref = null (provider fields do not cross adapter boundary)
 * - freshness_status = "fresh" (stale detection is a future concern)
 */
export const normalizeProjectedStarter = (
  starter: ProjectedStarter | null,
  providerMeta: ProjectedSourceProviderMeta,
  observedAt: string
): StarterSideIntelligence | null => {
  if (starter === null) return null;

  return {
    player_id: starter.player_id,
    mlb_stats_api_id: null,
    full_name: starter.full_name,
    source_key: ROTOWIRE_SOURCE_KEY,
    source_tier: ROTOWIRE_SOURCE_TIER,
    confidence: CONFIDENCE_MAP[starter.confidence],
    freshness_status: "fresh" satisfies StarterFreshnessStatus,
    observed_at: asISOTimestamp(observedAt),
    source_updated_at: providerMeta.fetched_at,
    status: ROTOWIRE_STARTER_STATUS,
    raw_ref: null
  };
};

// ---------------------------------------------------------------------------
// General-purpose normalization boundary (future adapters)
// ---------------------------------------------------------------------------

/**
 * Raw upstream starter record before normalization.
 * Adapters map their native format into this shape — source-agnostic.
 * Reserved for non-RotoWire ingest paths (Slice 3+).
 */
export interface RawStarterInput {
  readonly player_id: string | null;
  readonly mlb_stats_api_id: string | null;
  readonly full_name: string | null;
  readonly source_key: string;
  readonly source_tier: StarterSourceTier;
  readonly status: StarterStatus;
  readonly observed_at: string;
  readonly source_updated_at: string | null;
  readonly raw_ref: Record<string, unknown> | null;
}

/**
 * Enriched starter input with confidence score and freshness status
 * resolved by the calling adapter — ready for genericnormalizeStarterInput().
 */
export interface NormalizedStarterInput {
  readonly side: "away" | "home";
  readonly input: RawStarterInput;
  readonly confidence: number;
  readonly freshness_status: StarterFreshnessStatus;
}

/**
 * Normalizes a fully-enriched NormalizedStarterInput into StarterSideIntelligence.
 * Slice 2: implemented for the general-purpose adapter path.
 * For the RotoWire projected source path, use normalizeProjectedStarter().
 */
export const normalizeStarterInput = (
  input: NormalizedStarterInput
): StarterSideIntelligence => ({
  player_id: input.input.player_id !== null ? asPlayerId(input.input.player_id) : null,
  mlb_stats_api_id: input.input.mlb_stats_api_id,
  full_name: input.input.full_name,
  source_key: input.input.source_key,
  source_tier: input.input.source_tier,
  confidence: input.confidence,
  freshness_status: input.freshness_status,
  observed_at: asISOTimestamp(input.input.observed_at),
  source_updated_at: input.input.source_updated_at !== null
    ? asISOTimestamp(input.input.source_updated_at)
    : null,
  status: input.input.status,
  raw_ref: input.input.raw_ref
});
