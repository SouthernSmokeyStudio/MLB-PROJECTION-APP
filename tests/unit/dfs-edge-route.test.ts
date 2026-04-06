import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import rawFixture from "../../data/fixtures/sample-raw-game.json";
import preparedFixture from "../../data/fixtures/sample-prepared-game.json";
import type {
  DraftKingsClassicDraftGroup,
  DraftKingsClassicSalarySlate
} from "../../lib/contracts/draftkings-classic";
import type { PreparedGameInputs } from "../../lib/contracts/prepared";
import { asISOTimestamp, asPlayerId } from "../../lib/contracts/types";
import { parseMlbStatsApiGamePayload } from "../../lib/adapters/mlbStatsApi";
import { normalizeMlbStatsApiGame } from "../../lib/normalization/mlbStatsApiNormalizer";
import { buildPlayerCards } from "../../lib/services/buildPlayerCard";

vi.mock("@lib/services", async () => {
  const actual = await vi.importActual<typeof import("@lib/services")>("@lib/services");
  return {
    ...actual,
    getUtcDateString: () => "2026-03-27",
    loadLiveSlate: vi.fn(),
    loadDraftKingsClassicSlate: vi.fn()
  };
});

import { GET } from "@/app/api/dfs-edge/route";
import { loadDraftKingsClassicSlate, loadLiveSlate } from "@lib/services";

const prepared = preparedFixture as unknown as PreparedGameInputs;
const playerCards = buildPlayerCards(prepared).players;
const parsed = parseMlbStatsApiGamePayload(rawFixture);

if (!parsed.success) {
  throw new Error(parsed.error);
}

const normalized = normalizeMlbStatsApiGame(parsed.data);

if (!normalized.success) {
  throw new Error(normalized.error);
}

const DRAFT_GROUP: DraftKingsClassicDraftGroup = {
  draft_group_id: "145020",
  sport_id: 2,
  contest_type_id: 28,
  game_type_id: 2,
  draft_group_state: "upcoming",
  sort_order: 1,
  start_time_suffix: " | 7:05 PM ET",
  min_start_time: asISOTimestamp("2026-03-27T23:05:00Z"),
  max_start_time: asISOTimestamp("2026-03-28T02:10:00Z"),
  allow_lineup_creation: true,
  all_tags: ["Featured"],
  competition_ids: ["6157701"]
};

const makeSalarySlate = (
  playerIds: readonly string[]
): DraftKingsClassicSalarySlate => ({
  provider: "draftkings",
  contest_type: "classic",
  draft_group_id: "145020",
  source: {
    provider: "draftkings",
    endpoint:
      "https://api.draftkings.com/draftgroups/v1/draftgroups/145020/draftables?format=json",
    fetched_at: asISOTimestamp("2026-03-27T15:35:00Z"),
    raw_payload_hash: null
  },
  salaries: playerIds.map((playerId, index) => ({
    draftable_id: String(900000 + index),
    player_id: asPlayerId(playerId),
    player_dk_id: String(800000 + index),
    display_name: `Player ${index + 1}`,
    short_name: `P${index + 1}`,
    position: index < 2 ? "SP" : "OF",
    roster_slot_id: index < 2 ? 110 : 200,
    salary: 5000 + index * 250,
    team_abbreviation: index % 2 === 0 ? "NYY" : "BOS",
    competition_id: "6157701",
    competition_name: "NYY @ BOS",
    competition_start: asISOTimestamp("2026-03-27T23:05:00Z")
  }))
});

describe("/api/dfs-edge route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a live DraftKings Classic dfs-edge-board-v1 payload", async () => {
    const omittedPlayerId = playerCards[0]?.player_id;

    if (!omittedPlayerId) {
      throw new Error("Expected at least one player card");
    }

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
              "chris-sale": {
                player_id: "chris-sale" as never,
                full_name: "Chris Sale",
                position: "P",
                batting_order: null
              },
              "nyy-1": {
                player_id: "nyy-1" as never,
                full_name: "Aaron Judge",
                position: "RF",
                batting_order: 1
              },
              "bos-1": {
                player_id: "bos-1" as never,
                full_name: "Jarren Duran",
                position: "LF",
                batting_order: 1
              }
            }
          }
        ]
      }
    });
    vi.mocked(loadDraftKingsClassicSlate).mockResolvedValue({
      success: true,
      data: {
        source: "draftkings-classic-live",
        date: "2026-03-27",
        generated_at: "2026-03-27T15:35:00Z",
        draft_group: DRAFT_GROUP,
        label: "Featured DraftKings Classic",
        salary_slate: makeSalarySlate(
          playerCards
            .filter((player) => player.player_id !== omittedPlayerId)
            .map((player) => player.player_id)
        ),
        note: null
      }
    });

    const response = await GET(
      new NextRequest("http://localhost/api/dfs-edge?date=2026-03-27")
    );
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(loadLiveSlate).toHaveBeenCalledWith("2026-03-27");
    expect(loadDraftKingsClassicSlate).toHaveBeenCalledWith({
      date: "2026-03-27"
    });
    expect(payload.mode).toBe("dfs-edge-board-v1");
    expect(payload.source).toBe("mlb-statsapi-live+draftkings-classic");

    const readyPitchers = payload.ready_pitchers as Array<Record<string, unknown>>;
    const readyBatters = payload.ready_batters as Array<Record<string, unknown>>;
    const heldPlayers = payload.held_players as Array<Record<string, unknown>>;
    const summary = payload.summary as Record<string, unknown>;

    expect(readyPitchers.length + readyBatters.length).toBeGreaterThan(0);
    expect(heldPlayers.length).toBeGreaterThan(0);
    expect(summary.ready_players).toBe(readyPitchers.length + readyBatters.length);
    expect(summary.held_players).toBe(heldPlayers.length);
  });

  it("returns an empty dfs-edge-board-v1 payload when no DraftKings Classic slate is available", async () => {
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
            playerIdentities: {}
          }
        ]
      }
    });
    vi.mocked(loadDraftKingsClassicSlate).mockResolvedValue({
      success: true,
      data: {
        source: "draftkings-classic-live",
        date: "2026-03-27",
        generated_at: "2026-03-27T15:35:00Z",
        draft_group: null,
        label: null,
        salary_slate: null,
        note: "No DraftKings Classic salary slate matched the requested date."
      }
    });

    const response = await GET(
      new NextRequest("http://localhost/api/dfs-edge?date=2026-03-27")
    );
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload.mode).toBe("dfs-edge-board-v1");
    expect(payload.draftkings_classic).toBeNull();
    expect(payload.note).toBe("No DraftKings Classic salary slate matched the requested date.");
    expect(payload.ready_pitchers).toEqual([]);
    expect(payload.ready_batters).toEqual([]);
    expect(payload.held_players).toEqual([]);
  });

  it("returns a 502 when the DraftKings Classic slate loader fails", async () => {
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
        games: []
      }
    });
    vi.mocked(loadDraftKingsClassicSlate).mockResolvedValue({
      success: false,
      error: "draft group fetch failed"
    });

    const response = await GET(new NextRequest("http://localhost/api/dfs-edge"));
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(502);
    expect(payload.source).toBe("mlb-statsapi-live+draftkings-classic");
    expect(payload.error).toBe("draft group fetch failed");
  });
});
