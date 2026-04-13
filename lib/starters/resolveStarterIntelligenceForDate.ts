import { ok, err, type Result } from "@lib/contracts/types";
import { resolveGameStarters } from "./resolve";
import type { StarterCandidate } from "./resolve";
import type { StarterIntelligenceRepository, UpsertGameStarterIntelligencePayload } from "./repository";
import type { GameStarterIntelligenceRow, StarterSideIntelligence } from "./types";

// ---------------------------------------------------------------------------
// Side → candidate extraction
// ---------------------------------------------------------------------------

/**
 * Converts one side's stored StarterSideIntelligence into a StarterCandidate
 * suitable for the resolver.
 *
 * Returns null when required candidate fields are absent — partial truth is
 * preserved but cannot participate in resolution without minimum provenance.
 * Required minimum for a valid candidate: source_key, source_tier,
 * confidence, freshness_status, observed_at, status.
 */
const sideIntelligenceToCandidate = (
  side: StarterSideIntelligence
): StarterCandidate | null => {
  if (
    side.source_key === null ||
    side.source_tier === null ||
    side.confidence === null ||
    side.freshness_status === null ||
    side.observed_at === null ||
    side.status === null
  ) {
    return null;
  }

  return {
    source_key: side.source_key,
    source_tier: side.source_tier,
    confidence: side.confidence,
    freshness_status: side.freshness_status,
    observed_at: side.observed_at,
    source_updated_at: side.source_updated_at,
    player_id: side.player_id,
    full_name: side.full_name,
    mlb_stats_api_id: side.mlb_stats_api_id,
    status: side.status,
    raw_ref: side.raw_ref
  };
};

// ---------------------------------------------------------------------------
// Upsert payload assembly
// ---------------------------------------------------------------------------

const buildUpsertFromResolution = (
  row: GameStarterIntelligenceRow,
  resolved: ReturnType<typeof resolveGameStarters>
): UpsertGameStarterIntelligencePayload => {
  const { away, home } = resolved;
  return {
    game_id: row.game_id,
    game_date: row.game_date,
    away_team_abbreviation: row.away_team_abbreviation,
    home_team_abbreviation: row.home_team_abbreviation,

    away_starter_player_id: away?.player_id ?? null,
    away_starter_mlb_stats_api_id: away?.mlb_stats_api_id ?? null,
    away_starter_full_name: away?.full_name ?? null,
    away_starter_source_key: away?.source_key ?? null,
    away_starter_source_tier: away?.source_tier ?? null,
    away_starter_confidence: away?.confidence ?? null,
    away_starter_freshness_status: away?.freshness_status ?? null,
    away_starter_observed_at: away?.observed_at ?? null,
    away_starter_source_updated_at: away?.source_updated_at ?? null,
    away_starter_status: away?.status ?? null,
    away_starter_raw_ref: away?.raw_ref ?? null,

    home_starter_player_id: home?.player_id ?? null,
    home_starter_mlb_stats_api_id: home?.mlb_stats_api_id ?? null,
    home_starter_full_name: home?.full_name ?? null,
    home_starter_source_key: home?.source_key ?? null,
    home_starter_source_tier: home?.source_tier ?? null,
    home_starter_confidence: home?.confidence ?? null,
    home_starter_freshness_status: home?.freshness_status ?? null,
    home_starter_observed_at: home?.observed_at ?? null,
    home_starter_source_updated_at: home?.source_updated_at ?? null,
    home_starter_status: home?.status ?? null,
    home_starter_raw_ref: home?.raw_ref ?? null,

    resolution_notes: resolved.resolution_notes
  };
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface ResolveStarterIntelligenceForDateResult {
  readonly resolved: number;
  readonly skipped: number;
  readonly errors: readonly string[];
}

/**
 * Reads all stored starter intelligence rows for a date, runs per-game
 * canonical resolution, and upserts the resolved current row back on game_id.
 *
 * Schema limitation (intentionally unresolved in this slice):
 * The current schema stores one flat row per game_id. Each side therefore
 * produces at most one candidate for the resolver. True multi-source
 * candidate resolution (comparing RotoWire vs official vs reported at the
 * same tier simultaneously) requires a separate candidates table or multiple
 * rows per game_id — that is out of scope for the current Slice 3 design.
 *
 * When a side has incomplete provenance (missing source_key, source_tier,
 * confidence, freshness_status, observed_at, or status), that side yields
 * zero candidates; the resolver returns null for it and the upsert writes
 * null fields for that side.
 */
export const resolveStarterIntelligenceForDate = async (
  date: string,
  repository: StarterIntelligenceRepository
): Promise<Result<ResolveStarterIntelligenceForDateResult, string>> => {
  let storedRows: readonly GameStarterIntelligenceRow[];

  try {
    storedRows = await repository.readGameStarterIntelligenceByDate(date);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return err(`Failed to read starter intelligence for ${date}: ${msg}`);
  }

  const errors: string[] = [];
  let resolved = 0;
  let skipped = 0;

  for (const row of storedRows) {
    const awayCandidate = sideIntelligenceToCandidate(row.away);
    const homeCandidate = sideIntelligenceToCandidate(row.home);

    if (awayCandidate === null && homeCandidate === null) {
      skipped++;
      continue;
    }

    const resolutionInput = {
      game_id: row.game_id,
      game_date: row.game_date,
      away_candidates: awayCandidate !== null ? [awayCandidate] : [],
      home_candidates: homeCandidate !== null ? [homeCandidate] : []
    };

    const resolutionOutput = resolveGameStarters(resolutionInput);
    const payload = buildUpsertFromResolution(row, resolutionOutput);

    try {
      await repository.upsertGameStarterIntelligence(payload);
      resolved++;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`[${row.game_id}] ${msg}`);
    }
  }

  return ok({ resolved, skipped, errors });
};
