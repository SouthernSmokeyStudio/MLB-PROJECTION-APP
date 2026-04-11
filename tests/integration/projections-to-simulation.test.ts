import { describe, expect, it } from "vitest";
import preparedFixture from "../../data/fixtures/sample-prepared-game.json";
import invalidPreparedFixture from "../../data/fixtures/sample-prepared-game-invalid.json";
import type {
  PreparedBatterInputs,
  PreparedGameInputs,
  PreparedPitcherInputs,
  PreparedTeamInputs
} from "../../lib/contracts/prepared";
import {
  asGameId,
  asISOTimestamp,
  asPlayerId,
  asTeamId
} from "../../lib/contracts/types";
import { assembleGameProjection } from "../../lib/projections/assembleGameProjection";
import { projectFantasyPoints } from "../../lib/scoring/projectFantasyPoints";
import { simulateFantasy } from "../../lib/simulation/simulateFantasy";
import { simulateGames } from "../../lib/simulation/simulateGames";

const prepared = preparedFixture as unknown as PreparedGameInputs;
const invalidPrepared = invalidPreparedFixture as unknown as PreparedGameInputs;

// ---------------------------------------------------------------------------
// BF-002 helpers
// ---------------------------------------------------------------------------

const makeTeam = (id: string): PreparedTeamInputs => ({
  team_id: asTeamId(id),
  team_woba: 0.32,
  team_runs_per_game: 4.6,
  team_k_rate: 0.22,
  team_bb_rate: 0.085,
  team_era: 4.0,
  team_whip: 1.25,
  bullpen_era: 4.1,
  lineup_batters_available: 9,
  lineup_avg_woba: null
});

const makePitcher = (id: string, teamId: string): PreparedPitcherInputs => ({
  player_id: asPlayerId(id),
  mlb_stats_api_id: id,
  team_id: asTeamId(teamId),
  handedness: "R",
  season_ip: 150,
  season_era: 3.5,
  season_whip: 1.15,
  season_k_per_9: 9.0,
  season_bb_per_9: 3.0,
  season_hr_per_9: 1.0,
  recent_starts_n: 5,
  recent_era: 3.2,
  recent_k_per_9: 9.5,
  recent_ip_per_start: 6.0,
  vs_lhb_era: null,
  vs_rhb_era: null,
  days_rest: 5,
  last_start_pitches: 95
});

const makeCompleteBatter = (
  id: string,
  teamId: string,
  slot: number
): PreparedBatterInputs => ({
  player_id: asPlayerId(id),
  mlb_stats_api_id: null,
  team_id: asTeamId(teamId),
  batting_order: slot,
  handedness: "R",
  season_pa: 500,
  season_avg: 0.270,
  season_obp: 0.340,
  season_slg: 0.450,
  season_woba: null,
  season_iso: 0.18,
  season_k_rate: 0.20,
  season_bb_rate: 0.09,
  season_hr_rate: 0.04,
  season_sb: 10,
  recent_games_n: null,
  recent_woba: null,
  recent_avg: null,
  vs_lhp_woba: null,
  vs_rhp_woba: null
});

const makeFullLineup = (teamId: string): PreparedBatterInputs[] =>
  Array.from({ length: 9 }, (_, i) =>
    makeCompleteBatter(`${teamId}-batter-${i + 1}`, teamId, i + 1)
  );

const makeSyntheticInputs = (overrides: Partial<PreparedGameInputs> = {}): PreparedGameInputs => ({
  game_id: asGameId("test-game-1"),
  sport_id: "MLB",
  scheduled_start: asISOTimestamp("2026-04-01T19:00:00Z"),
  prepared_at: asISOTimestamp("2026-04-01T15:00:00Z"),
  venue: { park_factor_runs: 1.0, is_dome: false, is_retractable_roof: false },
  weather: {
    temperature_f: 72,
    wind_speed_mph: 5,
    wind_direction_normalized: "out",
    is_enclosed: false
  },
  away_team: makeTeam("team-away"),
  home_team: makeTeam("team-home"),
  away_starter: makePitcher("pitcher-away", "team-away"),
  home_starter: makePitcher("pitcher-home", "team-home"),
  away_batters: makeFullLineup("team-away"),
  home_batters: makeFullLineup("team-home"),
  blocked: { is_blocked: false, blocked_reason: null },
  team_level_ready: true,
  has_both_starters: true,
  has_both_lineups: true,
  completeness_score: 1.0,
  ...overrides
});

describe("projections -> simulation integration", () => {
  it("produces stable game and fantasy simulations from valid upstream projections", () => {
    const assembled = assembleGameProjection(prepared) as any;
    const gameProjection = assembled.game_projection ?? assembled.game ?? assembled;
    const fantasyProjection = projectFantasyPoints(assembled);

    const gameSimulations = simulateGames(gameProjection, {
      seed: 20260328,
      iterations: 250
    });

    const fantasySimulations = simulateFantasy(fantasyProjection, {
      seed: 20260328,
      iterations: 250
    });

    expect(gameSimulations.blocked.is_blocked).toBe(false);
    expect(gameSimulations.samples).toHaveLength(250);
    expect(gameSimulations.average_total_runs).toBeGreaterThan(0);

    expect(fantasySimulations.blocked.is_blocked).toBe(false);
    expect(fantasySimulations.pitcher_summaries).toHaveLength(2);
    expect(fantasySimulations.batter_summaries).toHaveLength(18);
  });

  it("is deterministic for identical seeded simulation runs", () => {
    const assembled = assembleGameProjection(prepared) as any;
    const gameProjection = assembled.game_projection ?? assembled.game ?? assembled;
    const fantasyProjection = projectFantasyPoints(assembled);

    const firstGame = simulateGames(gameProjection, {
      seed: 17,
      iterations: 150
    });

    const secondGame = simulateGames(gameProjection, {
      seed: 17,
      iterations: 150
    });

    const firstFantasy = simulateFantasy(fantasyProjection, {
      seed: 17,
      iterations: 150
    });

    const secondFantasy = simulateFantasy(fantasyProjection, {
      seed: 17,
      iterations: 150
    });

    expect(firstGame).toStrictEqual(secondGame);
    expect(firstFantasy).toStrictEqual(secondFantasy);
  });

  it("propagates blocked upstream projections", () => {
    const assembled = assembleGameProjection(invalidPrepared) as any;
    const gameProjection = assembled.game_projection ?? assembled.game ?? assembled;
    const fantasyProjection = projectFantasyPoints(assembled);

    const blockedGame = simulateGames(gameProjection, {
      seed: 5,
      iterations: 100
    });

    const blockedFantasy = simulateFantasy(fantasyProjection, {
      seed: 5,
      iterations: 100
    });

    expect(blockedGame.blocked.is_blocked).toBe(true);
    expect(blockedFantasy.blocked.is_blocked).toBe(true);
    expect(blockedGame.samples).toHaveLength(0);
    expect(blockedFantasy.pitcher_summaries).toHaveLength(0);
    expect(blockedFantasy.batter_summaries).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// BF-002: partial batter completeness flows through to simulation
// ---------------------------------------------------------------------------

describe("BF-002 — projections -> simulation with partial batters", () => {
  it("simulates fantasy with partial batter lineup (16 batters instead of 18)", () => {
    const awayBatters = makeFullLineup("team-away");
    awayBatters[0] = { ...awayBatters[0]!, season_sb: null };
    awayBatters[4] = { ...awayBatters[4]!, season_hr_rate: null };

    const assembled = assembleGameProjection(makeSyntheticInputs({
      away_batters: awayBatters
    }));
    const fantasy = projectFantasyPoints(assembled);
    const simulated = simulateFantasy(fantasy, { seed: 42, iterations: 100 });

    expect(simulated.blocked.is_blocked).toBe(false);
    expect(simulated.pitcher_summaries).toHaveLength(2);
    expect(simulated.batter_summaries).toHaveLength(16); // 7 away + 9 home
  });

  it("propagates blocked simulation when both teams have zero projectable batters", () => {
    const awayBatters = makeFullLineup("team-away").map(b => ({
      ...b, season_avg: null
    }));
    const homeBatters = makeFullLineup("team-home").map(b => ({
      ...b, season_avg: null
    }));

    const assembled = assembleGameProjection(makeSyntheticInputs({
      away_batters: awayBatters,
      home_batters: homeBatters
    }));
    const fantasy = projectFantasyPoints(assembled);
    const simulated = simulateFantasy(fantasy, { seed: 42, iterations: 100 });

    expect(simulated.blocked.is_blocked).toBe(true);
    expect(simulated.batter_summaries).toHaveLength(0);
  });
});
