import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  buildBettingEdgeBoard,
  createEmptyBettingEdgeBoard,
  getUtcDateString,
  loadDraftKingsSportsbookMlbMoneylineSlate,
  loadLiveSlate
} from "@lib/services";

const DEFAULT_SIMULATION = {
  seed: 20260328,
  iterations: 250
} as const;

const BETTING_EDGE_SOURCE = "mlb-statsapi-live+draftkings-sportsbook-moneyline";
const BETTING_EDGE_LABEL = "DraftKings Sportsbook MLB Pregame Moneyline";

export async function GET(request: NextRequest): Promise<Response> {
  const date = request.nextUrl.searchParams.get("date") ?? getUtcDateString();
  const [loadedLiveSlate, loadedMoneylineSlate] = await Promise.all([
    loadLiveSlate(date),
    loadDraftKingsSportsbookMlbMoneylineSlate({ date })
  ]);

  if (!loadedLiveSlate.success) {
    return NextResponse.json(
      {
        source: BETTING_EDGE_SOURCE,
        error: loadedLiveSlate.error
      },
      { status: 502 }
    );
  }

  if (!loadedMoneylineSlate.success) {
    return NextResponse.json(
      {
        source: BETTING_EDGE_SOURCE,
        error: loadedMoneylineSlate.error
      },
      { status: 502 }
    );
  }

  const note = loadedMoneylineSlate.data.note ?? loadedLiveSlate.data.note;

  if (!loadedMoneylineSlate.data.moneyline_slate) {
    return NextResponse.json(
      createEmptyBettingEdgeBoard({
        source: BETTING_EDGE_SOURCE,
        date,
        generated_at: loadedLiveSlate.data.generated_at,
        counts: {
          ...loadedLiveSlate.data.counts,
          moneyline_entries: 0,
          matched_markets: 0
        },
        note,
        draftkings_sportsbook_moneyline: null
      })
    );
  }

  return NextResponse.json(
    buildBettingEdgeBoard(loadedLiveSlate.data.games, {
      source: BETTING_EDGE_SOURCE,
      date,
      generated_at: loadedLiveSlate.data.generated_at,
      counts: loadedLiveSlate.data.counts,
      note,
      draftkings_sportsbook_moneyline: {
        site: loadedMoneylineSlate.data.moneyline_slate.site,
        label: BETTING_EDGE_LABEL
      },
      moneyline_slate: loadedMoneylineSlate.data.moneyline_slate,
      simulation: DEFAULT_SIMULATION
    })
  );
}
