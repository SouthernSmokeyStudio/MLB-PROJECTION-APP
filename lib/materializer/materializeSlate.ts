/**
 * materializeSlate.ts
 *
 * Materializer writer: orchestrates the official/projected/inferred fetch,
 * runs the merge law, prepares game inputs, and writes the canonical
 * MaterializedSlate artifact to disk.
 *
 * Flow:
 *   1. Fetch official schedule from MLB Stats API
 *   2. Normalize each game to CanonicalGame
 *   3. (Optional) Fetch projected data from a ProjectedSourceAdapter
 *   4. (Optional) Fetch inferred data from an InferenceEngine
 *   5. For each game: resolve merge → apply to canonical → prepare
 *   6. Write MaterializedSlate JSON to data/materialized/{date}.json
 *
 * Fail-closed: any upstream failure (schedule fetch, normalize, merge)
 * returns err — never writes a partial artifact.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import {
  fetchAndParseMlbStatsApiSchedule
} from "@lib/adapters/mlbStatsApi";
import type { CanonicalGame } from "@lib/contracts/canonical";
import type {
  MaterializedGameEntry,
  MaterializedSlate
} from "@lib/contracts/materialized-slate";
import type { ProjectedSourceAdapter, ProjectedGameData } from "@lib/contracts/projected-source";
import type { InferenceEngine, InferredGameData, InferenceContext } from "@lib/contracts/inferred-source";
import {
  asISOTimestamp,
  err,
  nowISO,
  ok,
  type GameId,
  type Result
} from "@lib/contracts/types";
import { normalizeMlbStatsApiGame } from "@lib/normalization/mlbStatsApiNormalizer";
import { prepareGameInputs } from "@lib/preparation";
import { resolveGameSources, applyMergedStartersToCanonical } from "@lib/merge";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Default output directory relative to process.cwd(). */
const DEFAULT_OUTPUT_DIR = join(process.cwd(), "data", "materialized");

export interface MaterializeSlateOptions {
  /** The date to materialize (YYYY-MM-DD). */
  readonly date: string;
  /** Optional projected source adapter.  When absent, projected tier is empty. */
  readonly projectedAdapter?: ProjectedSourceAdapter;
  /** Optional inference engine.  When absent, inferred tier is empty. */
  readonly inferenceEngine?: InferenceEngine;
  /** Output directory for the artifact.  Defaults to data/materialized/. */
  readonly outputDir?: string;
  /** Source label written into the artifact.  Defaults to "materializer-v1". */
  readonly source?: string;
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface MaterializeSlateResult {
  readonly artifactPath: string;
  readonly date: string;
  readonly generatedAt: string;
  readonly gamesWritten: number;
  readonly projectedGamesAvailable: number;
  readonly inferredGamesAvailable: number;
}

// ---------------------------------------------------------------------------
// Core materializer
// ---------------------------------------------------------------------------

export const materializeSlate = async (
  options: MaterializeSlateOptions
): Promise<Result<MaterializeSlateResult, string>> => {
  const {
    date,
    projectedAdapter,
    inferenceEngine,
    outputDir = DEFAULT_OUTPUT_DIR,
    source = "materializer-v1"
  } = options;

  const generatedAt = nowISO();

  // -----------------------------------------------------------------------
  // 1. Fetch official schedule
  // -----------------------------------------------------------------------
  const scheduleFetched = await fetchAndParseMlbStatsApiSchedule(date);
  if (!scheduleFetched.success) {
    return err(`Schedule fetch failed: ${scheduleFetched.error}`);
  }

  const { parsedGames } = scheduleFetched.data;

  // -----------------------------------------------------------------------
  // 2. Normalize to CanonicalGame[]
  // -----------------------------------------------------------------------
  const canonicalGames: CanonicalGame[] = [];
  for (const parsed of parsedGames) {
    const normalized = normalizeMlbStatsApiGame(parsed);
    if (!normalized.success) {
      return err(`Game normalization failed for gamePk ${parsed.gamePk}: ${normalized.error}`);
    }
    canonicalGames.push(normalized.data);
  }

  // -----------------------------------------------------------------------
  // 3. Fetch projected data (optional, fail-closed)
  // -----------------------------------------------------------------------
  let projectedLookup = new Map<GameId, ProjectedGameData>();
  if (projectedAdapter) {
    const projectedResult = await projectedAdapter.fetchProjectedData(date);
    if (!projectedResult.success) {
      return err(`Projected adapter (${projectedAdapter.source}) failed: ${projectedResult.error}`);
    }
    for (const game of projectedResult.data.games) {
      projectedLookup.set(game.game_id, game);
    }
  }

  // -----------------------------------------------------------------------
  // 4. Fetch inferred data (optional, fail-closed)
  // -----------------------------------------------------------------------
  let inferredLookup = new Map<GameId, InferredGameData>();
  if (inferenceEngine) {
    const gameIds = canonicalGames.map((g) => g.game_id);
    const context: InferenceContext = { date, game_ids: gameIds };
    const inferredResult = await inferenceEngine.infer(date, context);
    if (!inferredResult.success) {
      return err(`Inference engine (${inferenceEngine.engine}) failed: ${inferredResult.error}`);
    }
    for (const game of inferredResult.data.games) {
      inferredLookup.set(game.game_id, game);
    }
  }

  // -----------------------------------------------------------------------
  // 5. Merge + prepare for each game
  // -----------------------------------------------------------------------
  const entries: MaterializedGameEntry[] = [];
  for (const canonicalGame of canonicalGames) {
    const projected = projectedLookup.get(canonicalGame.game_id) ?? null;
    const inferred = inferredLookup.get(canonicalGame.game_id) ?? null;

    const merged = resolveGameSources(canonicalGame, projected, inferred);
    const mergedCanonical = applyMergedStartersToCanonical(canonicalGame, merged);
    const prepared = prepareGameInputs(mergedCanonical);

    entries.push({
      game_id: canonicalGame.game_id,
      prepared
    });
  }

  // -----------------------------------------------------------------------
  // 6. Write artifact
  // -----------------------------------------------------------------------
  const slate: MaterializedSlate = {
    version: 1,
    date,
    generated_at: asISOTimestamp(generatedAt),
    source,
    games: entries
  };

  const artifactPath = join(outputDir, `${date}.json`);

  try {
    await mkdir(dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, JSON.stringify(slate, null, 2), "utf-8");
  } catch (cause: unknown) {
    return err(`Failed to write artifact: ${cause instanceof Error ? cause.message : String(cause)}`);
  }

  return ok({
    artifactPath,
    date,
    generatedAt,
    gamesWritten: entries.length,
    projectedGamesAvailable: projectedLookup.size,
    inferredGamesAvailable: inferredLookup.size
  });
};
