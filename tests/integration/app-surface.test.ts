import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  DASHBOARD_TABS,
  formatStatusRailBadge,
  formatStatusRailMatchup,
  formatStatusRailPrimaryMeta,
  MlbDashboardShell
} from "@/app/mlb-dashboard-shell";
import {
  formatAmericanOdds,
  formatBettingEdgePercent,
  formatBettingEdgeStatus,
  parseBettingEdgeBoardPayload
} from "@/lib/betting-edge-board";
import {
  formatDfsEdgeStatus,
  formatDraftKingsClassicSalary,
  formatDraftKingsClassicValue,
  parseDfsEdgeBoardPayload
} from "@/lib/dfs-edge-board";
import {
  formatPlayerProjectedPoints,
  formatPlayerProjectionStatus,
  parsePlayerBoardPayload
} from "@/lib/player-board";
import {
  getSlateSnapshotBlockedSections,
  parseSlateSnapshotPayload
} from "@/lib/slate-snapshot";
import {
  formatGeneratedStamp,
  formatInputCoverageLabel,
  formatScheduledStart,
  formatWeatherLine,
  parseScheduleBoardPayload
} from "@/lib/schedule-board";

const sampleScheduleBoardPayload = {
  source: "mlb-statsapi-live",
  mode: "schedule-board-v1" as const,
  date: "2026-04-06",
  generated_at: "2026-04-06T11:45:00Z",
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
  note: null,
  games: [
    {
      game_id: "mlb-2026-04-06-nyy-bos",
      scheduled_start: "2026-04-06T23:40:00Z",
      status: "scheduled",
      venue_name: "Fenway Park",
      away_team: {
        team_id: "nyy",
        abbreviation: "NYY",
        full_name: "New York Yankees",
        probable_pitcher: {
          player_id: "gerrit-cole",
          full_name: "Gerrit Cole",
          handedness: "R",
          starting_status: "probable"
        },
        lineup_batters_available: 9
      },
      home_team: {
        team_id: "bos",
        abbreviation: "BOS",
        full_name: "Boston Red Sox",
        probable_pitcher: {
          player_id: "chris-sale",
          full_name: "Chris Sale",
          handedness: "L",
          starting_status: "probable"
        },
        lineup_batters_available: 9
      },
      has_both_starters: true,
      has_both_lineups: true,
      completeness_score: 0.95,
      player_projection_status: "ready",
      projection: {
        blocked: {
          is_blocked: false,
          blocked_reason: null
        },
        projected_away_runs: 4.6,
        projected_home_runs: 3.9,
        projected_total: 8.5,
        away_win_probability: 0.57,
        home_win_probability: 0.43,
        average_total_runs: 8.4
      },
      weather: {
        temperature_f: 68,
        wind_speed_mph: 12,
        wind_direction: "Out to CF",
        conditions: "Partly Cloudy",
        precipitation_chance: 0.1,
        dome_closed: null
      }
    },
    {
      game_id: "mlb-2026-04-06-atl-phi",
      scheduled_start: "2026-04-07T00:15:00Z",
      status: "pregame",
      venue_name: "Citizens Bank Park",
      away_team: {
        team_id: "atl",
        abbreviation: "ATL",
        full_name: "Atlanta Braves",
        probable_pitcher: null,
        lineup_batters_available: 6
      },
      home_team: {
        team_id: "phi",
        abbreviation: "PHI",
        full_name: "Philadelphia Phillies",
        probable_pitcher: null,
        lineup_batters_available: 5
      },
      has_both_starters: false,
      has_both_lineups: false,
      completeness_score: 0.52,
      player_projection_status: "held",
      projection: {
        blocked: {
          is_blocked: true,
          blocked_reason: "Missing away_starter preparation data"
        },
        projected_away_runs: null,
        projected_home_runs: null,
        projected_total: null,
        away_win_probability: null,
        home_win_probability: null,
        average_total_runs: null
      },
      weather: null
    }
  ]
};

const samplePlayerBoardPayload = {
  source: "mlb-statsapi-live",
  mode: "player-board-v1" as const,
  date: "2026-04-06",
  generated_at: "2026-04-06T11:45:00Z",
  summary: {
    total_players: 3,
    projected_players: 2,
    blocked_players: 1,
    pitchers: 1,
    batters: 2,
    games_covered: 2
  },
  counts: {
    fetched_raw: 2,
    parsed: 2,
    normalized: 2,
    prepared: 2,
    boxscore_enriched: 1
  },
  note: null,
  players: [
    {
      player_id: "gerrit-cole",
      full_name: "Gerrit Cole",
      position: "P",
      batting_order: null,
      team_side: "away" as const,
      team_id: "nyy",
      team_abbreviation: "NYY",
      team_full_name: "New York Yankees",
      opponent_team_id: "bos",
      opponent_team_abbreviation: "BOS",
      opponent_team_full_name: "Boston Red Sox",
      game_id: "mlb-2026-04-06-nyy-bos",
      matchup: "New York Yankees at Boston Red Sox",
      scheduled_start: "2026-04-06T23:40:00Z",
      status: "scheduled" as const,
      venue_name: "Fenway Park",
      projection: {
        deterministic_summary: {
          kind: "pitcher" as const,
          projected_ip: 6.2,
          projected_k: 7.4,
          projected_er: 2.5,
          projected_hits: 5.8,
          projected_bb: 1.7
        },
        fantasy_summary: {
          platform: "draftkings" as const,
          contest_type: "classic" as const,
          projected_points: 22.8,
          floor: null,
          ceiling: null,
          salary: null,
          value: null
        },
        simulation_summary: {
          derived_from: "simulation" as const,
          mean_points: 22.2,
          simulated_floor: 16.1,
          simulated_ceiling: 29.4
        },
        blocked: {
          is_blocked: false,
          blocked_reason: null
        }
      }
    },
    {
      player_id: "aaron-judge",
      full_name: "Aaron Judge",
      position: "RF",
      batting_order: 2,
      team_side: "away" as const,
      team_id: "nyy",
      team_abbreviation: "NYY",
      team_full_name: "New York Yankees",
      opponent_team_id: "bos",
      opponent_team_abbreviation: "BOS",
      opponent_team_full_name: "Boston Red Sox",
      game_id: "mlb-2026-04-06-nyy-bos",
      matchup: "New York Yankees at Boston Red Sox",
      scheduled_start: "2026-04-06T23:40:00Z",
      status: "scheduled" as const,
      venue_name: "Fenway Park",
      projection: {
        deterministic_summary: {
          kind: "batter" as const,
          projected_pa: 4.5,
          projected_ab: 4.0,
          projected_hits: 1.4,
          projected_hr: 0.4,
          projected_rbi: 1.0,
          projected_runs: 0.9,
          projected_sb: 0.1
        },
        fantasy_summary: {
          platform: "draftkings" as const,
          contest_type: "classic" as const,
          projected_points: 12.7,
          floor: null,
          ceiling: null,
          salary: null,
          value: null
        },
        simulation_summary: {
          derived_from: "simulation" as const,
          mean_points: 12.3,
          simulated_floor: 7.4,
          simulated_ceiling: 19.8
        },
        blocked: {
          is_blocked: false,
          blocked_reason: null
        }
      }
    },
    {
      player_id: "nick-castellanos",
      full_name: "Nick Castellanos",
      position: "RF",
      batting_order: 4,
      team_side: "home" as const,
      team_id: "phi",
      team_abbreviation: "PHI",
      team_full_name: "Philadelphia Phillies",
      opponent_team_id: "atl",
      opponent_team_abbreviation: "ATL",
      opponent_team_full_name: "Atlanta Braves",
      game_id: "mlb-2026-04-06-atl-phi",
      matchup: "Atlanta Braves at Philadelphia Phillies",
      scheduled_start: "2026-04-07T00:15:00Z",
      status: "pregame" as const,
      venue_name: "Citizens Bank Park",
      projection: {
        deterministic_summary: null,
        fantasy_summary: null,
        simulation_summary: null,
        blocked: {
          is_blocked: true,
          blocked_reason: "Missing away_starter preparation data"
        }
      }
    }
  ]
};

const buildSampleDfsEdgeBoardPayload = () => ({
  source: "mlb-statsapi-live+draftkings-classic",
  mode: "dfs-edge-board-v1" as const,
  date: "2026-04-06",
  generated_at: "2026-04-06T11:47:00Z",
  draftkings_classic: {
    platform: "draftkings" as const,
    contest_type: "classic" as const,
    draft_group_id: "145020",
    label: "Featured DraftKings Classic",
    min_start_time: "2026-04-06T23:40:00Z",
    max_start_time: "2026-04-07T02:15:00Z",
    tags: ["Featured"]
  },
  summary: {
    total_players: 3,
    ready_players: 2,
    held_players: 1,
    ready_pitchers: 1,
    ready_batters: 1,
    games_covered: 2,
    average_ready_salary: 7900,
    average_ready_value: 2.255,
    top_value_player: {
      player_id: "aaron-judge",
      full_name: "Aaron Judge",
      team_abbreviation: "NYY",
      position: "RF" as const,
      projected_points: 12.7,
      salary: 5600,
      value: 2.267857142857143
    }
  },
  counts: {
    fetched_raw: 2,
    parsed: 2,
    normalized: 2,
    prepared: 2,
    boxscore_enriched: 1,
    salary_entries: 2,
    matched_salaries: 2
  },
  ready_pitchers: [
    {
      ...samplePlayerBoardPayload.players[0],
      draftkings_classic: {
        platform: "draftkings" as const,
        contest_type: "classic" as const,
        draft_group_id: "145020",
        draftable_id: "42538654",
        salary: 10200,
        value: 2.235294117647059,
        projected_ownership: 0.334,
        ownership_source: "placeholder" as const,
        blocked: {
          is_blocked: false,
          blocked_reason: null
        }
      }
    }
  ],
  ready_batters: [
    {
      ...samplePlayerBoardPayload.players[1],
      draftkings_classic: {
        platform: "draftkings" as const,
        contest_type: "classic" as const,
        draft_group_id: "145020",
        draftable_id: "42538655",
        salary: 5600,
        value: 2.267857142857143,
        projected_ownership: 0.305,
        ownership_source: "placeholder" as const,
        blocked: {
          is_blocked: false,
          blocked_reason: null
        }
      }
    }
  ],
  held_players: [
    {
      ...samplePlayerBoardPayload.players[2],
      draftkings_classic: {
        platform: "draftkings" as const,
        contest_type: "classic" as const,
        draft_group_id: "145020",
        draftable_id: null,
        salary: null,
        value: null,
        projected_ownership: null,
        ownership_source: "placeholder" as const,
        blocked: {
          is_blocked: true,
          blocked_reason: "DraftKings Classic salary missing for reconciled player row"
        }
      }
    }
  ],
  note: null
});

const buildSampleBettingEdgeBoardPayload = () => ({
  source: "mlb-statsapi-live+draftkings-sportsbook-moneyline",
  mode: "betting-edge-board-v1" as const,
  date: "2026-04-06",
  generated_at: "2026-04-06T11:48:00Z",
  draftkings_sportsbook_moneyline: {
    provider: "draftkings-sportsbook" as const,
    sport: "MLB" as const,
    market_type: "moneyline" as const,
    site: "US-TN-SB" as const,
    label: "DraftKings Sportsbook MLB Pregame Moneyline"
  },
  summary: {
    total_games: 2,
    ready_games: 1,
    held_games: 1,
    average_ready_edge: 0.05,
    top_edge_side: {
      game_id: "mlb-2026-04-06-nyy-bos",
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
    fetched_raw: 2,
    parsed: 2,
    normalized: 2,
    prepared: 2,
    boxscore_enriched: 1,
    moneyline_entries: 1,
    matched_markets: 1
  },
  ready_games: [
    {
      game_id: "mlb-2026-04-06-nyy-bos",
      matchup: "New York Yankees at Boston Red Sox",
      scheduled_start: "2026-04-06T23:40:00Z",
      status: "scheduled" as const,
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
        provider: "draftkings-sportsbook" as const,
        sport: "MLB" as const,
        market_type: "moneyline" as const,
        event_id: "33937444",
        market_id: "1_84191347",
        away_odds_american: 110,
        home_odds_american: -130,
        away: {
          team_side: "away" as const,
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
          team_side: "home" as const,
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
  held_games: [
    {
      game_id: "mlb-2026-04-06-atl-phi",
      matchup: "Atlanta Braves at Philadelphia Phillies",
      scheduled_start: "2026-04-07T00:15:00Z",
      status: "pregame" as const,
      venue_name: "Citizens Bank Park",
      away_team_abbreviation: "ATL",
      away_team_full_name: "Atlanta Braves",
      home_team_abbreviation: "PHI",
      home_team_full_name: "Philadelphia Phillies",
      projection: {
        blocked: {
          is_blocked: false,
          blocked_reason: null
        },
        projected_away_runs: 4.3,
        projected_home_runs: 4.1,
        projected_total: 8.4,
        away_win_probability: 0.52,
        home_win_probability: 0.48
      },
      draftkings_sportsbook_moneyline: {
        provider: "draftkings-sportsbook" as const,
        sport: "MLB" as const,
        market_type: "moneyline" as const,
        event_id: null,
        market_id: null,
        away_odds_american: null,
        home_odds_american: null,
        away: {
          team_side: "away" as const,
          team_abbreviation: "ATL",
          team_full_name: "Atlanta Braves",
          market_odds_american: null,
          model_probability: null,
          market_implied_probability: null,
          market_no_vig_probability: null,
          edge: null,
          fair_american_odds: null
        },
        home: {
          team_side: "home" as const,
          team_abbreviation: "PHI",
          team_full_name: "Philadelphia Phillies",
          market_odds_american: null,
          model_probability: null,
          market_implied_probability: null,
          market_no_vig_probability: null,
          edge: null,
          fair_american_odds: null
        },
        blocked: {
          is_blocked: true,
          blocked_reason: "DraftKings Sportsbook moneyline missing for projected game row"
        }
      }
    }
  ],
  note: null
});

const buildSampleLiveScoreboardPayload = () => ({
  source: "mlb-statsapi-live",
  mode: "live-scoreboard-v1" as const,
  date: "2026-04-06",
  generated_at: "2026-04-06T11:48:00Z",
  summary: {
    total_games: 2,
    live_games: 1,
    final_games: 0,
    pregame_games: 1,
    blocked_games: 0
  },
  counts: sampleScheduleBoardPayload.counts,
  games: [
    {
      game_id: "mlb-2026-04-06-nyy-bos",
      matchup: "New York Yankees at Boston Red Sox",
      scheduled_start: "2026-04-06T23:40:00Z",
      status: "in_progress" as const,
      venue_name: "Fenway Park",
      away_team_id: "nyy",
      away_team_abbreviation: "NYY",
      away_team_full_name: "New York Yankees",
      home_team_id: "bos",
      home_team_abbreviation: "BOS",
      home_team_full_name: "Boston Red Sox",
      away_score: 4,
      home_score: 3,
      inning_number: 7,
      inning_state: "top" as const,
      is_live: true,
      is_final: false,
      display_state: "Top 7th",
      blocked: {
        is_blocked: false,
        blocked_reason: null
      }
    },
    {
      game_id: "mlb-2026-04-06-atl-phi",
      matchup: "Atlanta Braves at Philadelphia Phillies",
      scheduled_start: "2026-04-07T00:15:00Z",
      status: "pregame" as const,
      venue_name: "Citizens Bank Park",
      away_team_id: "atl",
      away_team_abbreviation: "ATL",
      away_team_full_name: "Atlanta Braves",
      home_team_id: "phi",
      home_team_abbreviation: "PHI",
      home_team_full_name: "Philadelphia Phillies",
      away_score: null,
      home_score: null,
      inning_number: null,
      inning_state: null,
      is_live: false,
      is_final: false,
      display_state: "Pre-Game",
      blocked: {
        is_blocked: false,
        blocked_reason: null
      }
    }
  ],
  note: null
});

const buildSampleSmokeSignalPayload = () => ({
  source: "mlb-statsapi-live",
  mode: "smoke-signal-v1" as const,
  date: "2026-04-06",
  generated_at: "2026-04-06T11:48:00Z",
  summary: {
    total_sections_considered: 5,
    ready_signals: 5,
    blocked_signals: 0
  },
  overview: {
    total_games: 2,
    projection_ready_games: 1,
    player_ready_games: 1,
    live_games: 1,
    blocked_games: 1
  },
  top_projected_total_game: {
    game_id: "mlb-2026-04-06-nyy-bos",
    matchup: "New York Yankees at Boston Red Sox",
    scheduled_start: "2026-04-06T23:40:00Z",
    status: "scheduled" as const,
    projected_total: 8.5,
    away_win_probability: 0.57,
    home_win_probability: 0.43,
    blocked: {
      is_blocked: false,
      blocked_reason: null
    }
  },
  top_projected_player: {
    player_id: "gerrit-cole",
    full_name: "Gerrit Cole",
    team_abbreviation: "NYY",
    position: "P" as const,
    game_id: "mlb-2026-04-06-nyy-bos",
    matchup: "New York Yankees at Boston Red Sox",
    projected_points: 22.8,
    blocked: {
      is_blocked: false,
      blocked_reason: null
    }
  },
  top_dfs_value_player: {
    player_id: "aaron-judge",
    full_name: "Aaron Judge",
    team_abbreviation: "NYY",
    position: "RF" as const,
    projected_points: 12.7,
    salary: 5600,
    value: 2.267857142857143,
    draft_group_id: "145020",
    projected_ownership: 0.305,
    ownership_source: "placeholder" as const
  },
  top_betting_edge_side: {
    game_id: "mlb-2026-04-06-nyy-bos",
    matchup: "New York Yankees at Boston Red Sox",
    team_abbreviation: "NYY",
    team_full_name: "New York Yankees",
    opponent_team_abbreviation: "BOS",
    market_odds_american: 110,
    fair_american_odds: -122,
    model_probability: 0.55,
    edge: 0.05
  },
  live_pulse: {
    total_games: 2,
    live_games: 1,
    final_games: 0,
    pregame_games: 1,
    blocked_games: 0
  },
  note: null
});

const sampleSlateSnapshotPayload = {
  source: "mlb-statsapi-live",
  mode: "slate-snapshot-v1" as const,
  version: 1 as const,
  date: "2026-04-06",
  generated_at: "2026-04-06T11:48:00Z",
  counts: sampleScheduleBoardPayload.counts,
  publication: {
    is_complete: true,
    blocked_sections: [] as const
  },
  degradation: {
    schedule: {
      state: "ready" as const,
      reason: null
    },
    player_projections: {
      state: "ready" as const,
      reason: null
    },
    dfs_edge: {
      state: "partial" as const,
      reason: null
    },
    betting_edge: {
      state: "partial" as const,
      reason: null
    },
    smoke_signal: {
      state: "ready" as const,
      reason: null
    },
    live_scoreboard: {
      state: "ready" as const,
      reason: null
    }
  },
  schedule: {
    status: {
      state: "ready" as const,
      reason: null
    },
    payload: sampleScheduleBoardPayload
  },
  player_projections: {
    status: {
      state: "ready" as const,
      reason: null
    },
    payload: samplePlayerBoardPayload
  },
  dfs_edge: {
    status: {
      state: "partial" as const,
      reason: null
    },
    payload: buildSampleDfsEdgeBoardPayload()
  },
  betting_edge: {
    status: {
      state: "partial" as const,
      reason: null
    },
    payload: buildSampleBettingEdgeBoardPayload()
  },
  smoke_signal: {
    status: {
      state: "ready" as const,
      reason: null
    },
    payload: buildSampleSmokeSignalPayload()
  },
  live_scoreboard: {
    status: {
      state: "ready" as const,
      reason: null
    },
    payload: buildSampleLiveScoreboardPayload()
  }
};

describe("app surface shell", () => {
  it("renders the branded shell with schedule-first navigation", () => {
    const html = renderToStaticMarkup(createElement(MlbDashboardShell));

    expect(html).toContain("MLB Projection Dashboard");
    expect(html).toContain("Southern Smokey Studio");
    expect(html).toContain("Loading today&#x27;s board");

    for (const tab of DASHBOARD_TABS) {
      expect(html).toContain(tab.label);
    }
  });

  it("parses the schedule board payload into the schedule surface model", () => {
    const payload = parseScheduleBoardPayload(sampleScheduleBoardPayload);

    expect(payload.source).toBe("mlb-statsapi-live");
    expect(payload.games).toHaveLength(2);
    expect(payload.summary.total_games).toBe(2);
    expect(payload.summary.projection_ready_games).toBe(1);
    expect(payload.summary.games_ready_for_player_projections).toBe(1);
    expect(payload.summary.blocked_games).toBe(1);
    expect(payload.games[0]?.projection.projected_total).toBe(8.5);
    expect(payload.games[0]?.player_projection_status).toBe("ready");
    expect(payload.games[1]?.projection.blocked.is_blocked).toBe(true);

    // Weather field parses correctly for a game with weather
    expect(payload.games[0]?.weather?.temperature_f).toBe(68);
    expect(payload.games[0]?.weather?.conditions).toBe("Partly Cloudy");
    expect(payload.games[0]?.weather?.wind_direction).toBe("Out to CF");

    // Weather is null for a game without weather
    expect(payload.games[1]?.weather).toBeNull();
  });

  it("parses the player board payload into the player surface model", () => {
    const payload = parsePlayerBoardPayload(samplePlayerBoardPayload);

    expect(payload.source).toBe("mlb-statsapi-live");
    expect(payload.summary.total_players).toBe(3);
    expect(payload.summary.projected_players).toBe(2);
    expect(payload.summary.blocked_players).toBe(1);
    expect(payload.players[0]?.full_name).toBe("Gerrit Cole");
    expect(payload.players[2]?.projection.blocked.is_blocked).toBe(true);
    expect(formatPlayerProjectedPoints(payload.players[0]!)).toBe("22.8");
    expect(formatPlayerProjectionStatus(payload.players[2]!)).toBe("Held");
  });

  it("parses the DFS edge payload into the DraftKings Classic surface model", () => {
    const payload = parseDfsEdgeBoardPayload(buildSampleDfsEdgeBoardPayload());

    expect(payload.source).toBe("mlb-statsapi-live+draftkings-classic");
    expect(payload.draftkings_classic?.contest_type).toBe("classic");
    expect(payload.summary.ready_players).toBe(2);
    expect(payload.summary.held_players).toBe(1);
    expect(payload.ready_pitchers).toHaveLength(1);
    expect(payload.ready_batters).toHaveLength(1);
    expect(payload.held_players).toHaveLength(1);
    expect(payload.ready_pitchers[0]?.draftkings_classic.ownership_source).toBe("placeholder");
    expect(payload.ready_batters[0]?.draftkings_classic.projected_ownership).toBe(0.305);
    expect(payload.held_players[0]?.draftkings_classic.projected_ownership).toBeNull();
    expect(formatDfsEdgeStatus(payload.ready_pitchers[0]!)).toBe("DraftKings-ready");
    expect(formatDfsEdgeStatus(payload.held_players[0]!)).toBe("Held");
    expect(formatDraftKingsClassicSalary(payload.ready_pitchers[0]!.draftkings_classic.salary)).toBe("$10,200");
    expect(formatDraftKingsClassicValue(payload.ready_batters[0]!.draftkings_classic.value)).toBe("2.27 pts/$1k");
  });

  it("parses the betting edge payload into the DraftKings Sportsbook surface model", () => {
    const payload = parseBettingEdgeBoardPayload(buildSampleBettingEdgeBoardPayload());

    expect(payload.source).toBe("mlb-statsapi-live+draftkings-sportsbook-moneyline");
    expect(payload.draftkings_sportsbook_moneyline?.market_type).toBe("moneyline");
    expect(payload.summary.ready_games).toBe(1);
    expect(payload.summary.held_games).toBe(1);
    expect(payload.ready_games).toHaveLength(1);
    expect(payload.held_games).toHaveLength(1);
    expect(formatBettingEdgeStatus(payload.ready_games[0]!)).toBe("Moneyline-ready");
    expect(formatBettingEdgeStatus(payload.held_games[0]!)).toBe("Held");
    expect(formatAmericanOdds(payload.ready_games[0]!.draftkings_sportsbook_moneyline.away.market_odds_american)).toBe("+110");
    expect(formatBettingEdgePercent(payload.ready_games[0]!.draftkings_sportsbook_moneyline.away.edge)).toBe("+5.0% edge");
  });

  it("parses the canonical snapshot payload into wrapped board sections", () => {
    const snapshot = parseSlateSnapshotPayload(sampleSlateSnapshotPayload);

    expect(snapshot.mode).toBe("slate-snapshot-v1");
    expect(snapshot.schedule.payload?.mode).toBe("schedule-board-v1");
    expect(snapshot.player_projections.payload?.mode).toBe("player-board-v1");
    expect(snapshot.dfs_edge.payload?.mode).toBe("dfs-edge-board-v1");
    expect(snapshot.betting_edge.payload?.mode).toBe("betting-edge-board-v1");
    expect(snapshot.smoke_signal.payload?.mode).toBe("smoke-signal-v1");
    expect(snapshot.live_scoreboard.payload?.mode).toBe("live-scoreboard-v1");
    expect(snapshot.smoke_signal.status.state).toBe("ready");
    expect(snapshot.smoke_signal.payload?.top_dfs_value_player?.ownership_source).toBe("placeholder");
    expect(snapshot.live_scoreboard.status.state).toBe("ready");
    expect(snapshot.live_scoreboard.payload?.games[0]?.display_state).toBe("Top 7th");
    expect(getSlateSnapshotBlockedSections(snapshot)).toEqual([]);
  });

  it("formats left-rail live-scoreboard rows without inventing score state", () => {
    const liveScoreboard = parseSlateSnapshotPayload(sampleSlateSnapshotPayload).live_scoreboard.payload!;
    const liveGame = liveScoreboard.games[0]!;
    const scheduledGame = liveScoreboard.games[1]!;
    const blockedGame: typeof scheduledGame = {
      ...scheduledGame,
      status: "in_progress" as const,
      display_state: null,
      blocked: {
        is_blocked: true,
        blocked_reason: "Live score state is missing inning context for an in-progress game."
      }
    };

    expect(formatStatusRailMatchup(liveGame)).toBe("NYY 4 at BOS 3");
    expect(formatStatusRailBadge(liveGame)).toBe("Top 7th");
    expect(formatStatusRailPrimaryMeta(liveGame)).toBe("Top 7th");

    expect(formatStatusRailMatchup(scheduledGame)).toBe("ATL at PHI");
    expect(formatStatusRailBadge(scheduledGame)).toBe("Pregame");
    expect(formatStatusRailPrimaryMeta(scheduledGame)).toContain("CT");

    expect(formatStatusRailBadge(blockedGame)).toBe("Score blocked");
    expect(formatStatusRailPrimaryMeta(blockedGame)).toContain("missing inning context");

    // KC @ NYY regression: a final game with unavailable score data must show
    // "Final" in the badge, not "Score blocked".  Before the fix in
    // buildBlockedState, any final game with null scores was marked is_blocked
    // which made the ribbon badge read "Score blocked" for a completed game.
    const finalKcNyy: typeof scheduledGame = {
      ...scheduledGame,
      game_id: "mlb-2026-04-19-kc-nyy" as typeof scheduledGame.game_id,
      status: "final" as const,
      away_team_abbreviation: "KC",
      home_team_abbreviation: "NYY",
      away_score: null,
      home_score: null,
      is_live: false,
      is_final: true,
      display_state: "Final",
      blocked: {
        is_blocked: false,
        blocked_reason: null
      }
    };

    expect(formatStatusRailMatchup(finalKcNyy)).toBe("KC at NYY");
    expect(formatStatusRailBadge(finalKcNyy)).toBe("Final");
    expect(formatStatusRailPrimaryMeta(finalKcNyy)).toBe("Final");
  });

  it("keeps the shell formatting helpers honest", () => {
    expect(buildSampleSmokeSignalPayload().top_projected_total_game?.projected_total).toBe(8.5);
    expect(buildSampleSmokeSignalPayload().top_projected_player?.projected_points).toBe(22.8);
    expect(buildSampleSmokeSignalPayload().top_dfs_value_player?.ownership_source).toBe("placeholder");
    expect(formatGeneratedStamp("2026-04-04T12:00:00Z")).toBe("APR 04 | 12:00 UTC");
    expect(formatScheduledStart("2026-04-06T23:40:00Z")).toContain("CT");
  });

  it("lineup coverage label uses human-readable wording", () => {
    const payload = parseScheduleBoardPayload(sampleScheduleBoardPayload);

    // Both teams have 9 batters — should say "Full lineups set"
    expect(formatInputCoverageLabel(payload.games[0]!)).toBe("Full lineups set");

    // Away=6, home=5 — should be partial wording
    const partial = formatInputCoverageLabel(payload.games[1]!);
    expect(partial).toContain("partial");
    expect(partial).toContain("away 6/9");
    expect(partial).toContain("home 5/9");
  });

  it("weather format helper produces a display string when weather is present", () => {
    const payload = parseScheduleBoardPayload(sampleScheduleBoardPayload);

    const weatherLine = formatWeatherLine(payload.games[0]!);
    expect(weatherLine).not.toBeNull();
    expect(weatherLine).toContain("68°F");
    expect(weatherLine).toContain("Partly Cloudy");
    expect(weatherLine).toContain("12 mph");

    // No weather → null
    expect(formatWeatherLine(payload.games[1]!)).toBeNull();
  });
});
