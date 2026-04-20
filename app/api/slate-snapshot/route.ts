import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getDateInScheduleTimezone } from "@lib/materializer/schedule";
import { loadPublishedSlateSnapshot } from "@lib/supabase/publishedSlateSnapshot";

// GET /api/slate-snapshot
//
// Display-only route.  Reads the pre-computed SlateSnapshotPayload from
// published_slate_snapshot (written daily by the morning-capture cron) and
// returns it directly.  No MLB Stats API calls, no projection computation,
// no DraftKings live fetches happen here.
//
// If today's published snapshot is missing or in degraded state the route
// returns HTTP 202 with explicit degraded metadata so the client can show
// a "data publishing" state rather than silently receiving stale output.
//
// The morning-capture cron runs at 13:00 UTC (8:00 AM CT) before first pitches.
// The dk-moneyline-capture cron runs at the same time and seeds the moneyline
// odds that are baked into the published snapshot.

export async function GET(request: NextRequest): Promise<Response> {
  const date = request.nextUrl.searchParams.get("date") ?? getDateInScheduleTimezone();

  const snapshot = await loadPublishedSlateSnapshot(date);

  if (!snapshot) {
    return NextResponse.json(
      {
        ok: false,
        degraded: true,
        date,
        reason: `No published snapshot for ${date}. The morning-capture pipeline publishes daily at 13:00 UTC (8:00 AM CT). If today's data is missing, the cron may not have run yet or may have failed.`
      },
      { status: 202 }
    );
  }

  if (snapshot.publication_state !== "valid") {
    // Snapshot exists but was published in a degraded state (e.g. MLB Stats API
    // was unavailable for some boards).  Return the payload so the client can
    // render whatever sections are available, with the degradation metadata.
    return NextResponse.json({
      ...snapshot.payload,
      ok: true,
      degraded: true,
      publication_state: snapshot.publication_state,
      run_id: snapshot.run_id
    });
  }

  return NextResponse.json(snapshot.payload);
}
