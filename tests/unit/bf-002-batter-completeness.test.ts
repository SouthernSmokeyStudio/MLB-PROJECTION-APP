/**
 * BF-002 Slice 1 — Batter projection completeness.
 *
 * Proves that projectBatters:
 *  - projects all 9 batters when every batter has complete stats
 *  - skips incomplete batters and still projects complete ones
 *  - blocks honestly when zero batters are projectable on both teams
 *  - does not false-succeed for empty lineups
 *
 * The fix: projectBatters.ts no longer hard-fails an entire team
 * when a single batter is missing a required field. It skips that
 * batter and projects the rest.
 */

import { describe, expect, it } from "vitest";
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
import { projectBatters } from "../../lib/projections/projectBatters";

// ---------------------------------------------------------------------------
// Helpers: build minimal valid prepared inputs for batter projection
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

const makeIncompleteBatter = (
  id: string,
  teamId: string,
  slot: number,
  nullField: keyof PreparedBatterInputs
): PreparedBatterInputs => ({
  ...makeCompleteBatter(id, teamId, slot),
  [nullField]: null
});

const makeFullLineup = (teamId: string): PreparedBatterInputs[] =>
  Array.from({ length: 9 }, (_, i) =>
    makeCompleteBatter(`${teamId}-batter-${i + 1}`, teamId, i + 1)
  );

const makeInputs = (overrides: Partial<PreparedGameInputs> = {}): PreparedGameInputs => ({
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("projectBatters — BF-002 batter completeness", () => {
  it("projects all 9 batters per team when every batter is complete", () => {
    const result = projectBatters(makeInputs());

    expect(result.blocked.is_blocked).toBe(false);
    expect(result.away_batters).toHaveLength(9);
    expect(result.home_batters).toHaveLength(9);

    for (const batter of result.away_batters) {
      expect(batter.projected_pa).toBeGreaterThan(0);
      expect(batter.projected_hits).toBeGreaterThan(0);
    }
    for (const batter of result.home_batters) {
      expect(batter.projected_pa).toBeGreaterThan(0);
      expect(batter.projected_hits).toBeGreaterThan(0);
    }
  });

  it("skips a batter missing season_avg and projects the remaining 8", () => {
    const awayBatters = makeFullLineup("team-away");
    awayBatters[3] = makeIncompleteBatter("team-away-batter-4", "team-away", 4, "season_avg");

    const result = projectBatters(makeInputs({ away_batters: awayBatters }));

    expect(result.blocked.is_blocked).toBe(false);
    expect(result.away_batters).toHaveLength(8);
    expect(result.home_batters).toHaveLength(9);

    // The skipped batter (slot 4) should not appear
    const projectedSlots = result.away_batters.map(b => {
      const input = awayBatters.find(ab => ab.player_id === b.player_id);
      return input?.batting_order;
    });
    expect(projectedSlots).not.toContain(4);
  });

  it("skips a batter missing season_pa and projects the remaining 8", () => {
    const homeBatters = makeFullLineup("team-home");
    homeBatters[0] = makeIncompleteBatter("team-home-batter-1", "team-home", 1, "season_pa");

    const result = projectBatters(makeInputs({ home_batters: homeBatters }));

    expect(result.blocked.is_blocked).toBe(false);
    expect(result.away_batters).toHaveLength(9);
    expect(result.home_batters).toHaveLength(8);
  });

  it("skips a batter missing season_bb_rate", () => {
    const awayBatters = makeFullLineup("team-away");
    awayBatters[7] = makeIncompleteBatter("team-away-batter-8", "team-away", 8, "season_bb_rate");

    const result = projectBatters(makeInputs({ away_batters: awayBatters }));

    expect(result.blocked.is_blocked).toBe(false);
    expect(result.away_batters).toHaveLength(8);
  });

  it("skips a batter missing season_hr_rate", () => {
    const homeBatters = makeFullLineup("team-home");
    homeBatters[5] = makeIncompleteBatter("team-home-batter-6", "team-home", 6, "season_hr_rate");

    const result = projectBatters(makeInputs({ home_batters: homeBatters }));

    expect(result.blocked.is_blocked).toBe(false);
    expect(result.home_batters).toHaveLength(8);
  });

  it("skips a batter missing season_sb", () => {
    const awayBatters = makeFullLineup("team-away");
    awayBatters[2] = makeIncompleteBatter("team-away-batter-3", "team-away", 3, "season_sb");

    const result = projectBatters(makeInputs({ away_batters: awayBatters }));

    expect(result.blocked.is_blocked).toBe(false);
    expect(result.away_batters).toHaveLength(8);
  });

  it("skips a batter missing batting_order (null slot)", () => {
    const awayBatters = makeFullLineup("team-away");
    awayBatters[1] = makeIncompleteBatter("team-away-batter-2", "team-away", 2, "batting_order");

    const result = projectBatters(makeInputs({ away_batters: awayBatters }));

    expect(result.blocked.is_blocked).toBe(false);
    expect(result.away_batters).toHaveLength(8);
  });

  it("skips multiple incomplete batters and projects only complete ones", () => {
    const awayBatters = makeFullLineup("team-away");
    // Make 3 batters incomplete with different missing fields
    awayBatters[0] = makeIncompleteBatter("team-away-batter-1", "team-away", 1, "season_avg");
    awayBatters[4] = makeIncompleteBatter("team-away-batter-5", "team-away", 5, "season_pa");
    awayBatters[8] = makeIncompleteBatter("team-away-batter-9", "team-away", 9, "season_hr_rate");

    const result = projectBatters(makeInputs({ away_batters: awayBatters }));

    expect(result.blocked.is_blocked).toBe(false);
    expect(result.away_batters).toHaveLength(6);
    expect(result.home_batters).toHaveLength(9);
  });

  it("succeeds with zero away batters but 9 home batters (partial team coverage)", () => {
    // All away batters are incomplete
    const awayBatters = makeFullLineup("team-away").map((_b, i) =>
      makeIncompleteBatter(`team-away-batter-${i + 1}`, "team-away", i + 1, "season_avg")
    );

    const result = projectBatters(makeInputs({ away_batters: awayBatters }));

    // Should still succeed: home team has full projections
    expect(result.blocked.is_blocked).toBe(false);
    expect(result.away_batters).toHaveLength(0);
    expect(result.home_batters).toHaveLength(9);
  });

  it("blocks honestly when zero batters are projectable on both teams", () => {
    const awayBatters = makeFullLineup("team-away").map((_b, i) =>
      makeIncompleteBatter(`team-away-batter-${i + 1}`, "team-away", i + 1, "season_avg")
    );
    const homeBatters = makeFullLineup("team-home").map((_b, i) =>
      makeIncompleteBatter(`team-home-batter-${i + 1}`, "team-home", i + 1, "season_pa")
    );

    const result = projectBatters(makeInputs({
      away_batters: awayBatters,
      home_batters: homeBatters
    }));

    expect(result.blocked.is_blocked).toBe(true);
    expect(result.blocked.blocked_reason).toContain("Zero projectable batters");
    expect(result.away_batters).toHaveLength(0);
    expect(result.home_batters).toHaveLength(0);
  });

  it("does not false-succeed for empty lineups (prepared inputs blocked)", () => {
    const result = projectBatters(makeInputs({
      away_batters: [],
      home_batters: [],
      blocked: { is_blocked: true, blocked_reason: "Missing away_batters preparation data; Missing home_batters preparation data" }
    }));

    expect(result.blocked.is_blocked).toBe(true);
    expect(result.away_batters).toHaveLength(0);
    expect(result.home_batters).toHaveLength(0);
  });

  it("does not false-succeed when empty lineups bypass prepared blocking", () => {
    // Edge case: empty batters but not flagged as blocked at prepared level
    // (shouldn't happen in practice, but tests the projection engine boundary)
    const result = projectBatters(makeInputs({
      away_batters: [],
      home_batters: []
    }));

    expect(result.blocked.is_blocked).toBe(true);
    expect(result.blocked.blocked_reason).toContain("Zero projectable batters");
  });
});
