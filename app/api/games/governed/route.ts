import { NextResponse } from "next/server";
import { SPORT_ID } from "@lib/contracts/types";
import { readGovernedGameOutcomes } from "@lib/supabase/readGovernedGameOutcomes";

export async function GET(): Promise<Response> {
  try {
    const games = await readGovernedGameOutcomes();

    return NextResponse.json({
      source: "supabase-governed",
      sport_id: SPORT_ID,
      review_status: "APPROVED",
      include_stale: false,
      count: games.length,
      games
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to read governed game outcomes.";

    return NextResponse.json(
      {
        source: "supabase-governed",
        error: message
      },
      { status: 500 }
    );
  }
}
