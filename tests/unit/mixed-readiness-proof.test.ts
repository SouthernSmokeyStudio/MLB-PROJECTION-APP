/**
 * mixed-readiness-proof.test.ts
 *
 * Proves the exact behavior of player, DFS, snapshot, and publication
 * surfaces under mixed readiness:  team_level_ready = true  but
 * batter arrays absent.
 *
 * Goal: verify that no downstream consumer sees misleading "ready" or
 * "projected" state for player/DFS paths that lack the actual data to
 * back that claim.
 */

import { describe, expect, it } from "vitest";
import rawFixture from "../../data/fixtures/sample-raw-game.json";
import preparedFixture from "../../data/fixtures/sample-prepared-game.json";
import { parseMlbStatsApiGamePayload } from "../../lib/adapters/mlbStatsApi";
import type { PreparedGameInputs, PreparedPitcherInputs, PreparedTeamInputs } from "../../lib/contracts/prepared";
import { asGameId, asISOTimestamp, asPlayerId, asTeamId } from "../../lib/contracts/types";
import { normalizeMlbStatsApiGame } from "../../lib/normalization/mlbStatsApiNormalizer";
import { buildGameCard } from "../../lib/services/buildGameCard";
import { buildPlayerCards } from "../../lib/services/buildPlayerCard";
import { buildPlayerBoard } from "../../lib/services/buildPlayerBoard";
import { buildScheduleBoard } from "../../lib/services/buildScheduleBoard";
import { buildSlateSnapshot } from "../../lib/services/buildSlateSnapshot";
import { checkProjectionReconciliation } from "../../lib/services/checkProjectionReconciliation";
import { projectFantasyPoints } from "../../lib/scoring/projectFantasyPoints";
import { assembleGameProjection } from "../../lib/projections/assembleGameProjection";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const fullGame = preparedFixture as unknown as PreparedGameInputs;

const makeTeam = (teamId: string): PreparedTeamInputs => ({
  team_id: asTeamId(teamId),
  team_woba: 0.32,
  team_runs_per_game: 4.6,
  team_k_rate: 0.22,
  team_bb_rate: 0.085,
  team_era: 4.0,
  team_whip: 1.25,
  bullpen_era: 4.1,
  lineup_batters_available: 0,
  lineup_avg_woba: null
});

const makePitcher = (playerId: string, teamId: string): PreparedPitcherInputs => ({
  player_id: asPlayerId(playerId),
  mlb_stats_api_id: null,
  team_id: asTeamId(teamId),
  handedness: "R",
  season_ip: 60,
  season_era: 3.8,
  season_whip: 1.2,
  season_k_per_9: 9.0,
  season_bb_per_9: 3.0,
  season_hr_per_9: 1.1,
  recent_starts_n: 3,
  recent_era: 3.5,
  recent_k_per_9: 9.5,
  recent_ip_per_start: 5.67,
  vs_lhb_era: null,
  vs_rhb_era: null,
  days_rest: 5,
  last_start_pitches: 95
});

/**
 * Mixed readiness: team_level_ready = true, both starters present,
 * team aggregate stats present, but ZERO batter arrays.
 * inputs.blocked.is_blocked = true (batters missing).
 */
const makeMixedReadinessInputs = (
  overrides: Partial<PreparedGameInputs> = {}
): PreparedGameInputs => ({
  game_id: asGameId("mlb-2026-04-10-nyy-bos"),
  sport_id: "MLB",
  scheduled_start: asISOTimestamp("2026-04-10T23:05:00Z"),
  prepared_at: asISOTimestamp("2026-04-10T15:00:00Z"),
  venue: { park_factor_runs: 1.04, is_dome: false, is_retractable_roof: false },
  weather: {
    temperature_f: 55,
    wind_speed_mph: 8,
    wind_direction_normalized: "out",
    is_enclosed: false
  },
  away_team: makeTeam("nyy"),
  home_team: makeTeam("bos"),
  away_starter: makePitcher("pitcher-away", "nyy"),
  home_starter: makePitcher("pitcher-home", "bos"),
  away_batters: [],
  home_batters: [],
  blocked: {
    is_blocked: true,
    blocked_reason: "Missing away_batters preparation data; Missing home_batters preparation data"
  },
  team_level_ready: true,
  has_both_starters: true,
  has_both_lineups: false,
  completeness_score: 0.67,
  ...overrides
});

// Helpers to construct route-level fixtures
const parsedRaw = parseMlbStatsApiGamePayload(rawFixture);
if (!parsedRaw.success) throw new Error("Fixture parse failed");
const normalizedRaw = normalizeMlbStatsApiGame(parsedRaw.data);
if (!normalizedRaw.success) throw new Error("Fixture normalize failed");

const makeMixedSourceGame = (overrides: Partial<PreparedGameInputs> = {}) => ({
  parsedGame: parsedRaw.data,
  canonicalGame: normalizedRaw.data,
  preparedGame: makeMixedReadinessInputs(overrides),
  playerIdentities: {
    "pitcher-away": {
      player_id: asPlayerId("pitcher-away"),
      full_name: "Away Starter",
      position: "P" as const,
      batting_order: null
    },
    "pitcher-home": {
      player_id: asPlayerId("pitcher-home"),
      full_name: "Home Starter",
      position: "P" as const,
      batting_order: null
    }
  },
  liveScoreState: {
    away_score: null,
    home_score: null,
    inning_number: null,
    inning_state: null,
    is_live: false,
    is_final: false,
    display_state: "Scheduled"
  }
});

const boardOptions = {
  source: "mlb-statsapi-live",
  date: "2026-04-10",
  generated_at: "2026-04-10T15:30:00Z",
  counts: {
    fetched_raw: 1,
    parsed: 1,
    normalized: 1,
    prepared: 1,
    boxscore_enriched: 1
  },
  simulation: { seed: 42, iterations: 100 }
};

// ---------------------------------------------------------------------------
// 1. Player board: honest blocked pitcher cards, no fake batter readiness
// ---------------------------------------------------------------------------

describe("1 — player board under mixed readiness", () => {
  const inputs = makeMixedReadinessInputs();

  it("assembleGameProjection metadata is blocked (batter-level reason propagates)", () => {
    const assembled = assembleGameProjection(inputs);
    expect(assembled.game_projection.metadata.blocked.is_blocked).toBe(true);
    expect(assembled.game_projection.metadata.blocked.blocked_reason).toContain(
      "Missing away_batters"
    );
  });

  it("projectFantasyPoints is blocked when metadata is blocked", () => {
    const assembled = assembleGameProjection(inputs);
    const fantasy = projectFantasyPoints(assembled as never);
    expect(fantasy.blocked.is_blocked).toBe(true);
    expect(fantasy.pitcher_fantasy_points).toHaveLength(0);
    expect(fantasy.batter_fantasy_points).toHaveLength(0);
  });

  it("buildPlayerCards emits exactly 2 pitcher cards, both honestly blocked", () => {
    const result = buildPlayerCards(inputs, { simulation: { seed: 42, iterations: 100 } });

    // Exactly 2 pitchers — no fake batter rows
    expect(result.players).toHaveLength(2);
    expect(result.players.every((p) => p.deterministic_summary?.kind === "pitcher")).toBe(true);

    // Top-level result is blocked
    expect(result.blocked.is_blocked).toBe(true);

    // Each card is individually blocked
    for (const card of result.players) {
      expect(card.blocked.is_blocked).toBe(true);
      expect(card.blocked.blocked_reason).toBeTruthy();
    }
  });

  it("pitcher cards have deterministic projections but NO fantasy summary", () => {
    const result = buildPlayerCards(inputs, { simulation: { seed: 42, iterations: 100 } });

    for (const card of result.players) {
      // Deterministic data is real (pitcher projection succeeded)
      expect(card.deterministic_summary).not.toBeNull();
      expect(card.deterministic_summary?.kind).toBe("pitcher");

      // Fantasy is null because projectFantasyPoints returned empty arrays
      expect(card.fantasy_summary).toBeNull();

      // Simulation is null because simulateFantasy was skipped (fantasy blocked)
      expect(card.simulation_summary).toBeNull();
    }
  });

  it("player board summary accurately reports 0 projected, 2 blocked", () => {
    const sourceGame = makeMixedSourceGame();
    const board = buildPlayerBoard([sourceGame], boardOptions);

    expect(board.summary.total_players).toBe(2);
    expect(board.summary.projected_players).toBe(0);
    expect(board.summary.blocked_players).toBe(2);
    expect(board.summary.pitchers).toBe(2);
    expect(board.summary.batters).toBe(0);
  });

  it("no player row claims projected status when the player is blocked", () => {
    const sourceGame = makeMixedSourceGame();
    const board = buildPlayerBoard([sourceGame], boardOptions);

    for (const row of board.players) {
      // Every row must have blocked = true
      expect(row.projection.blocked.is_blocked).toBe(true);
      // No fantasy points on blocked players
      expect(row.projection.fantasy_summary).toBeNull();
      // No simulation on blocked players
      expect(row.projection.simulation_summary).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Reconciliation + DFS gate under mixed readiness
// ---------------------------------------------------------------------------

describe("2 — DFS / reconciliation under mixed readiness", () => {
  const inputs = makeMixedReadinessInputs();

  it("game card is blocked (metadata-level) but simulation is NOT null", () => {
    const card = buildGameCard(inputs, { simulation: { seed: 42, iterations: 100 } });

    // Game card's blocked field reflects batter-level blocked from metadata
    expect(card.blocked.is_blocked).toBe(true);

    // But simulation ran (team_level_ready gate)
    expect(card.simulation).not.toBeNull();
    expect(card.simulation?.away_win_probability).toBeTypeOf("number");
  });

  it("reconciliation passes — all blocked flags are consistent", () => {
    const card = buildGameCard(inputs, { simulation: { seed: 42, iterations: 100 } });
    const players = buildPlayerCards(inputs, { simulation: { seed: 42, iterations: 100 } });

    const reconciliation = checkProjectionReconciliation({ game: card, players: players.players });

    expect(reconciliation.passed).toBe(true);
    expect(reconciliation.checks.blocked_state_consistency).toBe(true);
  });

  it("schedule board game is counted as blocked, player_projection_status is held", () => {
    const sourceGame = makeMixedSourceGame();
    const board = buildScheduleBoard([sourceGame], boardOptions);

    const game = board.games[0];
    expect(game).toBeDefined();

    // Game projection is blocked (metadata-level)
    expect(game!.projection.blocked.is_blocked).toBe(true);

    // Player projection status is explicitly "held" — not misleadingly "ready"
    expect(game!.player_projection_status).toBe("held");

    // But team-level projections still surface honest numbers
    expect(game!.projection.projected_total).toBeGreaterThan(0);
    expect(game!.projection.away_win_probability).toBeTypeOf("number");

    // Summary counts game as blocked
    expect(board.summary.blocked_games).toBe(1);
    expect(board.summary.projection_ready_games).toBe(0);
    expect(board.summary.games_ready_for_player_projections).toBe(0);
  });

  it("snapshot without DFS options produces blocked DFS section (no false DFS readiness)", () => {
    const sourceGame = makeMixedSourceGame();
    const snapshot = buildSlateSnapshot([sourceGame], {
      ...boardOptions,
      source: "mlb-statsapi-live"
    });

    // DFS section is blocked by default (no DK salary data provided)
    expect(snapshot.dfs_edge.status.state).toBe("blocked");

    // Betting section is also blocked by default
    expect(snapshot.betting_edge.status.state).toBe("blocked");
  });
});

// ---------------------------------------------------------------------------
// 3. Snapshot section statuses and publication honesty
// ---------------------------------------------------------------------------

describe("3 — snapshot section statuses under mixed readiness", () => {
  const sourceGame = makeMixedSourceGame();

  it("player_projections section is 'partial' when rows exist but none are projectable", () => {
    const snapshot = buildSlateSnapshot([sourceGame], {
      ...boardOptions,
      source: "mlb-statsapi-live"
    });

    // Section is "partial" — rows exist (2 blocked pitchers) but
    // projected_players is 0, so "ready" would be dishonest.
    expect(snapshot.player_projections.status.state).toBe("partial");
    expect(snapshot.player_projections.status.reason).toBeTruthy();

    // Payload itself is honest: 0 projected, 2 blocked
    const payload = snapshot.player_projections.payload;
    expect(payload).not.toBeNull();
    expect(payload!.summary.projected_players).toBe(0);
    expect(payload!.summary.blocked_players).toBe(2);
    expect(payload!.summary.batters).toBe(0);
  });

  it("schedule section is 'ready' — game exists even if blocked", () => {
    const snapshot = buildSlateSnapshot([sourceGame], {
      ...boardOptions,
      source: "mlb-statsapi-live"
    });

    expect(snapshot.schedule.status.state).toBe("ready");
    expect(snapshot.schedule.payload).not.toBeNull();
    expect(snapshot.schedule.payload!.summary.total_games).toBe(1);
    expect(snapshot.schedule.payload!.summary.blocked_games).toBe(1);
  });

  it("publication.is_complete is false because DFS and betting sections are blocked", () => {
    const snapshot = buildSlateSnapshot([sourceGame], {
      ...boardOptions,
      source: "mlb-statsapi-live"
    });

    expect(snapshot.publication.is_complete).toBe(false);
    expect(snapshot.publication.blocked_sections).toContain("dfs_edge");
    expect(snapshot.publication.blocked_sections).toContain("betting_edge");
  });

  it("degradation object is internally consistent", () => {
    const snapshot = buildSlateSnapshot([sourceGame], {
      ...boardOptions,
      source: "mlb-statsapi-live"
    });

    // Every section state is one of the valid enum values
    const validStates = new Set(["ready", "partial", "blocked", "empty"]);
    for (const [, status] of Object.entries(snapshot.degradation)) {
      expect(validStates.has(status.state)).toBe(true);
    }

    // blocked_sections exactly matches the sections with state === "blocked"
    const expectedBlocked = (
      Object.entries(snapshot.degradation) as Array<[string, { state: string }]>
    )
      .filter(([, status]) => status.state === "blocked")
      .map(([key]) => key);

    expect([...snapshot.publication.blocked_sections].sort()).toEqual(
      expectedBlocked.sort()
    );
  });
});

// ---------------------------------------------------------------------------
// 4. No-fake-readiness assertions
// ---------------------------------------------------------------------------

describe("4 — no fake readiness under mixed state", () => {
  const inputs = makeMixedReadinessInputs();

  it("no player card has fantasy_summary when fantasy scoring is blocked", () => {
    const result = buildPlayerCards(inputs, { simulation: { seed: 42, iterations: 100 } });

    const playersWithFantasy = result.players.filter((p) => p.fantasy_summary !== null);
    expect(playersWithFantasy).toHaveLength(0);
  });

  it("no player card has simulation_summary when fantasy simulation is blocked", () => {
    const result = buildPlayerCards(inputs, { simulation: { seed: 42, iterations: 100 } });

    const playersWithSim = result.players.filter((p) => p.simulation_summary !== null);
    expect(playersWithSim).toHaveLength(0);
  });

  it("no player card claims is_blocked = false under mixed readiness", () => {
    const result = buildPlayerCards(inputs, { simulation: { seed: 42, iterations: 100 } });

    const unblockedPlayers = result.players.filter((p) => !p.blocked.is_blocked);
    expect(unblockedPlayers).toHaveLength(0);
  });

  it("schedule board does not count a mixed-readiness game as projection_ready", () => {
    const sourceGame = makeMixedSourceGame();
    const board = buildScheduleBoard([sourceGame], boardOptions);

    expect(board.summary.projection_ready_games).toBe(0);
  });

  it("schedule board does not count a mixed-readiness game as ready for player projections", () => {
    const sourceGame = makeMixedSourceGame();
    const board = buildScheduleBoard([sourceGame], boardOptions);

    expect(board.summary.games_ready_for_player_projections).toBe(0);
  });

  it("player board projected_players is 0 — only blocked_players counted", () => {
    const sourceGame = makeMixedSourceGame();
    const board = buildPlayerBoard([sourceGame], boardOptions);

    expect(board.summary.projected_players).toBe(0);
    expect(board.summary.blocked_players).toBe(board.summary.total_players);
  });

  it("game card blocked field is true even though simulation ran", () => {
    const card = buildGameCard(inputs, { simulation: { seed: 42, iterations: 100 } });

    // The game card honestly reports blocked = true (batter-level)
    // while simultaneously surfacing team-level simulation results.
    // This is NOT contradictory — blocked means "not fully projectable"
    // while simulation reflects team-level-only projection.
    expect(card.blocked.is_blocked).toBe(true);
    expect(card.simulation).not.toBeNull();
  });

  it("full-data path regression: all player readiness fields are populated when batters present", () => {
    const result = buildPlayerCards(fullGame, { simulation: { seed: 42, iterations: 100 } });

    expect(result.blocked.is_blocked).toBe(false);
    expect(result.players.length).toBeGreaterThan(2); // batters + pitchers

    const projectedPlayers = result.players.filter((p) => !p.blocked.is_blocked);
    expect(projectedPlayers.length).toBeGreaterThan(0);

    const withFantasy = result.players.filter((p) => p.fantasy_summary !== null);
    expect(withFantasy.length).toBeGreaterThan(0);
  });
});
