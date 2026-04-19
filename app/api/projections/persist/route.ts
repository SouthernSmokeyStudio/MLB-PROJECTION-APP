import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { loadLiveSlate } from "@lib/services";
import { buildMaterializerConfig } from "@lib/materializer";
import { getDateInScheduleTimezone } from "@lib/materializer/schedule";
import type { GameId } from "@lib/contracts/types";
import type { ProjectedGameData } from "@lib/contracts/projected-source";
import { getSupabaseWriteClient } from "@lib/supabase/writeClient";
import { createStarterIntelligenceRepository } from "@lib/starters/repository";
import { mapStarterIntelligenceToProjectedGamesMap } from "@lib/starters/mapToProjectedGameData";
import { persistPlayerProjections } from "@lib/services/persistPlayerProjections";
import { assembleGameProjection } from "@lib/projections/assembleGameProjection";

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

export async function POST(request: NextRequest): Promise<Response> {
  let date: string;
  try {
    const body = await request.json().catch(() => ({}));
    date = (body as { date?: string }).date ?? getDateInScheduleTimezone();
  } catch {
    date = getDateInScheduleTimezone();
  }

  const [projectedGames, siGames] = await Promise.all([
    loadProjectedGames(date),
    loadStarterIntelligenceGames(date)
  ]);

  const liveSlateResult = await loadLiveSlate(date, {
    ...(projectedGames ? { projectedGames } : {}),
    ...(siGames ? { starterIntelligenceGames: siGames } : {})
  });

  if (!liveSlateResult.success) {
    return NextResponse.json(
      { ok: false, error: liveSlateResult.error },
      { status: 502 }
    );
  }

  const sourceGames = liveSlateResult.data.games.map((g) => ({
    preparedGame: g.preparedGame,
    assembledProjection: assembleGameProjection(g.preparedGame)
  }));

  const projectable = sourceGames.filter(
    (g) =>
      g.assembledProjection.away_batters.length > 0 ||
      g.assembledProjection.home_batters.length > 0 ||
      g.assembledProjection.away_pitcher !== null ||
      g.assembledProjection.home_pitcher !== null
  );

  if (projectable.length === 0) {
    return NextResponse.json(
      { ok: false, error: `No projectable games found for ${date}` },
      { status: 422 }
    );
  }

  const result = await persistPlayerProjections({
    sourceGames: projectable,
    projectedAt: new Date().toISOString(),
    playerProjectionFormulaVersion: FORMULA_VERSION,
    parameterSetVersion: PARAM_VERSION,
    preparedInputLineageRef: `live-${date}`,
    teamRunLineageRef: `live-${date}`
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    run_id: result.runId,
    date,
    batter_count: result.persistedBatterRowCount,
    pitcher_count: result.persistedPitcherRowCount,
    game_count: result.persistedGameCount
  });
}
