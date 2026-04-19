import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { backfillDraftKingsClassicSlate } from "@lib/services/loadDraftKingsClassicSlate";
import { getDateInScheduleTimezone } from "@lib/materializer/schedule";

// Runs at 13:00 UTC (8:00 AM CT) daily — before any MLB first pitches and
// before the DK Classic upcoming endpoint rotates away from today's groups.
//
// Two captures per run:
//   1. DK Classic salary slate → Supabase dk_classic_snapshots
//   2. Player projections → Supabase projection_run + player_projection_batter/pitcher
//
// The projection capture calls /api/projections/persist internally. That route
// owns the full prepare → assemble → persist pipeline; duplicating it here
// would create a divergence risk.
export async function GET(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const date = getDateInScheduleTimezone();
  const results: Record<string, unknown> = {};

  // 1. DK Classic capture — writes to Supabase + filesystem
  const dkClassicResult = await backfillDraftKingsClassicSlate({ date });
  results.dk_classic = dkClassicResult.success
    ? { ok: true, slate_count: dkClassicResult.data.slates.length }
    : { ok: false, error: dkClassicResult.error };

  // 2. Projection persist — delegates to the existing POST route which owns
  //    the full load → assemble → persist pipeline.
  const siteUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : `http://localhost:${process.env.PORT ?? "3000"}`;

  try {
    const persistResponse = await fetch(`${siteUrl}/api/projections/persist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date }),
      signal: AbortSignal.timeout(90_000)
    });

    const persistBody = await persistResponse.json().catch(() => ({}));

    results.projections = persistResponse.ok
      ? { ok: true, ...persistBody }
      : { ok: false, status: persistResponse.status, body: persistBody };
  } catch (err) {
    results.projections = { ok: false, error: String(err) };
  }

  const allOk = Object.values(results).every(
    (r) => typeof r === "object" && r !== null && (r as Record<string, unknown>).ok === true
  );

  return NextResponse.json({ ok: allOk, date, results }, { status: allOk ? 200 : 500 });
}
