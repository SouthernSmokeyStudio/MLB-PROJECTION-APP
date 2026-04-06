import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { buildScheduleBoard, getUtcDateString, loadLiveSlate } from "@lib/services";

const DEFAULT_SIMULATION = {
  seed: 20260328,
  iterations: 250
} as const;

export async function GET(request: NextRequest): Promise<Response> {
  const date = request.nextUrl.searchParams.get("date") ?? getUtcDateString();
  const loaded = await loadLiveSlate(date);

  if (!loaded.success) {
    return NextResponse.json(
      {
        source: "mlb-statsapi-live",
        error: loaded.error
      },
      { status: 502 }
    );
  }

  return NextResponse.json(
    buildScheduleBoard(loaded.data.games, {
      source: loaded.data.source,
      date: loaded.data.date,
      generated_at: loaded.data.generated_at,
      counts: loaded.data.counts,
      note: loaded.data.note,
      simulation: DEFAULT_SIMULATION
    })
  );
}
