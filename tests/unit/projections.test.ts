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
