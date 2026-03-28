import { NextResponse } from "next/server";
import preparedFixture from "../../../data/fixtures/sample-prepared-game.json";
import type { PreparedGameInputs } from "@lib/contracts/prepared";
import { buildSlateView } from "@lib/services";

const prepared = preparedFixture as unknown as PreparedGameInputs;

export async function GET(): Promise<Response> {
  const slate = buildSlateView([prepared], {
    simulation: {
      seed: 20260328,
      iterations: 250
    }
  });

  return NextResponse.json({
    source: "local-fixture",
    players: slate.players_by_game_id,
    blocked: slate.blocked
  });
}
