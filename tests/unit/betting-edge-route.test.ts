import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import rawFixture from "../../data/fixtures/sample-raw-game.json";
import preparedFixture from "../../data/fixtures/sample-prepared-game.json";
import type { DraftKingsSportsbookMlbMoneylineSlate } from "../../lib/contracts/draftkings-sportsbook-mlb-moneyline";
import type { PreparedGameInputs } from "../../lib/contracts/prepared";
import { asISOTimestamp } from "../../lib/contracts/types";
import { parseMlbStatsApiGamePayload } from "../../lib/adapters/mlbStatsApi";
import { normalizeMlbStatsApiGame } from "../../lib/normalization/mlbStatsApiNormalizer";

vi.mock("@lib/services", async () => {
  const actual = await vi.importActual<typeof import("@lib/services")>("@lib/services");
  return {
    ...actual,
    getUtcDateString: () => "2026-03-27",
    loadLiveSlate: vi.fn(),
    loadDraftKingsSportsbookMlbMoneylineSlate: vi.fn(),
    buildSlateSnapshot: vi.fn(),
    buildBettingEdgeBoard: vi.fn()
  };
});

import { GET } from "@/app/api/betting-edge/route";
import {
  buildBettingEdgeBoard,
  buildSlateSnapshot,
  loadDraftKingsSportsbookMlbMoneylineSlate,
  loadLiveSlate
} from "@lib/services";

const prepared = preparedFixture as unknown as PreparedGameInputs;
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

describe("/api/betting-edge route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a live DraftKings Sportsbook betting-edge-board-v1 payload", async () => {
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
            playerIdentities: {},
            liveScoreState: EMPTY_LIVE_SCORE_STATE
          }
        ]
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
    vi.mocked(buildSlateSnapshot).mockReturnValue({
      source: "mlb-statsapi-live",
      mode: "slate-snapshot-v1",
      version: 1,
      date: "2026-03-27",
      generated_at: "2026-03-27T15:30:00Z",
      counts: {
        fetched_raw: 1,
        parsed: 1,
        normalized: 1,
        prepared: 1,
        boxscore_enriched: 1
      },
      publication: {
        is_complete: false,
        blocked_sections: ["smoke_signal", "live_scoreboard"]
      },
      degradation: {
        schedule: { state: "ready", reason: null },
        player_projections: { state: "ready", reason: null },
        dfs_edge: { state: "blocked", reason: "blocked" },
        betting_edge: { state: "ready", reason: null },
        smoke_signal: { state: "blocked", reason: "blocked" },
        live_scoreboard: { state: "blocked", reason: "blocked" }
      },
      schedule: { status: { state: "ready", reason: null }, payload: null },
      player_projections: { status: { state: "ready", reason: null }, payload: null },
      dfs_edge: { status: { state: "blocked", reason: "blocked" }, payload: null },
      betting_edge: {
        status: { state: "ready", reason: null },
        payload: {
          source: "mlb-statsapi-live+draftkings-sportsbook-moneyline",
          mode: "betting-edge-board-v1",
          date: "2026-03-27",
          generated_at: "2026-03-27T15:30:00Z",
          draftkings_sportsbook_moneyline: {
            provider: "draftkings-sportsbook",
            sport: "MLB",
            market_type: "moneyline",
            site: "US-TN-SB",
            label: "DraftKings Sportsbook MLB Pregame Moneyline"
          },
          summary: {
            total_games: 1,
            ready_games: 1,
            held_games: 0,
            average_ready_edge: 0.05,
            top_edge_side: {
              game_id: "mlb-2026-03-27-nyy-bos",
              matchup: "New York Yankees at Boston Red Sox",
              team_abbreviation: "NYY",
              team_full_name: "New York Yankees",
              opponent_team_abbreviation: "BOS",
              market_odds_american: 110,
              fair_american_odds: -122,
              model_probability: 0.55,
              edge: 0.05
            }
          },
          counts: {
            fetched_raw: 1,
            parsed: 1,
            normalized: 1,
            prepared: 1,
            boxscore_enriched: 1,
            moneyline_entries: 1,
            matched_markets: 1
          },
          ready_games: [
            {
              game_id: "mlb-2026-03-27-nyy-bos",
              matchup: "New York Yankees at Boston Red Sox",
              scheduled_start: "2026-03-27T23:05:00Z",
              status: "scheduled",
              venue_name: "Fenway Park",
              away_team_abbreviation: "NYY",
              away_team_full_name: "New York Yankees",
              home_team_abbreviation: "BOS",
              home_team_full_name: "Boston Red Sox",
              projection: {
                blocked: {
                  is_blocked: false,
                  blocked_reason: null
                },
                projected_away_runs: 4.6,
                projected_home_runs: 3.9,
                projected_total: 8.5,
                away_win_probability: 0.55,
                home_win_probability: 0.45
              },
              draftkings_sportsbook_moneyline: {
                provider: "draftkings-sportsbook",
                sport: "MLB",
                market_type: "moneyline",
                event_id: "33937444",
                market_id: "1_84191347",
                away_odds_american: 110,
                home_odds_american: -130,
                away: {
                  team_side: "away",
                  team_abbreviation: "NYY",
                  team_full_name: "New York Yankees",
                  market_odds_american: 110,
                  model_probability: 0.55,
                  market_implied_probability: 0.47619,
                  market_no_vig_probability: 0.5,
                  edge: 0.05,
                  fair_american_odds: -122
                },
                home: {
                  team_side: "home",
                  team_abbreviation: "BOS",
                  team_full_name: "Boston Red Sox",
                  market_odds_american: -130,
                  model_probability: 0.45,
                  market_implied_probability: 0.565217,
                  market_no_vig_probability: 0.5,
                  edge: -0.05,
                  fair_american_odds: 122
                },
                blocked: {
                  is_blocked: false,
                  blocked_reason: null
                }
              }
            }
          ],
          held_games: [],
          note: null
        }
      },
      smoke_signal: { status: { state: "blocked", reason: "blocked" }, payload: null },
      live_scoreboard: { status: { state: "blocked", reason: "blocked" }, payload: null }
    } as never);

    const response = await GET(
      new NextRequest("http://localhost/api/betting-edge?date=2026-03-27")
    );
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(loadLiveSlate).toHaveBeenCalledWith("2026-03-27");
    expect(loadDraftKingsSportsbookMlbMoneylineSlate).toHaveBeenCalledWith({
      date: "2026-03-27"
    });
    expect(buildSlateSnapshot).toHaveBeenCalledTimes(1);
    expect(buildBettingEdgeBoard).not.toHaveBeenCalled();
    expect(payload.mode).toBe("betting-edge-board-v1");
    expect(payload.source).toBe("mlb-statsapi-live+draftkings-sportsbook-moneyline");

    const readyGames = payload.ready_games as Array<Record<string, unknown>>;
    const heldGames = payload.held_games as Array<Record<string, unknown>>;
    const summary = payload.summary as Record<string, unknown>;

    expect(readyGames.length).toBeGreaterThan(0);
    expect(heldGames.length).toBe(0);
    expect(summary.ready_games).toBe(readyGames.length);
    expect(summary.held_games).toBe(heldGames.length);
  });

  it("returns an empty betting-edge-board-v1 payload when no sportsbook slate is available", async () => {
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
            playerIdentities: {},
            liveScoreState: EMPTY_LIVE_SCORE_STATE
          }
        ]
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
    vi.mocked(buildSlateSnapshot).mockReturnValue({
      source: "mlb-statsapi-live",
      mode: "slate-snapshot-v1",
      version: 1,
      date: "2026-03-27",
      generated_at: "2026-03-27T15:30:00Z",
      counts: {
        fetched_raw: 1,
        parsed: 1,
        normalized: 1,
        prepared: 1,
        boxscore_enriched: 1
      },
      publication: {
        is_complete: false,
        blocked_sections: ["betting_edge", "smoke_signal", "live_scoreboard"]
      },
      degradation: {
        schedule: { state: "ready", reason: null },
        player_projections: { state: "ready", reason: null },
        dfs_edge: { state: "blocked", reason: "blocked" },
        betting_edge: {
          state: "blocked",
          reason: "No DraftKings Sportsbook MLB pregame moneyline rows matched the requested date."
        },
        smoke_signal: { state: "blocked", reason: "blocked" },
        live_scoreboard: { state: "blocked", reason: "blocked" }
      },
      schedule: { status: { state: "ready", reason: null }, payload: null },
      player_projections: { status: { state: "ready", reason: null }, payload: null },
      dfs_edge: { status: { state: "blocked", reason: "blocked" }, payload: null },
      betting_edge: {
        status: {
          state: "blocked",
          reason: "No DraftKings Sportsbook MLB pregame moneyline rows matched the requested date."
        },
        payload: null
      },
      smoke_signal: { status: { state: "blocked", reason: "blocked" }, payload: null },
      live_scoreboard: { status: { state: "blocked", reason: "blocked" }, payload: null }
    } as never);

    const response = await GET(
      new NextRequest("http://localhost/api/betting-edge?date=2026-03-27")
    );
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload.mode).toBe("betting-edge-board-v1");
    expect(payload.draftkings_sportsbook_moneyline).toBeNull();
    expect(payload.note).toBe(
      "No DraftKings Sportsbook MLB pregame moneyline rows matched the requested date."
    );
    expect(payload.ready_games).toEqual([]);
    expect(payload.held_games).toEqual([]);
    expect(buildSlateSnapshot).toHaveBeenCalledTimes(1);
    expect(buildBettingEdgeBoard).not.toHaveBeenCalled();
  });

  it("returns a 502 when the sportsbook moneyline loader fails", async () => {
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
    vi.mocked(loadDraftKingsSportsbookMlbMoneylineSlate).mockResolvedValue({
      success: false,
      error: "moneyline fetch failed"
    });

    const response = await GET(new NextRequest("http://localhost/api/betting-edge"));
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(502);
    expect(payload.source).toBe("mlb-statsapi-live+draftkings-sportsbook-moneyline");
    expect(payload.error).toBe("moneyline fetch failed");
    expect(buildSlateSnapshot).not.toHaveBeenCalled();
    expect(buildBettingEdgeBoard).not.toHaveBeenCalled();
  });
});
