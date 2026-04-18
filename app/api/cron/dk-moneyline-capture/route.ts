import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { captureSportsbookMlbMoneylineSlate } from "@lib/services/loadDraftKingsSportsbookMlbMoneylineSlate";
import { getDateInScheduleTimezone } from "@lib/materializer/schedule";

// Called by Vercel Cron at 13:00 UTC (8:00 AM CT) daily — before any MLB first pitches.
// Stores the full pregame moneyline slate to Supabase so it survives Lambda restarts
// and remains available after games start and rotate out of DK's NOT_STARTED feed.
export async function GET(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const date = getDateInScheduleTimezone();
  const result = await captureSportsbookMlbMoneylineSlate({ date });

  if (!result.success) {
    return NextResponse.json({ ok: false, date, error: result.error }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    date,
    entry_count: result.data.moneyline_slate.entries.length
  });
}
