import { describe, expect, it } from "vitest";
import type { BettingEdgeBoardPayload } from "../../lib/contracts/betting-edge-board";
import type { DfsEdgeBoardPayload } from "../../lib/contracts/dfs-edge-board";
import type { LiveScoreboardPayload } from "../../lib/contracts/live-scoreboard";
import type { PlayerBoardPayload } from "../../lib/contracts/player-board";
import type { ScheduleBoardPayload } from "../../lib/contracts/schedule-board";
import { asISOTimestamp } from "../../lib/contracts/types";
import { buildSmokeSignal } from "../../lib/services/buildSmokeSignal";

const schedule = {
  source: "mlb-statsapi-live",
  mode: "schedule-board-v1" as const,
  date: "2026-04-06",
  generated_at: asISOTimestamp("2026-04-06T11:45:00Z"),
  summary: {
    total_games: 2,
    projection_ready_games: 1,
    games_ready_for_player_projections: 1,
    blocked_games: 1,
    games_with_both_starters: 2,
    games_with_both_lineups: 1
  },
  counts: {
    fetched_raw: 2,
    parsed: 2,
    normalized: 2,
    prepared: 2,
    boxscore_enriched: 1
  },
  games: [
    {
      game_id: "mlb-2026-04-06-nyy-bos" as never,
      scheduled_start: "2026-04-06T23:40:00Z" as never,
      status: "scheduled" as const,
      venue_name: "Fenway Park",
      away_team: {
        team_id: "nyy" as never,
        abbreviation: "NYY",
        full_name: "New York Yankees",
        probable_pitcher: null,
        lineup_batters_available: 9
      },
      home_team: {
        team_id: "bos" as never,
        abbreviation: "BOS",
        full_name: "Boston Red Sox",
        probable_pitcher: null,
        lineup_batters_available: 9
      },
      has_both_starters: true,
      has_both_lineups: true,
      completeness_score: 0.95,
      player_projection_status: "ready" as const,
      projection: {
        blocked: { is_blocked: false, blocked_reason: null },
        projected_away_runs: 4.6,
        projected_home_runs: 3.9,
        projected_total: 8.5,
        away_win_probability: 0.57,
        home_win_probability: 0.43,
        average_total_runs: 8.4
      }
    }
  ],
  note: null
} as unknown as ScheduleBoardPayload;

const playerBoard = {
  source: "mlb-statsapi-live",
  mode: "player-board-v1" as const,
  date: "2026-04-06",
  generated_at: asISOTimestamp("2026-04-06T11:45:00Z"),
  summary: {
    total_players: 2,
    projected_players: 1,
    blocked_players: 1,
    pitchers: 1,
    batters: 1,
    games_covered: 1
  },
  counts: schedule.counts,
  players: [
    {
      player_id: "gerrit-cole" as never,
      full_name: "Gerrit Cole",
      position: "P" as const,
      batting_order: null,
      team_side: "away" as const,
      team_id: "nyy" as never,
      team_abbreviation: "NYY",
      team_full_name: "New York Yankees",
      opponent_team_id: "bos" as never,
      opponent_team_abbreviation: "BOS",
      opponent_team_full_name: "Boston Red Sox",
      game_id: "mlb-2026-04-06-nyy-bos" as never,
      matchup: "New York Yankees at Boston Red Sox",
      scheduled_start: "2026-04-06T23:40:00Z" as never,
      status: "scheduled" as const,
      venue_name: "Fenway Park",
      projection: {
        deterministic_summary: null,
        fantasy_summary: {
          platform: "draftkings" as const,
          contest_type: "classic" as const,
          projected_points: 22.8,
          floor: null,
          ceiling: null,
          salary: null,
          value: null
        },
        simulation_summary: null,
        blocked: { is_blocked: false, blocked_reason: null }
      }
    }
  ],
  note: null
} as unknown as PlayerBoardPayload;

const dfsEdge = {
  source: "mlb-statsapi-live+draftkings-classic",
  mode: "dfs-edge-board-v1" as const,
  date: "2026-04-06",
  generated_at: asISOTimestamp("2026-04-06T11:47:00Z"),
  draftkings_classic: {
    platform: "draftkings" as const,
    contest_type: "classic" as const,
    draft_group_id: "145020",
    label: "Featured DraftKings Classic",
    min_start_time: "2026-04-06T23:40:00Z" as never,
    max_start_time: "2026-04-07T02:15:00Z" as never,
    tags: ["Featured"]
  },
  summary: {
    total_players: 1,
    ready_players: 1,
    held_players: 0,
    ready_pitchers: 1,
    ready_batters: 0,
    games_covered: 1,
    average_ready_salary: 10200,
    average_ready_value: 2.23,
    top_value_player: {
      player_id: "gerrit-cole" as never,
      full_name: "Gerrit Cole",
      team_abbreviation: "NYY",
      position: "P" as const,
      projected_points: 22.8,
      salary: 10200,
      value: 2.23
    }
  },
  counts: {
    ...schedule.counts,
    salary_entries: 1,
    matched_salaries: 1
  },
  ready_pitchers: [
    {
      ...playerBoard.players[0],
      draftkings_classic: {
        platform: "draftkings" as const,
        contest_type: "classic" as const,
        draft_group_id: "145020",
        draftable_id: "42538654",
        salary: 10200,
        value: 2.23,
        projected_ownership: 0.334,
        ownership_source: "placeholder" as const,
        blocked: { is_blocked: false, blocked_reason: null }
      }
    }
  ],
  ready_batters: [],
  held_players: [],
  note: null
} as unknown as DfsEdgeBoardPayload;

const bettingEdge = {
  source: "mlb-statsapi-live+draftkings-sportsbook-moneyline",
  mode: "betting-edge-board-v1" as const,
  date: "2026-04-06",
  generated_at: asISOTimestamp("2026-04-06T11:48:00Z"),
  draftkings_sportsbook_moneyline: {
    provider: "draftkings-sportsbook" as const,
    sport: "MLB" as const,
    market_type: "moneyline" as const,
    site: "US-TN-SB" as const,
    label: "DraftKings Sportsbook MLB Pregame Moneyline"
  },
  summary: {
    total_games: 1,
    ready_games: 1,
    held_games: 0,
    average_ready_edge: 0.05,
    top_edge_side: {
      game_id: "mlb-2026-04-06-nyy-bos" as never,
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
    ...schedule.counts,
    moneyline_entries: 1,
    matched_markets: 1
  },
  ready_games: [],
  held_games: [],
  note: null
} as unknown as BettingEdgeBoardPayload;

const liveScoreboard = {
  source: "mlb-statsapi-live",
  mode: "live-scoreboard-v1" as const,
  date: "2026-04-06",
  generated_at: asISOTimestamp("2026-04-06T11:48:00Z"),
  summary: {
    total_games: 1,
    live_games: 1,
    final_games: 0,
    pregame_games: 0,
    blocked_games: 0
  },
  counts: schedule.counts,
  games: [],
  note: null
} as unknown as LiveScoreboardPayload;

describe("buildSmokeSignal", () => {
  it("builds a typed highlight board from canonical section payloads", () => {
    const payload = buildSmokeSignal({
      source: "mlb-statsapi-live",
      date: "2026-04-06",
      generated_at: "2026-04-06T11:49:00Z",
      schedule,
      player_projections: playerBoard,
      dfs_edge: dfsEdge,
      betting_edge: bettingEdge,
      live_scoreboard: liveScoreboard
    });

    expect(payload.mode).toBe("smoke-signal-v1");
    expect(payload.summary.total_sections_considered).toBe(5);
    expect(payload.summary.ready_signals).toBe(5);
    expect(payload.summary.blocked_signals).toBe(0);
    expect(payload.top_projected_total_game?.projected_total).toBe(8.5);
    expect(payload.top_projected_player?.full_name).toBe("Gerrit Cole");
    expect(payload.top_dfs_value_player?.draft_group_id).toBe("145020");
    expect(payload.top_dfs_value_player?.projected_ownership).toBe(0.334);
    expect(payload.top_betting_edge_side?.edge).toBe(0.05);
    expect(payload.live_pulse?.live_games).toBe(1);
    expect(payload.note).toBeNull();
  });

  it("marks missing canonical highlight slots explicitly in the note", () => {
    const payload = buildSmokeSignal({
      source: "mlb-statsapi-live",
      date: "2026-04-06",
      schedule,
      player_projections: playerBoard,
      dfs_edge: null,
      betting_edge: null,
      live_scoreboard: null
    });

    expect(payload.summary.ready_signals).toBe(2);
    expect(payload.summary.blocked_signals).toBe(3);
    expect(payload.top_dfs_value_player).toBeNull();
    expect(payload.top_betting_edge_side).toBeNull();
    expect(payload.live_pulse).toBeNull();
    expect(payload.note).toContain("top_dfs_value_player");
    expect(payload.note).toContain("top_betting_edge_side");
    expect(payload.note).toContain("live_pulse");
  });
});
