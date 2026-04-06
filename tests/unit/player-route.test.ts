import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import rawFixture from "../../data/fixtures/sample-raw-game.json";
import preparedFixture from "../../data/fixtures/sample-prepared-game.json";
import { parseMlbStatsApiGamePayload } from "../../lib/adapters/mlbStatsApi";
import type { PreparedGameInputs } from "../../lib/contracts/prepared";
import { normalizeMlbStatsApiGame } from "../../lib/normalization/mlbStatsApiNormalizer";

vi.mock("@lib/services/loadLiveSlate", () => ({
  getUtcDateString: () => "2026-03-27",
  loadLiveSlate: vi.fn()
}));

import { GET } from "@/app/api/players/route";
import { loadLiveSlate } from "@/lib/services/loadLiveSlate";

const prepared = preparedFixture as unknown as PreparedGameInputs;
const parsed = parseMlbStatsApiGamePayload(rawFixture);

if (!parsed.success) {
  throw new Error(parsed.error);
}

const normalized = normalizeMlbStatsApiGame(parsed.data);

if (!normalized.success) {
  throw new Error(normalized.error);
}

describe("/api/players route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a live-backed player-board-v1 payload", async () => {
    vi.mocked(loadLiveSlate).mockResolvedValue({
      success: true,
      data: {
        source: "mlb-statsapi-live",
        date: "2026-03-27",
        generated_at: "2026-03-27T15:30:00Z",
        counts: {
          fetched_raw: 1,
          parsed: 1,
          normalized: 1,
          prepared: 1,
          boxscore_enriched: 1
        },
        note: null,
        games: [
          {
            parsedGame: parsed.data,
            canonicalGame: normalized.data,
            preparedGame: prepared,
            playerIdentities: {
              "gerrit-cole": {
                player_id: "gerrit-cole" as never,
                full_name: "Gerrit Cole",
                position: "P",
                batting_order: null
              },
              "nyy-1": {
                player_id: "nyy-1" as never,
                full_name: "Aaron Judge",
                position: "RF",
                batting_order: 1
              }
            }
          }
        ]
      }
    });

    const response = await GET(
      new NextRequest("http://localhost/api/players?date=2026-03-27")
    );
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(loadLiveSlate).toHaveBeenCalledWith("2026-03-27");
    expect(payload.mode).toBe("player-board-v1");
    expect(payload.source).toBe("mlb-statsapi-live");
    expect(Array.isArray(payload.players)).toBe(true);

    const players = payload.players as Array<Record<string, unknown>>;
    expect(players.length).toBeGreaterThan(0);
    expect(players.some((player) => player.full_name === "Gerrit Cole")).toBe(true);
  });

  it("returns a 502 when the live slate loader fails", async () => {
    vi.mocked(loadLiveSlate).mockResolvedValue({
      success: false,
      error: "schedule fetch failed"
    });

    const response = await GET(new NextRequest("http://localhost/api/players"));
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(502);
    expect(payload.source).toBe("mlb-statsapi-live");
    expect(payload.error).toBe("schedule fetch failed");
  });
});
