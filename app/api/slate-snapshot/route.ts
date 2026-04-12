import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  buildSlateSnapshot,
  getUtcDateString,
  loadDraftKingsClassicSlate,
  loadDraftKingsSportsbookMlbMoneylineSlate,
  loadLiveSlate,
  loadMaterializedSlate
} from "@lib/services";
import { buildMaterializerConfig } from "@lib/materializer";

const DEFAULT_SIMULATION = {
  seed: 20260328,
  iterations: 250
} as const;

const SNAPSHOT_SOURCE = "mlb-statsapi-live";
const DFS_EDGE_SOURCE = "mlb-statsapi-live+draftkings-classic";
const BETTING_EDGE_SOURCE = "mlb-statsapi-live+draftkings-sportsbook-moneyline";
const BETTING_EDGE_LABEL = "DraftKings Sportsbook MLB Pregame Moneyline";

const loadProjectedGames = async (date: string) => {
  const config = buildMaterializerConfig(
    {
      ROTOWIRE_ENDPOINT_URL: process.env.ROTOWIRE_ENDPOINT_URL,
      ROTOWIRE_TIMEOUT_MS: process.env.ROTOWIRE_TIMEOUT_MS
    },
    { officialOnly: false }
  );

  if (!config.success || !config.data.projectedAdapter) {
    return undefined;
  }

  const projected = await config.data.projectedAdapter.fetchProjectedData(date);
  if (!projected.success) {
    return undefined;
  }

  return new Map(projected.data.games.map((game) => [game.game_id, game]));
};

export async function GET(request: NextRequest): Promise<Response> {
  const date = request.nextUrl.searchParams.get("date") ?? getUtcDateString();
  const draftGroupId = request.nextUrl.searchParams.get("draft_group_id") ?? undefined;
  // Attempt to load a materialized baseline.  This is a local file read
  // that fails silently when no artifact exists — the live pipeline is the
  // sole authority and the baseline only supplements the initial fallback.
  // Fail-closed: stale artifacts (>24h) are rejected — they must NOT be
  // used as a baseline.
  const materializedResult = await loadMaterializedSlate(date);
  const materializedBaseline =
    materializedResult.success && !materializedResult.data.metadata.is_stale
      ? materializedResult.data.slate
      : undefined;
  const projectedGames = await loadProjectedGames(date);

  const [loadedLiveSlate, loadedDraftKingsSlate, loadedMoneylineSlate] = await Promise.all([
    loadLiveSlate(date, {
      materializedBaseline,
      ...(projectedGames ? { projectedGames } : {})
    }),
    loadDraftKingsClassicSlate(
      draftGroupId
        ? {
            date,
            draftGroupId
          }
        : {
            date
          }
    ),
    loadDraftKingsSportsbookMlbMoneylineSlate({ date })
  ]);

  const liveNote = loadedLiveSlate.success ? loadedLiveSlate.data.note : null;
  const mlbError = loadedLiveSlate.success ? null : loadedLiveSlate.error;
  const sourceGames = loadedLiveSlate.success ? loadedLiveSlate.data.games : [];
  const generatedAt = loadedLiveSlate.success
    ? loadedLiveSlate.data.generated_at
    : new Date().toISOString();
  const counts = loadedLiveSlate.success
    ? loadedLiveSlate.data.counts
    : { fetched_raw: 0, parsed: 0, normalized: 0, prepared: 0, boxscore_enriched: 0 };

  const dfsEdgeReason = !loadedDraftKingsSlate.success
    ? loadedDraftKingsSlate.error
    : loadedDraftKingsSlate.data.note;
  const bettingEdgeReason = !loadedMoneylineSlate.success
    ? loadedMoneylineSlate.error
    : loadedMoneylineSlate.data.note;

  return NextResponse.json(
    buildSlateSnapshot(sourceGames, {
      source: SNAPSHOT_SOURCE,
      date,
      generated_at: generatedAt,
      counts,
      simulation: DEFAULT_SIMULATION,
      schedule: {
        source: loadedLiveSlate.success ? loadedLiveSlate.data.source : SNAPSHOT_SOURCE,
        note: mlbError ?? liveNote
      },
      player_projections: {
        source: loadedLiveSlate.success ? loadedLiveSlate.data.source : SNAPSHOT_SOURCE,
        note: mlbError ?? liveNote
      },
      ...(mlbError
        ? {
            schedule_reason: mlbError,
            player_projections_reason: mlbError
          }
        : {}),
      ...(!loadedDraftKingsSlate.success ||
      loadedDraftKingsSlate.data.slates.length === 0 ||
      mlbError
        ? {
            dfs_edge_reason: mlbError
              ? `MLB schedule unavailable — cannot build DFS edge: ${mlbError}`
              : dfsEdgeReason ??
                "No DraftKings Classic salary slate matched the requested date."
          }
        : {
            dfs_edge: {
              source: DFS_EDGE_SOURCE,
              note: loadedDraftKingsSlate.data.note ?? liveNote,
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
      ...(!loadedMoneylineSlate.success || !loadedMoneylineSlate.data.moneyline_slate || mlbError
        ? {
            betting_edge_reason: mlbError
              ? `MLB schedule unavailable — cannot build betting edge: ${mlbError}`
              : bettingEdgeReason ??
                "No DraftKings Sportsbook MLB pregame moneyline rows matched the requested date."
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
    })
  );
}
