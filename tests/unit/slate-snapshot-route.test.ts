import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import rawFixture from "../../data/fixtures/sample-raw-game.json";
import preparedFixture from "../../data/fixtures/sample-prepared-game.json";
import type {
  DraftKingsClassicDraftGroup,
  DraftKingsClassicSalarySlate
} from "../../lib/contracts/draftkings-classic";
import type { DraftKingsSportsbookMlbMoneylineSlate } from "../../lib/contracts/draftkings-sportsbook-mlb-moneyline";
import type { PreparedGameInputs } from "../../lib/contracts/prepared";
import { asISOTimestamp, asPlayerId } from "../../lib/contracts/types";
import { parseMlbStatsApiGamePayload } from "../../lib/adapters/mlbStatsApi";
import { normalizeMlbStatsApiGame } from "../../lib/normalization/mlbStatsApiNormalizer";
import { buildPlayerCards } from "../../lib/services/buildPlayerCard";
import { parseSlateSnapshotPayload } from "../../lib/slate-snapshot";

vi.mock("@lib/services", async () => {
  const actual = await vi.importActual<typeof import("@lib/services")>("@lib/services");
  return {
    ...actual,
    getUtcDateString: () => "2026-03-27",
    loadLiveSlate: vi.fn(),
    loadDraftKingsClassicSlate: vi.fn(),
    loadDraftKingsSportsbookMlbMoneylineSlate: vi.fn(),
    loadMaterializedSlate: vi.fn().mockResolvedValue({
      success: false,
      error: "No materialized slate artifact found"
    })
  };
});

vi.mock("@lib/materializer", async () => {
  const actual = await vi.importActual<typeof import("@lib/materializer")>("@lib/materializer");
  return {
    ...actual,
    buildMaterializerConfig: vi.fn().mockReturnValue({
      success: false,
      error: "projected source not configured"
    })
  };
});

import { GET } from "@/app/api/slate-snapshot/route";
import {
  loadDraftKingsClassicSlate,
  loadDraftKingsSportsbookMlbMoneylineSlate,
  loadLiveSlate
} from "@lib/services";
import { buildMaterializerConfig } from "@lib/materializer";

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

const EMPTY_LIVE_SCORE_STATE = {
  away_score: null,
  home_score: null,
  inning_number: null,
  inning_state: null,
  is_live: false,
  is_final: false,
  display_state: "Scheduled"
} as const;

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

const makeMoneylineSlate = (): DraftKingsSportsbookMlbMoneylineSlate => ({
  provider: "draftkings-sportsbook",
  sport: "MLB",
  market_type: "moneyline",
  site: "US-TN-SB",
  league_id: "84240",
  subcategory_id: "4519",
  source: {
    provider: "draftkings-sportsbook",
    endpoint:
      "https://sportsbook-nash.draftkings.com/sites/US-TN-SB/api/sportscontent/controldata/league/leagueSubcategory/v1/markets",
    fetched_at: asISOTimestamp("2026-03-27T15:35:00Z"),
    raw_payload_hash: null
  },
  entries: [
    {
      event_id: "33937444",
      market_id: "1_84191347",
      event_name: "NYY @ BOS",
      start_time: asISOTimestamp("2026-03-27T19:05:00Z"),
      away_team_abbreviation: "NYY",
      away_team_name: "New York Yankees",
      away_starting_pitcher: "Gerrit Cole",
      home_team_abbreviation: "BOS",
      home_team_name: "Boston Red Sox",
      home_starting_pitcher: "Chris Sale",
      away_odds_american: 110,
      away_odds_decimal: 2.1,
      home_odds_american: -130,
      home_odds_decimal: 1.77
    }
  ]
});

describe("/api/slate-snapshot route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(buildMaterializerConfig).mockReturnValue({
      success: false,
      error: "projected source not configured"
    });
  });

  it("returns a wrapped slate-snapshot-v1 payload", async () => {
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
            liveScoreState: EMPTY_LIVE_SCORE_STATE,
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
    vi.mocked(loadDraftKingsSportsbookMlbMoneylineSlate).mockResolvedValue({
      success: true,
      data: {
        source: "draftkings-sportsbook-mlb-moneyline-live",
        date: "2026-03-27",
        generated_at: "2026-03-27T15:35:00Z",
        moneyline_slate: makeMoneylineSlate(),
        note: null
      }
    });

    const response = await GET(
      new NextRequest("http://localhost/api/slate-snapshot?date=2026-03-27")
    );
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(loadLiveSlate).toHaveBeenCalledWith("2026-03-27", expect.objectContaining({ materializedBaseline: undefined }));
    expect(loadDraftKingsClassicSlate).toHaveBeenCalledWith({
      date: "2026-03-27"
    });
    expect(loadDraftKingsSportsbookMlbMoneylineSlate).toHaveBeenCalledWith({
      date: "2026-03-27"
    });
    expect(payload.mode).toBe("slate-snapshot-v1");
    expect(payload.source).toBe("mlb-statsapi-live");

    const schedule = payload.schedule as Record<string, unknown>;
    const playerProjections = payload.player_projections as Record<string, unknown>;
    const dfsEdge = payload.dfs_edge as Record<string, unknown>;
    const bettingEdge = payload.betting_edge as Record<string, unknown>;
    const smokeSignal = payload.smoke_signal as Record<string, unknown>;
    const liveScoreboard = payload.live_scoreboard as Record<string, unknown>;

    expect((schedule.payload as Record<string, unknown>).mode).toBe("schedule-board-v1");
    expect((playerProjections.payload as Record<string, unknown>).mode).toBe("player-board-v1");
    expect((dfsEdge.payload as Record<string, unknown>).mode).toBe("dfs-edge-board-v1");
    expect((bettingEdge.payload as Record<string, unknown>).mode).toBe("betting-edge-board-v1");
    expect((smokeSignal.payload as Record<string, unknown>).mode).toBe("smoke-signal-v1");
    expect((liveScoreboard.payload as Record<string, unknown>).mode).toBe("live-scoreboard-v1");
    expect((dfsEdge.status as Record<string, unknown>).state).toBe("partial");
    expect((bettingEdge.status as Record<string, unknown>).state).toBe("ready");
    expect((smokeSignal.status as Record<string, unknown>).state).toBe("ready");
    expect((liveScoreboard.status as Record<string, unknown>).state).toBe("ready");
  });

  it("publishes a partial snapshot when downstream loaders do not yield publishable slates", async () => {
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
        note: "Live slate note",
        games: [
          {
            parsedGame: parsed.data,
            canonicalGame: normalized.data,
            preparedGame: prepared,
            playerIdentities: {},
            liveScoreState: EMPTY_LIVE_SCORE_STATE
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
    vi.mocked(loadDraftKingsSportsbookMlbMoneylineSlate).mockResolvedValue({
      success: false,
      error: "moneyline fetch failed"
    });

    const response = await GET(
      new NextRequest("http://localhost/api/slate-snapshot?date=2026-03-27")
    );
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload.mode).toBe("slate-snapshot-v1");

    const dfsEdge = payload.dfs_edge as Record<string, unknown>;
    const bettingEdge = payload.betting_edge as Record<string, unknown>;
    const smokeSignal = payload.smoke_signal as Record<string, unknown>;
    const publication = payload.publication as Record<string, unknown>;

    expect(dfsEdge.payload).toBeNull();
    expect((dfsEdge.status as Record<string, unknown>).state).toBe("blocked");
    expect((dfsEdge.status as Record<string, unknown>).reason).toBe(
      "No DraftKings Classic salary slate matched the requested date."
    );
    expect(bettingEdge.payload).toBeNull();
    expect((bettingEdge.status as Record<string, unknown>).state).toBe("blocked");
    expect((bettingEdge.status as Record<string, unknown>).reason).toBe(
      "moneyline fetch failed"
    );
    expect((smokeSignal.status as Record<string, unknown>).state).toBe("partial");
    expect((smokeSignal.payload as Record<string, unknown>).mode).toBe("smoke-signal-v1");
    expect(publication.is_complete).toBe(false);
  });

  it("returns a degraded 200 snapshot when the live slate loader fails", async () => {
    vi.mocked(loadLiveSlate).mockResolvedValue({
      success: false,
      error: "MLB Stats API schedule request timed out after 15000ms"
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
    vi.mocked(loadDraftKingsSportsbookMlbMoneylineSlate).mockResolvedValue({
      success: true,
      data: {
        source: "draftkings-sportsbook-mlb-moneyline-live",
        date: "2026-03-27",
        generated_at: "2026-03-27T15:35:00Z",
        moneyline_slate: null,
        note: "No DraftKings Sportsbook MLB pregame moneyline rows matched the requested date."
      }
    });

    const response = await GET(
      new NextRequest("http://localhost/api/slate-snapshot?date=2026-03-27")
    );
    const payload = (await response.json()) as Record<string, unknown>;

    // Route returns 200, not 502
    expect(response.status).toBe(200);

    // Valid snapshot shape
    expect(payload.mode).toBe("slate-snapshot-v1");
    expect(payload.source).toBe("mlb-statsapi-live");

    // Schedule and player_projections are blocked with the MLB error
    const schedule = payload.schedule as Record<string, unknown>;
    const playerProjections = payload.player_projections as Record<string, unknown>;
    expect((schedule.status as Record<string, unknown>).state).toBe("blocked");
    expect((schedule.status as Record<string, unknown>).reason).toContain(
      "MLB Stats API schedule request timed out"
    );
    expect((playerProjections.status as Record<string, unknown>).state).toBe("blocked");
    expect((playerProjections.status as Record<string, unknown>).reason).toContain(
      "MLB Stats API schedule request timed out"
    );

    // No fake games emitted
    const schedulePayload = schedule.payload as Record<string, unknown>;
    expect((schedulePayload.games as unknown[]).length).toBe(0);

    // DFS and betting edge are blocked (no games to join against)
    const dfsEdge = payload.dfs_edge as Record<string, unknown>;
    const bettingEdge = payload.betting_edge as Record<string, unknown>;
    expect((dfsEdge.status as Record<string, unknown>).state).toBe("blocked");
    expect((dfsEdge.status as Record<string, unknown>).reason).toContain(
      "MLB schedule unavailable"
    );
    expect((bettingEdge.status as Record<string, unknown>).state).toBe("blocked");
    expect((bettingEdge.status as Record<string, unknown>).reason).toContain(
      "MLB schedule unavailable"
    );

    // Publication is incomplete
    const publication = payload.publication as Record<string, unknown>;
    expect(publication.is_complete).toBe(false);
    expect(publication.blocked_sections).toContain("schedule");
    expect(publication.blocked_sections).toContain("player_projections");
    expect(publication.blocked_sections).toContain("dfs_edge");
    expect(publication.blocked_sections).toContain("betting_edge");

    // Counts reflect zero games
    const counts = payload.counts as Record<string, unknown>;
    expect(counts.fetched_raw).toBe(0);
    expect(counts.parsed).toBe(0);
    expect(counts.normalized).toBe(0);
    expect(counts.prepared).toBe(0);
    expect(counts.boxscore_enriched).toBe(0);
  });

  it("degraded MLB snapshot passes round-trip validation through parseSlateSnapshotPayload", async () => {
    vi.mocked(loadLiveSlate).mockResolvedValue({
      success: false,
      error: "MLB Stats API schedule request failed with status 503"
    });
    vi.mocked(loadDraftKingsClassicSlate).mockResolvedValue({
      success: false,
      error: "DraftKings Classic draft group request timed out after 15000ms"
    });
    vi.mocked(loadDraftKingsSportsbookMlbMoneylineSlate).mockResolvedValue({
      success: false,
      error: "DraftKings Sportsbook MLB moneyline request timed out after 15000ms"
    });

    const response = await GET(
      new NextRequest("http://localhost/api/slate-snapshot?date=2026-03-27")
    );

    expect(response.status).toBe(200);
    const rawPayload = await response.json();

    // Schema lock: degraded output must also pass the validator
    expect(() => parseSlateSnapshotPayload(rawPayload)).not.toThrow();

    const validated = parseSlateSnapshotPayload(rawPayload);
    expect(validated.mode).toBe("slate-snapshot-v1");
    expect(validated.version).toBe(1);
    expect(validated.schedule.status.state).toBe("blocked");
    expect(validated.schedule.payload?.games).toHaveLength(0);
    expect(validated.publication.is_complete).toBe(false);
  });

  it("returns a snapshot that passes round-trip validation through parseSlateSnapshotPayload", async () => {
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
            liveScoreState: EMPTY_LIVE_SCORE_STATE,
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
    vi.mocked(loadDraftKingsSportsbookMlbMoneylineSlate).mockResolvedValue({
      success: true,
      data: {
        source: "draftkings-sportsbook-mlb-moneyline-live",
        date: "2026-03-27",
        generated_at: "2026-03-27T15:35:00Z",
        moneyline_slate: null,
        note: "No DraftKings Sportsbook MLB pregame moneyline rows matched the requested date."
      }
    });

    const response = await GET(
      new NextRequest("http://localhost/api/slate-snapshot?date=2026-03-27")
    );

    expect(response.status).toBe(200);
    const rawPayload = await response.json();

    // Schema lock: the route output must pass through the validator without throwing.
    // This proves the builder and the parser agree on the shape.
    expect(() => parseSlateSnapshotPayload(rawPayload)).not.toThrow();

    const validated = parseSlateSnapshotPayload(rawPayload);
    expect(validated.mode).toBe("slate-snapshot-v1");
    expect(validated.version).toBe(1);
    expect(validated.schedule.status.state).toBe("ready");
    expect(validated.schedule.payload?.games).toHaveLength(1);
  });

  it("passes configured projected starter data into loadLiveSlate", async () => {
    const fetchProjectedData = vi.fn().mockResolvedValue({
      success: true,
      data: {
        provider_meta: {
          provider: "test",
          fetched_at: asISOTimestamp("2026-03-27T15:29:00Z"),
          source_url: null
        },
        date: "2026-03-27",
        generated_at: asISOTimestamp("2026-03-27T15:29:00Z"),
        games: [
          {
            game_id: "mlb-2026-03-27-nyy-bos",
            away_starter: {
              player_id: "gerrit-cole",
              team_id: "nyy",
              handedness: "R",
              starting_status: "probable",
              confidence: "medium"
            },
            home_starter: {
              player_id: "chris-sale",
              team_id: "bos",
              handedness: "L",
              starting_status: "probable",
              confidence: "medium"
            },
            away_lineup: null,
            home_lineup: null
          }
        ]
      }
    });

    vi.mocked(buildMaterializerConfig).mockReturnValue({
      success: true,
      data: {
        projectedAdapter: {
          source: "test-projected",
          fetchProjectedData
        },
        inferenceEngine: null,
        officialOnly: false
      }
    });
    vi.mocked(loadLiveSlate).mockResolvedValue({
      success: true,
      data: {
        source: "mlb-statsapi-live",
        date: "2026-03-27",
        generated_at: "2026-03-27T15:30:00Z",
        counts: {
          fetched_raw: 0,
          parsed: 0,
          normalized: 0,
          prepared: 0,
          boxscore_enriched: 0
        },
        note: null,
        games: []
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
    vi.mocked(loadDraftKingsSportsbookMlbMoneylineSlate).mockResolvedValue({
      success: true,
      data: {
        source: "draftkings-sportsbook-mlb-moneyline-live",
        date: "2026-03-27",
        generated_at: "2026-03-27T15:35:00Z",
        moneyline_slate: null,
        note: "No DraftKings Sportsbook MLB pregame moneyline rows matched the requested date."
      }
    });

    await GET(new NextRequest("http://localhost/api/slate-snapshot?date=2026-03-27"));

    expect(fetchProjectedData).toHaveBeenCalledWith("2026-03-27");
    const liveSlateOptions = vi.mocked(loadLiveSlate).mock.calls[0]?.[1];
    expect(liveSlateOptions?.projectedGames).toBeInstanceOf(Map);
    expect(liveSlateOptions?.projectedGames?.get("mlb-2026-03-27-nyy-bos" as never)?.away_starter?.player_id).toBe("gerrit-cole");
  });
});
