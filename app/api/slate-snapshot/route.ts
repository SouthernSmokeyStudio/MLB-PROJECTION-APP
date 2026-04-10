import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  buildSlateSnapshot,
  getUtcDateString,
  loadDraftKingsClassicSlate,
  loadDraftKingsSportsbookMlbMoneylineSlate,
  loadLiveSlate
} from "@lib/services";

const DEFAULT_SIMULATION = {
  seed: 20260328,
  iterations: 250
} as const;

const SNAPSHOT_SOURCE = "mlb-statsapi-live";
const DFS_EDGE_SOURCE = "mlb-statsapi-live+draftkings-classic";
const BETTING_EDGE_SOURCE = "mlb-statsapi-live+draftkings-sportsbook-moneyline";
const BETTING_EDGE_LABEL = "DraftKings Sportsbook MLB Pregame Moneyline";

export async function GET(request: NextRequest): Promise<Response> {
  const date = request.nextUrl.searchParams.get("date") ?? getUtcDateString();
  const draftGroupId = request.nextUrl.searchParams.get("draft_group_id") ?? undefined;
  const [loadedLiveSlate, loadedDraftKingsSlate, loadedMoneylineSlate] = await Promise.all([
    loadLiveSlate(date),
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

  if (!loadedLiveSlate.success) {
    return NextResponse.json(
      {
        source: SNAPSHOT_SOURCE,
        error: loadedLiveSlate.error
      },
      { status: 502 }
    );
  }

  const liveNote = loadedLiveSlate.data.note;
  const dfsEdgeReason = !loadedDraftKingsSlate.success
    ? loadedDraftKingsSlate.error
    : loadedDraftKingsSlate.data.note;
  const bettingEdgeReason = !loadedMoneylineSlate.success
    ? loadedMoneylineSlate.error
    : loadedMoneylineSlate.data.note;

  return NextResponse.json(
    buildSlateSnapshot(loadedLiveSlate.data.games, {
      source: SNAPSHOT_SOURCE,
      date,
      generated_at: loadedLiveSlate.data.generated_at,
      counts: loadedLiveSlate.data.counts,
      simulation: DEFAULT_SIMULATION,
      schedule: {
        source: loadedLiveSlate.data.source,
        note: liveNote
      },
      player_projections: {
        source: loadedLiveSlate.data.source,
        note: liveNote
      },
      ...(!loadedDraftKingsSlate.success ||
      !loadedDraftKingsSlate.data.draft_group ||
      !loadedDraftKingsSlate.data.salary_slate
        ? {
            dfs_edge_reason:
              dfsEdgeReason ??
              "No DraftKings Classic salary slate matched the requested date."
          }
        : {
            dfs_edge: {
              source: DFS_EDGE_SOURCE,
              note: loadedDraftKingsSlate.data.note ?? liveNote,
              draftkings_classic: {
                draft_group_id: loadedDraftKingsSlate.data.draft_group.draft_group_id,
                label: loadedDraftKingsSlate.data.label ?? "DraftKings Classic",
                min_start_time: loadedDraftKingsSlate.data.draft_group.min_start_time,
                max_start_time: loadedDraftKingsSlate.data.draft_group.max_start_time,
                tags: loadedDraftKingsSlate.data.draft_group.all_tags
              },
              salary_slate: loadedDraftKingsSlate.data.salary_slate
            }
          }),
      ...(!loadedMoneylineSlate.success || !loadedMoneylineSlate.data.moneyline_slate
        ? {
            betting_edge_reason:
              bettingEdgeReason ??
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
