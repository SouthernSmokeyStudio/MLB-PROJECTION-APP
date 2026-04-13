import type { ProjectedSourceResult } from "@lib/contracts/projected-source";
import { nowISO, ok, type Result } from "@lib/contracts/types";
import { normalizeProjectedStarter, parseTeamsFromGameId } from "./normalize";
import type { StarterIntelligenceRepository, UpsertGameStarterIntelligencePayload } from "./repository";

export interface IngestRotowireProjectedStartersOptions {
  /**
   * Explicit observed_at timestamp for the ingest run.
   * Defaults to the current time (nowISO()) when omitted.
   * Providing it explicitly makes ingest behavior deterministic in tests.
   */
  readonly observedAt?: string;
}

export interface IngestRotowireProjectedStartersResult {
  readonly ingested: number;
  readonly errors: readonly string[];
}

/**
 * Ingests projected starters from a single RotoWire adapter result into
 * game_starter_intelligence via the repository.
 *
 * One upsert per game — idempotent on repeated runs for the same game_id.
 * Per-game normalization errors are collected and reported; valid games
 * still write. DB write errors are collected per game.
 *
 * Does not touch route code, loadLiveSlate, or prepareGameInputs.
 */
export const ingestRotowireProjectedStarters = async (
  result: ProjectedSourceResult,
  repository: StarterIntelligenceRepository,
  options: IngestRotowireProjectedStartersOptions = {}
): Promise<Result<IngestRotowireProjectedStartersResult, string>> => {
  const observedAt = options.observedAt ?? nowISO();
  const errors: string[] = [];
  let ingested = 0;

  for (const game of result.games) {
    const parsed = parseTeamsFromGameId(game.game_id);
    if (parsed === null) {
      errors.push(`Cannot parse teams/date from game_id: ${game.game_id}`);
      continue;
    }

    const awaySide = normalizeProjectedStarter(
      game.away_starter,
      result.provider_meta,
      observedAt
    );
    const homeSide = normalizeProjectedStarter(
      game.home_starter,
      result.provider_meta,
      observedAt
    );

    const payload: UpsertGameStarterIntelligencePayload = {
      game_id: game.game_id,
      game_date: parsed.date,
      away_team_abbreviation: parsed.away,
      home_team_abbreviation: parsed.home,

      away_starter_player_id: awaySide?.player_id ?? null,
      away_starter_mlb_stats_api_id: awaySide?.mlb_stats_api_id ?? null,
      away_starter_full_name: awaySide?.full_name ?? null,
      away_starter_source_key: awaySide?.source_key ?? null,
      away_starter_source_tier: awaySide?.source_tier ?? null,
      away_starter_confidence: awaySide?.confidence ?? null,
      away_starter_freshness_status: awaySide?.freshness_status ?? null,
      away_starter_observed_at: awaySide?.observed_at ?? null,
      away_starter_source_updated_at: awaySide?.source_updated_at ?? null,
      away_starter_status: awaySide?.status ?? null,
      away_starter_raw_ref: awaySide?.raw_ref ?? null,

      home_starter_player_id: homeSide?.player_id ?? null,
      home_starter_mlb_stats_api_id: homeSide?.mlb_stats_api_id ?? null,
      home_starter_full_name: homeSide?.full_name ?? null,
      home_starter_source_key: homeSide?.source_key ?? null,
      home_starter_source_tier: homeSide?.source_tier ?? null,
      home_starter_confidence: homeSide?.confidence ?? null,
      home_starter_freshness_status: homeSide?.freshness_status ?? null,
      home_starter_observed_at: homeSide?.observed_at ?? null,
      home_starter_source_updated_at: homeSide?.source_updated_at ?? null,
      home_starter_status: homeSide?.status ?? null,
      home_starter_raw_ref: homeSide?.raw_ref ?? null
    };

    try {
      await repository.upsertGameStarterIntelligence(payload);
      ingested++;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(msg);
    }
  }

  return ok({ ingested, errors });
};
