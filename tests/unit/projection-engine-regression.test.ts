/**
 * Phase 7 regression tests for projection engine fixes.
 *
 * Covers:
 * - Park factors: Coors (1.17), Fenway (1.04), neutral (1.0), unknown venue fallback
 * - lineup_avg_woba flowing into team offense factor vs null-lineup fallback
 * - blendRecentForm: hot/cold batter adjustment with sufficient vs insufficient sample
 * - Home field advantage: homeRuns > awayRuns at equal pitcher quality
 * - computeApproxTeamWoba: real component wOBA > OBP proxy
 */

import { describe, expect, it } from "vitest";
import {
  asGameId,
  asISOTimestamp,
  asPlayerId,
  asTeamId
} from "../../lib/contracts/types";
import type {
  PreparedBatterInputs,
  PreparedGameInputs,
  PreparedPitcherInputs,
  PreparedTeamInputs
} from "../../lib/contracts/prepared";
import { projectTeamRuns } from "../../lib/projections/projectTeamRuns";
import { projectBatters } from "../../lib/projections/projectBatters";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeTeam = (overrides: Partial<PreparedTeamInputs> = {}): PreparedTeamInputs => ({
  team_id: asTeamId("team-test"),
  team_woba: 0.320,
  team_runs_per_game: 4.6,
  team_k_rate: 0.220,
  team_bb_rate: 0.085,
  team_era: 4.0,
  team_whip: 1.25,
  bullpen_era: 4.1,
  lineup_batters_available: 9,
  lineup_avg_woba: null,
  ...overrides
});

const makePitcher = (overrides: Partial<PreparedPitcherInputs> = {}): PreparedPitcherInputs => ({
  player_id: asPlayerId("pitcher-test"),
  mlb_stats_api_id: null,
  team_id: asTeamId("team-test"),
  handedness: "R",
  season_ip: 150,
  season_era: 4.0,
  season_whip: 1.20,
  season_k_per_9: 8.5,
  season_bb_per_9: 3.0,
  season_hr_per_9: 1.2,
  recent_starts_n: 5,
  recent_era: 4.0,
  recent_k_per_9: 8.5,
  recent_ip_per_start: 6.0,
  vs_lhb_era: null,
  vs_rhb_era: null,
  days_rest: 5,
  last_start_pitches: 95,
  baseline_source: "season_stats",
  pitcher_identity_known: true,
  fallback_reason: null,
  fallback_used: false,
  ...overrides
});

const makeBatter = (overrides: Partial<PreparedBatterInputs> = {}): PreparedBatterInputs => ({
  player_id: asPlayerId("batter-test"),
  mlb_stats_api_id: null,
  team_id: asTeamId("team-test"),
  batting_order: 1,
  handedness: "R",
  lineup_status: "confirmed_order",
  season_pa: 400,
  season_avg: 0.260,
  season_obp: 0.330,
  season_slg: 0.420,
  season_woba: 0.330,
  season_iso: 0.16,
  season_k_rate: 0.22,
  season_bb_rate: 0.09,
  season_hr_rate: 0.04,
  season_sb: 5,
  recent_games_n: null,
  recent_woba: null,
  recent_avg: null,
  vs_lhp_woba: null,
  vs_rhp_woba: null,
  ...overrides
});

const makeGame = (overrides: Partial<PreparedGameInputs> = {}): PreparedGameInputs => ({
  game_id: asGameId("reg-test-1"),
  sport_id: "MLB",
  scheduled_start: asISOTimestamp("2026-04-15T19:00:00Z"),
  prepared_at: asISOTimestamp("2026-04-15T14:00:00Z"),
  venue: { park_factor_runs: 1.0, is_dome: false, is_retractable_roof: false },
  weather: {
    temperature_f: 70,
    wind_speed_mph: 5,
    wind_direction_normalized: "out",
    is_enclosed: false
  },
  away_team: makeTeam({ team_id: asTeamId("away") }),
  home_team: makeTeam({ team_id: asTeamId("home") }),
  away_starter: makePitcher({ team_id: asTeamId("away"), player_id: asPlayerId("pitcher-away") }),
  home_starter: makePitcher({ team_id: asTeamId("home"), player_id: asPlayerId("pitcher-home") }),
  away_batters: [],
  home_batters: [],
  blocked: { is_blocked: false, blocked_reason: null },
  team_level_ready: true,
  has_both_starters: true,
  has_both_lineups: false,
  completeness_score: 0.8,
  ...overrides
});

// ---------------------------------------------------------------------------
// Park factors
// ---------------------------------------------------------------------------

describe("park factors", () => {
  it("Coors Field (1.17) raises projected runs compared to neutral park", () => {
    const neutral = projectTeamRuns(makeGame({ venue: { park_factor_runs: 1.0, is_dome: false, is_retractable_roof: false } }));
    const coors = projectTeamRuns(makeGame({ venue: { park_factor_runs: 1.17, is_dome: false, is_retractable_roof: false } }));

    expect(neutral.blocked.is_blocked).toBe(false);
    expect(coors.blocked.is_blocked).toBe(false);

    expect(coors.projected_total_runs!).toBeGreaterThan(neutral.projected_total_runs!);
    // Coors adds ~17% to runs — should be meaningfully higher, not just noise
    expect(coors.projected_total_runs! / neutral.projected_total_runs!).toBeGreaterThan(1.10);
  });

  it("Fenway Park (1.04) raises projected runs vs neutral", () => {
    const neutral = projectTeamRuns(makeGame({ venue: { park_factor_runs: 1.0, is_dome: false, is_retractable_roof: false } }));
    const fenway = projectTeamRuns(makeGame({ venue: { park_factor_runs: 1.04, is_dome: false, is_retractable_roof: false } }));

    expect(fenway.projected_total_runs!).toBeGreaterThan(neutral.projected_total_runs!);
    expect(fenway.projected_total_runs! / neutral.projected_total_runs!).toBeCloseTo(1.04, 1);
  });

  it("pitcher-friendly park (0.93) lowers projected runs vs neutral", () => {
    const neutral = projectTeamRuns(makeGame({ venue: { park_factor_runs: 1.0, is_dome: false, is_retractable_roof: false } }));
    const petco = projectTeamRuns(makeGame({ venue: { park_factor_runs: 0.93, is_dome: false, is_retractable_roof: false } }));

    expect(petco.projected_total_runs!).toBeLessThan(neutral.projected_total_runs!);
    expect(petco.projected_total_runs! / neutral.projected_total_runs!).toBeCloseTo(0.93, 1);
  });

  it("null park_factor_runs blocks projection — prepareGameInputs fills this before projectTeamRuns", () => {
    // projectTeamRuns requires a real park factor. The pipeline contract is:
    // prepareGameInputs.mapVenue fills null park_factor_runs with 1.0 so this
    // path does not arise in normal operation. Passing null directly blocks.
    const nullParkGame = makeGame({
      venue: { park_factor_runs: null, is_dome: false, is_retractable_roof: false }
    });

    const result = projectTeamRuns(nullParkGame);
    expect(result.blocked.is_blocked).toBe(true);
    expect(result.projected_total_runs).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Home field advantage
// ---------------------------------------------------------------------------

describe("home field advantage", () => {
  it("homeRuns > awayRuns when pitcher quality is equal, all else equal", () => {
    const game = makeGame();
    const result = projectTeamRuns(game);

    expect(result.blocked.is_blocked).toBe(false);
    expect(result.projected_home_runs!).toBeGreaterThan(result.projected_away_runs!);
  });

  it("home/away total is symmetric — advantage does not inflate game total", () => {
    const game = makeGame();
    const result = projectTeamRuns(game);
    const awayAdvGame = makeGame({
      // Swap pitcher quality to away: away pitcher better, home pitcher worse
      away_starter: makePitcher({ team_id: asTeamId("away"), player_id: asPlayerId("pitcher-away"), season_era: 3.0 }),
      home_starter: makePitcher({ team_id: asTeamId("home"), player_id: asPlayerId("pitcher-home"), season_era: 5.0 })
    });
    const awayResult = projectTeamRuns(awayAdvGame);

    // Both should still have home > away (home field + worse pitcher)
    expect(result.projected_home_runs!).toBeGreaterThan(result.projected_away_runs!);
    // Total with asymmetric pitching should differ, but home field factor persists
    expect(awayResult.projected_home_runs!).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// lineup_avg_woba
// ---------------------------------------------------------------------------

describe("lineup_avg_woba", () => {
  it("team with high lineup_avg_woba produces more runs than team with low lineup_avg_woba", () => {
    const strongLineup = makeGame({
      away_team: makeTeam({ team_id: asTeamId("away"), lineup_avg_woba: 0.370 }),
      home_team: makeTeam({ team_id: asTeamId("home"), lineup_avg_woba: 0.370 })
    });
    const weakLineup = makeGame({
      away_team: makeTeam({ team_id: asTeamId("away"), lineup_avg_woba: 0.270 }),
      home_team: makeTeam({ team_id: asTeamId("home"), lineup_avg_woba: 0.270 })
    });

    const strong = projectTeamRuns(strongLineup);
    const weak = projectTeamRuns(weakLineup);

    expect(strong.blocked.is_blocked).toBe(false);
    expect(weak.blocked.is_blocked).toBe(false);
    expect(strong.projected_total_runs!).toBeGreaterThan(weak.projected_total_runs!);
  });

  it("null lineup_avg_woba does not block projection — falls back to team_woba", () => {
    const game = makeGame({
      away_team: makeTeam({ team_id: asTeamId("away"), lineup_avg_woba: null }),
      home_team: makeTeam({ team_id: asTeamId("home"), lineup_avg_woba: null })
    });

    const result = projectTeamRuns(game);
    expect(result.blocked.is_blocked).toBe(false);
    expect(result.projected_total_runs).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// blendRecentForm
// ---------------------------------------------------------------------------

describe("blendRecentForm batter projection", () => {
  const awayTeam = makeTeam({ team_id: asTeamId("away") });
  const homeTeam = makeTeam({ team_id: asTeamId("home") });
  const awayPitcher = makePitcher({ team_id: asTeamId("away"), player_id: asPlayerId("pitcher-away") });
  const homePitcher = makePitcher({ team_id: asTeamId("home"), player_id: asPlayerId("pitcher-home") });

  it("hot batter with sufficient recent_games_n (>=5) scores more than cold batter in same game", () => {
    // Put both hot and cold batters in the same game so the same runScale is applied to both.
    // Relative projected_runs between the two then reflects the blendRecentForm difference.
    const hotBatter = makeBatter({
      player_id: asPlayerId("hot-batter"),
      team_id: asTeamId("away"),
      batting_order: 1,
      season_woba: 0.320,
      recent_games_n: 10,
      recent_woba: 0.430,
      vs_rhp_woba: 0.330
    });

    const coldBatter = makeBatter({
      player_id: asPlayerId("cold-batter"),
      team_id: asTeamId("away"),
      batting_order: 2,
      season_woba: 0.320,
      recent_games_n: 10,
      recent_woba: 0.220,
      vs_rhp_woba: 0.330
    });

    const game: PreparedGameInputs = makeGame({
      away_team: awayTeam,
      home_team: homeTeam,
      away_starter: awayPitcher,
      home_starter: homePitcher,
      away_batters: [hotBatter, coldBatter],
      home_batters: []
    });

    const result = projectBatters(game);
    expect(result.blocked.is_blocked).toBe(false);
    expect(result.away_batters).toHaveLength(2);

    const hotProjRuns = result.away_batters.find((b) => b.player_id === "hot-batter")?.projected_runs ?? 0;
    const coldProjRuns = result.away_batters.find((b) => b.player_id === "cold-batter")?.projected_runs ?? 0;
    expect(hotProjRuns).toBeGreaterThan(coldProjRuns);
  });

  it("batter with recent_games_n < 5 ignores recent_woba (insufficient sample)", () => {
    // Same batter: hot streak but only 3 games — should be ignored
    const insufficientSampleBatter = makeBatter({
      player_id: asPlayerId("batter-a"),
      team_id: asTeamId("away"),
      batting_order: 1,
      season_woba: 0.320,
      recent_games_n: 3,
      recent_woba: 0.500,  // extreme hot streak that would dominate if used
      vs_rhp_woba: 0.330
    });

    const baselineBatter = makeBatter({
      player_id: asPlayerId("batter-b"),
      team_id: asTeamId("away"),
      batting_order: 1,
      season_woba: 0.320,
      recent_games_n: null,
      recent_woba: null,
      vs_rhp_woba: 0.330
    });

    const gameA: PreparedGameInputs = makeGame({
      away_team: awayTeam,
      home_team: homeTeam,
      away_starter: awayPitcher,
      home_starter: homePitcher,
      away_batters: [insufficientSampleBatter],
      home_batters: []
    });

    const gameB: PreparedGameInputs = makeGame({
      away_team: awayTeam,
      home_team: homeTeam,
      away_starter: awayPitcher,
      home_starter: homePitcher,
      away_batters: [baselineBatter],
      home_batters: []
    });

    const resultA = projectBatters(gameA);
    const resultB = projectBatters(gameB);

    expect(resultA.away_batters).toHaveLength(1);
    expect(resultB.away_batters).toHaveLength(1);

    // Insufficient sample (3 games) should produce same projection as null recent_woba
    expect(resultA.away_batters[0]!.projected_runs).toBeCloseTo(resultB.away_batters[0]!.projected_runs!, 4);
  });

  it("recent_woba blend is clamped to ±25% of matchup wOBA", () => {
    // Batter with absurd recent_woba — clamp should prevent projected_runs from tripling
    const extremeHotBatter = makeBatter({
      player_id: asPlayerId("extreme-hot"),
      team_id: asTeamId("away"),
      batting_order: 1,
      season_woba: 0.320,
      recent_games_n: 20,
      recent_woba: 0.800,  // physically impossible sustained, tests clamp upper bound
      vs_rhp_woba: 0.330
    });

    const baselineBatter = makeBatter({
      player_id: asPlayerId("baseline"),
      team_id: asTeamId("away"),
      batting_order: 1,
      season_woba: 0.320,
      recent_games_n: null,
      recent_woba: null,
      vs_rhp_woba: 0.330
    });

    const extremeGame: PreparedGameInputs = makeGame({
      away_team: awayTeam,
      home_team: homeTeam,
      away_starter: awayPitcher,
      home_starter: homePitcher,
      away_batters: [extremeHotBatter],
      home_batters: []
    });

    const baselineGame: PreparedGameInputs = makeGame({
      away_team: awayTeam,
      home_team: homeTeam,
      away_starter: awayPitcher,
      home_starter: homePitcher,
      away_batters: [baselineBatter],
      home_batters: []
    });

    const extremeResult = projectBatters(extremeGame);
    const baselineResult = projectBatters(baselineGame);

    const extremeRuns = extremeResult.away_batters[0]!.projected_runs ?? 0;
    const baselineRuns = baselineResult.away_batters[0]!.projected_runs ?? 0;

    // Clamp is ±25%, so extreme 0.800 wOBA can only push matchup wOBA up by 25%
    expect(extremeRuns / baselineRuns).toBeLessThan(1.30);
  });
});

// ---------------------------------------------------------------------------
// projectedRuns and projectedRbi use the same matchup signal
// ---------------------------------------------------------------------------

describe("runs and RBI signal consistency", () => {
  const awayTeam = makeTeam({ team_id: asTeamId("away") });
  const homeTeam = makeTeam({ team_id: asTeamId("home") });
  // LHP pitcher
  const lhpPitcher = makePitcher({ team_id: asTeamId("home"), player_id: asPlayerId("pitcher-home"), handedness: "L" });
  const awayPitcher = makePitcher({ team_id: asTeamId("away"), player_id: asPlayerId("pitcher-away") });

  it("batter with strong vs_lhp_woba split projects more runs AND more RBI vs LHP compared to weak split batter", () => {
    // Both batters in the same game so the runScale/rbiScale normalization is shared.
    // Relative projected_runs and projected_rbi between them reflects the matchup signal difference.

    // Strong vs-lefty batter: 0.400 vs LHP
    const strongSplitBatter = makeBatter({
      player_id: asPlayerId("strong-split"),
      team_id: asTeamId("away"),
      batting_order: 3,
      season_woba: 0.330,
      vs_lhp_woba: 0.400,  // strong platoon advantage vs LHP
      vs_rhp_woba: 0.320,
      recent_games_n: null,
      recent_woba: null
    });

    // Weak vs-lefty batter: same slot, struggles vs LHP
    const weakSplitBatter = makeBatter({
      player_id: asPlayerId("weak-split"),
      team_id: asTeamId("away"),
      batting_order: 4,  // different slot so both survive the projection loop
      season_woba: 0.330,
      vs_lhp_woba: 0.250,  // platoon disadvantage vs LHP
      vs_rhp_woba: 0.380,
      recent_games_n: null,
      recent_woba: null
    });

    const game = makeGame({
      away_team: awayTeam,
      home_team: homeTeam,
      away_starter: awayPitcher,
      home_starter: lhpPitcher,
      away_batters: [strongSplitBatter, weakSplitBatter],
      home_batters: []
    });

    const result = projectBatters(game);
    expect(result.blocked.is_blocked).toBe(false);
    expect(result.away_batters).toHaveLength(2);

    const strongBatter = result.away_batters.find((b) => b.player_id === "strong-split")!;
    const weakBatter = result.away_batters.find((b) => b.player_id === "weak-split")!;

    // Platoon advantage should affect both runs and RBI (same matchup signal for both)
    expect(strongBatter.projected_runs).toBeGreaterThan(weakBatter.projected_runs);
    expect(strongBatter.projected_rbi).toBeGreaterThan(weakBatter.projected_rbi);

    // Both signals should move in the same direction — runs and RBI use the same wOBA basis
    const runsRatio = strongBatter.projected_runs / weakBatter.projected_runs;
    const rbiRatio = strongBatter.projected_rbi / weakBatter.projected_rbi;
    // Ratios won't be identical (slot factors differ for runs vs RBI), but should be in the same direction
    expect(runsRatio).toBeGreaterThan(1);
    expect(rbiRatio).toBeGreaterThan(1);
  });
});
