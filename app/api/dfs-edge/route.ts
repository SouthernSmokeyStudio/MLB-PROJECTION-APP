import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  buildDfsEdgeBoard,
  createEmptyDfsEdgeBoard,
  getUtcDateString,
  loadDraftKingsClassicSlate,
  loadLiveSlate
} from "@lib/services";

const DEFAULT_SIMULATION = {
  seed: 20260328,
  iterations: 250
} as const;

const DFS_EDGE_SOURCE = "mlb-statsapi-live+draftkings-classic";

export async function GET(request: NextRequest): Promise<Response> {
  const date = request.nextUrl.searchParams.get("date") ?? getUtcDateString();
  const draftGroupId = request.nextUrl.searchParams.get("draft_group_id") ?? undefined;
  const [loadedLiveSlate, loadedDraftKingsSlate] = await Promise.all([
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
    )
  ]);

  if (!loadedLiveSlate.success) {
    return NextResponse.json(
      {
        source: DFS_EDGE_SOURCE,
        error: loadedLiveSlate.error
      },
      { status: 502 }
    );
  }

  if (!loadedDraftKingsSlate.success) {
    return NextResponse.json(
      {
        source: DFS_EDGE_SOURCE,
        error: loadedDraftKingsSlate.error
      },
      { status: 502 }
    );
  }

  const note = loadedDraftKingsSlate.data.note ?? loadedLiveSlate.data.note;

  if (
    !loadedDraftKingsSlate.data.draft_group ||
    !loadedDraftKingsSlate.data.salary_slate
  ) {
    return NextResponse.json(
      createEmptyDfsEdgeBoard({
        source: DFS_EDGE_SOURCE,
        date,
        generated_at: loadedLiveSlate.data.generated_at,
        counts: {
          ...loadedLiveSlate.data.counts,
          salary_entries: 0,
          matched_salaries: 0
        },
        note,
        draftkings_classic: null
      })
    );
  }

  return NextResponse.json(
    buildDfsEdgeBoard(loadedLiveSlate.data.games, {
      source: DFS_EDGE_SOURCE,
      date,
      generated_at: loadedLiveSlate.data.generated_at,
      counts: loadedLiveSlate.data.counts,
      note,
      draftkings_classic: {
        draft_group_id: loadedDraftKingsSlate.data.draft_group.draft_group_id,
        label: loadedDraftKingsSlate.data.label ?? "DraftKings Classic",
        min_start_time: loadedDraftKingsSlate.data.draft_group.min_start_time,
        max_start_time: loadedDraftKingsSlate.data.draft_group.max_start_time,
        tags: loadedDraftKingsSlate.data.draft_group.all_tags
      },
      salary_slate: loadedDraftKingsSlate.data.salary_slate,
      simulation: DEFAULT_SIMULATION
    })
  );
}
