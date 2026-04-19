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
import { projectBatters } from "../../lib/projections/projectBatters";
import { projectTeamRuns } from "../../lib/projections/projectTeamRuns";
import { buildGameCard } from "../../lib/services/buildGameCard";

const prepared = preparedFixture as unknown as PreparedGameInputs;
const invalidPrepared = invalidPreparedFixture as unknown as PreparedGameInputs;

// ---------------------------------------------------------------------------
// BF-002 helpers: build synthetic PreparedGameInputs with controlled batters
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
  last_start_pitches: 95,
  baseline_source: "season_stats",
  pitcher_identity_known: true,
  fallback_reason: null,
  fallback_used: false
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
  lineup_status: "confirmed_order",
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

describe("phase 4 projections", () => {
  it("is deterministic for identical prepared inputs", () => {
    const first = assembleGameProjection(prepared);
    const second = assembleGameProjection(prepared);

    expect(first).toStrictEqual(second);
  });

  it("returns blocked outputs with explicit blocked_reason when prepared inputs are blocked", () => {
    const blocked = assembleGameProjection(invalidPrepared);

    expect(blocked.game_projection.metadata.blocked.is_blocked).toBe(true);
    expect(blocked.game_projection.metadata.blocked.blocked_reason).toBeTruthy();
  });

  it("keeps projected total equal to away plus home", () => {
    const gameProjection = assembleGameProjection(prepared).game_projection;

    expect(gameProjection.projected_total).toBeCloseTo(
      gameProjection.away.projected_runs + gameProjection.home.projected_runs
    );
  });

  it("produces stable non-blocked team projections for the valid prepared fixture", () => {
    const teamRuns = projectTeamRuns(prepared);

    expect(teamRuns.blocked.is_blocked).toBe(false);
    expect(teamRuns.projected_away_runs).not.toBeNull();
    expect(teamRuns.projected_home_runs).not.toBeNull();
    expect(teamRuns.projected_total_runs).toBeCloseTo(
      (teamRuns.projected_away_runs ?? 0) + (teamRuns.projected_home_runs ?? 0)
    );
  });
});

// ---------------------------------------------------------------------------
// BF-002: partial batter completeness does not zero out projections
// ---------------------------------------------------------------------------

describe("BF-002 — projectBatters partial batter completeness", () => {
  it("projects all 9 batters per team when every batter is complete", () => {
    const result = projectBatters(makeSyntheticInputs());

    expect(result.blocked.is_blocked).toBe(false);
    expect(result.away_batters).toHaveLength(9);
    expect(result.home_batters).toHaveLength(9);
  });

  it("skips one incomplete batter and still projects the remaining 8", () => {
    const awayBatters = makeFullLineup("team-away");
    awayBatters[3] = { ...awayBatters[3]!, season_avg: null };

    const result = projectBatters(makeSyntheticInputs({ away_batters: awayBatters }));

    expect(result.blocked.is_blocked).toBe(false);
    expect(result.away_batters).toHaveLength(8);
    expect(result.home_batters).toHaveLength(9);
  });

  it("one team zero projectable / other team partial → unblocked, both arrays returned", () => {
    const awayBatters = makeFullLineup("team-away").map(b => ({
      ...b, season_avg: null
    }));

    const result = projectBatters(makeSyntheticInputs({ away_batters: awayBatters }));

    expect(result.blocked.is_blocked).toBe(false);
    expect(result.away_batters).toHaveLength(0);
    expect(result.home_batters).toHaveLength(9);
  });

  it("both teams zero projectable → blocked with explicit reason", () => {
    const awayBatters = makeFullLineup("team-away").map(b => ({
      ...b, season_avg: null
    }));
    const homeBatters = makeFullLineup("team-home").map(b => ({
      ...b, season_pa: null
    }));

    const result = projectBatters(makeSyntheticInputs({
      away_batters: awayBatters,
      home_batters: homeBatters
    }));

    expect(result.blocked.is_blocked).toBe(true);
    expect(result.blocked.blocked_reason).toBe("Zero projectable batters on both teams");
    expect(result.away_batters).toHaveLength(0);
    expect(result.home_batters).toHaveLength(0);
  });
});

describe("BF-002 — assembleGameProjection with partial batters", () => {
  it("assembles unblocked projection when one team has partial batters", () => {
    const awayBatters = makeFullLineup("team-away");
    awayBatters[0] = { ...awayBatters[0]!, season_sb: null };
    awayBatters[4] = { ...awayBatters[4]!, season_hr_rate: null };

    const assembled = assembleGameProjection(makeSyntheticInputs({
      away_batters: awayBatters
    }));

    expect(assembled.game_projection.metadata.blocked.is_blocked).toBe(false);
    expect(assembled.away_batters).toHaveLength(7);
    expect(assembled.home_batters).toHaveLength(9);
    expect(assembled.away_pitcher).not.toBeNull();
    expect(assembled.home_pitcher).not.toBeNull();
  });

  it("assembles blocked projection when both teams have zero projectable batters", () => {
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

    expect(assembled.game_projection.metadata.blocked.is_blocked).toBe(true);
    expect(assembled.game_projection.metadata.blocked.blocked_reason).toContain(
      "Zero projectable batters"
    );
  });
});

// ---------------------------------------------------------------------------
// Regression: projectBatters — zero-PA debut batter never produces NaN sb
// ---------------------------------------------------------------------------

describe("projectBatters — zero-PA debut batter", () => {
  it("returns projected_sb = 0 (not NaN) for a confirmed-order batter with season_pa = 0", () => {
    // Represents a player who just debuted: in today's lineup, but no recorded PA yet.
    const debutBatter: PreparedBatterInputs = {
      ...makeCompleteBatter("debut-player", "team-away", 9),
      season_pa: 0,
      season_sb: 0,
      season_avg: 0,
      season_obp: 0,
      season_slg: 0,
      season_woba: null,
      season_bb_rate: 0,
      season_hr_rate: 0,
      season_iso: 0,
      lineup_status: "confirmed_order"
    };

    const awayBatters = [
      ...makeFullLineup("team-away").slice(0, 8),
      debutBatter
    ];

    const result = projectBatters(makeSyntheticInputs({ away_batters: awayBatters }));

    const debut = result.away_batters.find(b => b.player_id === "debut-player");
    expect(debut).toBeDefined();
    expect(Number.isFinite(debut!.projected_sb)).toBe(true);
    expect(debut!.projected_sb).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Regression: buildGameCard — team-run-blocked game must not surface 0-runs
// as deterministic output or run simulation on degenerate (0, 0) inputs.
//
// "team-level blocked" means projectTeamRuns itself failed (missing park factor,
// starters, or team stats). This is distinct from metadata.blocked being true
// due to batter-level reasons — in that case team runs are valid and simulation
// SHOULD still run (tested separately in team-level-readiness.test.ts).
// ---------------------------------------------------------------------------

describe("buildGameCard — team-run-blocked game (venue: null)", () => {
  it("assembleGameProjection sets team_runs_blocked = true when venue is null", () => {
    const assembled = assembleGameProjection(makeSyntheticInputs({ venue: null }));

    expect(assembled.team_runs_blocked).toBe(true);
    expect(assembled.game_projection.away.projected_runs).toBe(0);
    expect(assembled.game_projection.home.projected_runs).toBe(0);
  });

  it("surfaces null deterministic runs (not 0) when team runs are blocked", () => {
    // venue: null → projectTeamRuns returns blocked → projected_runs coerced to 0.
    // buildGameCard must not surface that 0 as a real projection.
    const card = buildGameCard(makeSyntheticInputs({ venue: null, team_level_ready: true }));

    expect(card.blocked.is_blocked).toBe(true);
    expect(card.deterministic.projected_away_runs).toBeNull();
    expect(card.deterministic.projected_home_runs).toBeNull();
    expect(card.deterministic.projected_total).toBeNull();
    expect(card.deterministic.away_pitcher).toBeNull();
    expect(card.deterministic.home_pitcher).toBeNull();
  });

  it("simulation is null when team runs are blocked (avoids degenerate 50/50 output)", () => {
    const card = buildGameCard(
      makeSyntheticInputs({ venue: null, team_level_ready: true }),
      { simulation: { seed: 42, iterations: 100 } }
    );

    expect(card.simulation).toBeNull();
  });

  it("unblocked game with team_level_ready surfaces real runs and simulation", () => {
    const card = buildGameCard(
      makeSyntheticInputs({ team_level_ready: true }),
      { simulation: { seed: 42, iterations: 100 } }
    );

    expect(card.blocked.is_blocked).toBe(false);
    expect(card.deterministic.projected_away_runs).not.toBeNull();
    expect((card.deterministic.projected_away_runs ?? 0)).toBeGreaterThan(0);
    expect(card.deterministic.projected_total).not.toBeNull();
    expect(card.simulation).not.toBeNull();
    expect(card.simulation?.average_total_runs).toBeGreaterThan(0);
  });
});
