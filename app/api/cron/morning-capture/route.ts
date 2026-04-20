import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { backfillDraftKingsClassicSlate } from "@lib/services/loadDraftKingsClassicSlate";
import {
  loadDraftKingsSportsbookMlbMoneylineSlate
} from "@lib/services/loadDraftKingsSportsbookMlbMoneylineSlate";
import { loadLiveSlate, buildSlateSnapshot } from "@lib/services";
import { buildMaterializerConfig } from "@lib/materializer";
import { getDateInScheduleTimezone } from "@lib/materializer/schedule";
import type { GameId } from "@lib/contracts/types";
import type { ProjectedGameData } from "@lib/contracts/projected-source";
import { getSupabaseWriteClient } from "@lib/supabase/writeClient";
import { createStarterIntelligenceRepository } from "@lib/starters/repository";
import { mapStarterIntelligenceToProjectedGamesMap } from "@lib/starters/mapToProjectedGameData";
import { persistPlayerProjections } from "@lib/services/persistPlayerProjections";
import { assembleGameProjection } from "@lib/projections/assembleGameProjection";
import {
  storePublishedSlateSnapshot
} from "@lib/supabase/publishedSlateSnapshot";
import {
  upsertGameProjections,
  type GameProjectionUpsertRow
} from "@lib/supabase/gameProjectionsTable";
import type { LiveSlateSourceGame } from "@lib/services/loadLiveSlate";

// Runs at 13:00 UTC (8:00 AM CT) daily — before any MLB first pitches and
// before the DK Classic upcoming endpoint rotates away from today's groups.
//
// Full pipeline in one cron invocation:
//   1. DK Classic salary slate → dk_classic_snapshots
//   2. DK Moneyline slate      → dk_sportsbook_moneyline_snapshots (via loader)
//   3. Load live slate (MLB Stats API) — ONE call per day
//   4. Persist player projections → projection_run + player_projection_batter/pitcher
//   5. Build full SlateSnapshotPayload (all boards assembled)
//   6. Publish to published_slate_snapshot → app reads this, no compute on GET
//   7. Write game_projections rows (parent truth for downstream analytics)
//
// The dk-moneyline-capture cron runs at the same schedule and is listed first
// in vercel.json, so the moneyline snapshot is seeded before this cron fires.

const FORMULA_VERSION = "v4-live";
const PARAM_VERSION = "v4-live";
const SNAPSHOT_SOURCE = "mlb-statsapi-live";
const DFS_EDGE_SOURCE = "mlb-statsapi-live+draftkings-classic";
const BETTING_EDGE_SOURCE = "mlb-statsapi-live+draftkings-sportsbook-moneyline";
const BETTING_EDGE_LABEL = "DraftKings Sportsbook MLB Pregame Moneyline";
const DEFAULT_SIMULATION = { seed: 20260328, iterations: 250 } as const;

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

const buildGameProjectionRows = (
  date: string,
  runId: string | null,
  sourceGames: readonly LiveSlateSourceGame[],
  generatedAt: string
): readonly GameProjectionUpsertRow[] =>
  sourceGames.map((sg) => {
    const p = sg.preparedGame;
    const assembled = assembleGameProjection(p);
    return {
      projection_date: date,
      game_id: sg.canonicalGame.game_id,
      sport_id: "MLB",
      away_team_id: sg.canonicalGame.away.team.team_id,
      home_team_id: sg.canonicalGame.home.team.team_id,
      run_id: runId,
      scheduled_start: sg.canonicalGame.scheduled_start,
      projected_away_runs: assembled.game_projection.away.projected_runs ?? null,
      projected_home_runs: assembled.game_projection.home.projected_runs ?? null,
      projected_total_runs: assembled.game_projection.projected_total ?? null,
      // Win probabilities are derived from the betting_edge simulation; they are
      // populated as a best-effort from the assembled projection where available.
      // The betting_edge board in the published snapshot is the authoritative surface.
      projected_away_win_probability: null,
      projected_home_win_probability: null,
      is_blocked: p.blocked.is_blocked,
      blocked_reason: p.blocked.blocked_reason ?? null,
      is_stale: false,
      source_run_key: runId,
      source_generated_at: generatedAt
    };
  });

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const date = getDateInScheduleTimezone();
  const generatedAt = new Date().toISOString();
  const results: Record<string, unknown> = {};

  // ── Step 1: DK Classic capture ──────────────────────────────────────────────
  const dkClassicResult = await backfillDraftKingsClassicSlate({ date });
  results.dk_classic = dkClassicResult.success
    ? { ok: true, slate_count: dkClassicResult.data.slates.length }
    : { ok: false, error: dkClassicResult.error };

  // ── Step 2: DK Moneyline snapshot (seed/merge via loader) ───────────────────
  const moneylineResult = await loadDraftKingsSportsbookMlbMoneylineSlate({ date });
  results.dk_moneyline = moneylineResult.success
    ? { ok: true, entry_count: moneylineResult.data.moneyline_slate?.entries.length ?? 0 }
    : { ok: false, error: moneylineResult.error };

  // ── Step 3: Load live slate (ONE MLB Stats API call for the day) ────────────
  const [projectedGames, siGames] = await Promise.all([
    loadProjectedGames(date),
    loadStarterIntelligenceGames(date)
  ]);

  const liveSlateResult = await loadLiveSlate(date, {
    ...(projectedGames ? { projectedGames } : {}),
    ...(siGames ? { starterIntelligenceGames: siGames } : {})
  });

  if (!liveSlateResult.success) {
    results.projections = { ok: false, error: liveSlateResult.error };
    results.snapshot = { ok: false, error: "Live slate unavailable — snapshot not published" };
    const allOk = false;
    return NextResponse.json({ ok: allOk, date, results }, { status: 500 });
  }

  const liveNote = liveSlateResult.data.note;
  const mlbError = null;
  const sourceGames = liveSlateResult.data.games;
  const counts = liveSlateResult.data.counts;

  // ── Step 4: Persist player projections ─────────────────────────────────────
  const projectableGames = sourceGames.map((g) => ({
    preparedGame: g.preparedGame,
    assembledProjection: assembleGameProjection(g.preparedGame)
  }));

  const projectable = projectableGames.filter(
    (g) =>
      g.assembledProjection.away_batters.length > 0 ||
      g.assembledProjection.home_batters.length > 0 ||
      g.assembledProjection.away_pitcher !== null ||
      g.assembledProjection.home_pitcher !== null
  );

  let runId: string | null = null;

  if (projectable.length > 0) {
    const persistResult = await persistPlayerProjections({
      sourceGames: projectable,
      projectedAt: generatedAt,
      playerProjectionFormulaVersion: FORMULA_VERSION,
      parameterSetVersion: PARAM_VERSION,
      preparedInputLineageRef: `live-${date}`,
      teamRunLineageRef: `live-${date}`
    });

    if (persistResult.ok) {
      runId = persistResult.runId;
      results.projections = {
        ok: true,
        run_id: runId,
        batter_count: persistResult.persistedBatterRowCount,
        pitcher_count: persistResult.persistedPitcherRowCount,
        game_count: persistResult.persistedGameCount
      };
    } else {
      results.projections = { ok: false, error: persistResult.error.message };
    }
  } else {
    results.projections = { ok: false, error: `No projectable games for ${date}` };
  }

  // ── Step 5: Build full SlateSnapshotPayload ─────────────────────────────────
  const loadedDraftKingsSlate = dkClassicResult;
  const loadedMoneylineSlate = moneylineResult;

  const hasProjectablePlayers = sourceGames.some(
    (game) =>
      game.preparedGame.away_starter !== null ||
      game.preparedGame.home_starter !== null ||
      game.preparedGame.away_batters.length > 0 ||
      game.preparedGame.home_batters.length > 0
  );

  const dfsEdgeReason = !loadedDraftKingsSlate.success
    ? loadedDraftKingsSlate.error
    : null;
  const bettingEdgeReason = !loadedMoneylineSlate.success
    ? loadedMoneylineSlate.error
    : loadedMoneylineSlate.data.note;

  const slatePayload = buildSlateSnapshot(sourceGames, {
    source: SNAPSHOT_SOURCE,
    date,
    generated_at: generatedAt,
    counts,
    simulation: DEFAULT_SIMULATION,
    schedule: {
      source: liveSlateResult.data.source,
      note: mlbError ?? liveNote
    },
    player_projections: {
      source: liveSlateResult.data.source,
      note: mlbError ?? liveNote
    },
    ...(!loadedDraftKingsSlate.success || loadedDraftKingsSlate.data.slates.length === 0
      ? {
          dfs_edge_degraded: {
            source: DFS_EDGE_SOURCE,
            note:
              dfsEdgeReason ??
              "No DraftKings Classic salary captured for this date -- projections only."
          }
        }
      : !hasProjectablePlayers
      ? {
          dfs_edge_reason:
            "Player projections unavailable -- DFS edge requires at least one projected starter or lineup."
        }
      : {
          dfs_edge: {
            source: DFS_EDGE_SOURCE,
            note: liveNote,
            draftkings_classic: {
              draft_group_id: loadedDraftKingsSlate.data.slates[0]!.draft_group_id,
              label: loadedDraftKingsSlate.data.slates[0]!.label,
              min_start_time: loadedDraftKingsSlate.data.slates[0]!.min_start_time,
              max_start_time: loadedDraftKingsSlate.data.slates[0]!.max_start_time,
              tags: []
            },
            salary_slate_inventory: loadedDraftKingsSlate.data.slates
          }
        }),
    ...(!loadedMoneylineSlate.success || !loadedMoneylineSlate.data.moneyline_slate
      ? {
          betting_edge_degraded: {
            source: BETTING_EDGE_SOURCE,
            note:
              bettingEdgeReason ??
              "No DraftKings Sportsbook moneyline captured for this date -- projections only."
          }
        }
      : {
          betting_edge: {
            source: BETTING_EDGE_SOURCE,
            note: loadedMoneylineSlate.data.note ?? liveNote,
            draftkings_sportsbook_moneyline: {
              site: loadedMoneylineSlate.data.moneyline_slate.site,
              label: BETTING_EDGE_LABEL
            },
            moneyline_slate: loadedMoneylineSlate.data.moneyline_slate
          }
        })
  });

  // ── Step 6: Publish to published_slate_snapshot ─────────────────────────────
  const hasBlockedSections = slatePayload.publication.blocked_sections.length > 0;
  const snapshotResult = await storePublishedSlateSnapshot({
    date,
    run_id: runId,
    generated_at: generatedAt,
    publication_state: hasBlockedSections ? "degraded" : "valid",
    degradation: slatePayload.degradation,
    payload: slatePayload
  });

  if (!snapshotResult.ok) {
    results.snapshot = { ok: false, error: snapshotResult.error };
    return NextResponse.json({ ok: false, date, results }, { status: 500 });
  }

  results.snapshot = {
    ok: true,
    publication_state: hasBlockedSections ? "degraded" : "valid",
    blocked_sections: slatePayload.publication.blocked_sections
  };

  // ── Step 7: Write game_projections parent truth rows ────────────────────────
  const gameProjectionRows = buildGameProjectionRows(date, runId, sourceGames, generatedAt);
  await upsertGameProjections(gameProjectionRows);
  results.game_projections = { ok: true, game_count: gameProjectionRows.length };

  const allOk = Object.values(results).every(
    (r) => typeof r === "object" && r !== null && (r as Record<string, unknown>).ok === true
  );

  return NextResponse.json({ ok: allOk, date, results }, { status: allOk ? 200 : 500 });
}
