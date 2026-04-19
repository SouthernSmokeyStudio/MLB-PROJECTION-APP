/**
 * exportProjections.ts — CLI entry point for persisting a projection run.
 *
 * Loads the live slate for a given date, assembles per-player projections,
 * computes DK fantasy points, and writes them to the public projection tables
 * via the persist_projection_run RPC. Prints the resulting run_id to stdout.
 *
 * Usage:
 *   npx tsx scripts/exportProjections.ts                 # today (schedule timezone)
 *   npx tsx scripts/exportProjections.ts 2026-04-17      # explicit date
 *
 * Exit codes:
 *   0 — run_id printed to stdout
 *   1 — export failed (printed to stderr)
 */

import { loadLiveSlate } from "../lib/services";
import { buildMaterializerConfig } from "../lib/materializer";
import { getDateInScheduleTimezone } from "../lib/materializer/schedule";
import type { GameId } from "../lib/contracts/types";
import type { ProjectedGameData } from "../lib/contracts/projected-source";
import { getSupabaseWriteClient } from "../lib/supabase/writeClient";
import { createStarterIntelligenceRepository } from "../lib/starters/repository";
import { mapStarterIntelligenceToProjectedGamesMap } from "../lib/starters/mapToProjectedGameData";
import { assembleGameProjection } from "../lib/projections/assembleGameProjection";
import { persistPlayerProjections } from "../lib/services/persistPlayerProjections";

const FORMULA_VERSION = "v4-live";
const PARAM_VERSION = "v4-live";

const loadProjectedGames = async (
  date: string
): Promise<Map<GameId, ProjectedGameData> | undefined> => {
  const config = buildMaterializerConfig(
    {
      ROTOWIRE_ENDPOINT_URL: process.env.ROTOWIRE_ENDPOINT_URL,
      ROTOWIRE_TIMEOUT_MS: process.env.ROTOWIRE_TIMEOUT_MS
    },
    { officialOnly: false }
  );
  if (!config.success || !config.data.projectedAdapter) return undefined;
  const projected = await config.data.projectedAdapter.fetchProjectedData(date);
  if (!projected.success) return undefined;
  return new Map(projected.data.games.map((g) => [g.game_id, g]));
};

const loadStarterIntelligenceGames = async (
  date: string
): Promise<ReadonlyMap<GameId, ProjectedGameData> | undefined> => {
  try {
    const client = getSupabaseWriteClient();
    const repo = createStarterIntelligenceRepository(client);
    const rows = await repo.readGameStarterIntelligenceByDate(date);
    return mapStarterIntelligenceToProjectedGamesMap(rows);
  } catch {
    return undefined;
  }
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const date = args[0] ?? getDateInScheduleTimezone();

  process.stderr.write(`Exporting projections for ${date} ...\n`);

  const [projectedGames, siGames] = await Promise.all([
    loadProjectedGames(date),
    loadStarterIntelligenceGames(date)
  ]);

  const liveSlateResult = await loadLiveSlate(date, {
    ...(projectedGames ? { projectedGames } : {}),
    ...(siGames ? { starterIntelligenceGames: siGames } : {})
  });

  if (!liveSlateResult.success) {
    process.stderr.write(`ERROR: Live slate load failed: ${liveSlateResult.error}\n`);
    process.exit(1);
  }

  const sourceGames = liveSlateResult.data.games
    .map((g) => ({
      preparedGame: g.preparedGame,
      assembledProjection: assembleGameProjection(g.preparedGame)
    }))
    .filter(
      (g) =>
        g.assembledProjection.away_batters.length > 0 ||
        g.assembledProjection.home_batters.length > 0 ||
        g.assembledProjection.away_pitcher !== null ||
        g.assembledProjection.home_pitcher !== null
    );

  if (sourceGames.length === 0) {
    process.stderr.write(`ERROR: No projectable games found for ${date}\n`);
    process.exit(1);
  }

  const result = await persistPlayerProjections({
    sourceGames,
    projectedAt: new Date().toISOString(),
    playerProjectionFormulaVersion: FORMULA_VERSION,
    parameterSetVersion: PARAM_VERSION,
    preparedInputLineageRef: `live-${date}`,
    teamRunLineageRef: `live-${date}`
  });

  if (!result.ok) {
    process.stderr.write(`ERROR: persist failed: ${result.error.message}\n`);
    process.exit(1);
  }

  process.stderr.write(
    `Exported: ${result.persistedBatterRowCount} batters, ` +
    `${result.persistedPitcherRowCount} pitchers, ` +
    `${result.persistedGameCount} games\n`
  );

  // run_id to stdout only — so Python can capture it cleanly
  process.stdout.write(`${result.runId}\n`);
};

main().catch((err: unknown) => {
  process.stderr.write(`FATAL: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
