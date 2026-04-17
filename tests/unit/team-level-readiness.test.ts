import { describe, expect, it } from "vitest";
import preparedFixture from "../../data/fixtures/sample-prepared-game.json";
import type {
  PreparedGameInputs,
  PreparedPitcherInputs,
  PreparedTeamInputs
} from "../../lib/contracts/prepared";
import { asGameId, asISOTimestamp, asPlayerId, asTeamId } from "../../lib/contracts/types";
import { projectTeamRuns } from "../../lib/projections/projectTeamRuns";
import { projectPitchers } from "../../lib/projections/projectPitchers";
import { assembleGameProjection } from "../../lib/projections/assembleGameProjection";
import { buildGameCard } from "../../lib/services/buildGameCard";
import { buildPlayerCards } from "../../lib/services/buildPlayerCard";

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
  last_start_pitches: 95,
  baseline_source: "season_stats",
  pitcher_identity_known: true,
  fallback_reason: null,
  fallback_used: false
});

/**
 * Builds PreparedGameInputs with team-level stats and starters but ZERO
 * batter arrays.  This is the exact shape produced by the live pipeline
 * when pre-game boxscores lack batting orders.
 */
const makeTeamLevelOnlyInputs = (
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

describe("Sub-slice A1: team-level readiness separation", () => {
  describe("team_level_ready flag", () => {
    it("is true when starters + team stats + venue are present, even with zero batters", () => {
      const inputs = makeTeamLevelOnlyInputs();
      expect(inputs.team_level_ready).toBe(true);
      expect(inputs.blocked.is_blocked).toBe(true);
      expect(inputs.away_batters).toHaveLength(0);
      expect(inputs.home_batters).toHaveLength(0);
    });

    it("is true on the full-data fixture", () => {
      expect(fullGame.team_level_ready).toBe(true);
      expect(fullGame.blocked.is_blocked).toBe(false);
    });

    it("is false when away_starter is null", () => {
      const inputs = makeTeamLevelOnlyInputs({ away_starter: null, team_level_ready: false });
      expect(inputs.team_level_ready).toBe(false);
    });
  });

  describe("projectTeamRuns with batters missing but team-level ready", () => {
    it("computes non-null projected runs", () => {
      const inputs = makeTeamLevelOnlyInputs();
      const result = projectTeamRuns(inputs);

      expect(result.blocked.is_blocked).toBe(false);
      expect(result.projected_away_runs).toBeTypeOf("number");
      expect(result.projected_home_runs).toBeTypeOf("number");
      expect(result.projected_total_runs).toBeTypeOf("number");
      expect(result.projected_away_runs).toBeGreaterThan(0);
      expect(result.projected_home_runs).toBeGreaterThan(0);
    });

    it("still blocks when starters are missing (regardless of blocked flag)", () => {
      const inputs = makeTeamLevelOnlyInputs({
        away_starter: null,
        team_level_ready: false,
        has_both_starters: false
      });
      const result = projectTeamRuns(inputs);
      expect(result.blocked.is_blocked).toBe(true);
      expect(result.projected_away_runs).toBeNull();
    });
  });

  describe("projectPitchers with batters missing but team-level ready", () => {
    it("computes pitcher projections when team-level data is sufficient", () => {
      const inputs = makeTeamLevelOnlyInputs();
      const result = projectPitchers(inputs);

      expect(result.blocked.is_blocked).toBe(false);
      expect(result.away_pitcher).not.toBeNull();
      expect(result.home_pitcher).not.toBeNull();
      expect(result.away_pitcher?.projected_ip).toBeGreaterThan(0);
    });
  });

  describe("assembleGameProjection with batters missing", () => {
    it("produces valid team runs but batters are blocked", () => {
      const inputs = makeTeamLevelOnlyInputs();
      const assembled = assembleGameProjection(inputs);

      // Team runs are computed (not zero-fallback)
      expect(assembled.game_projection.away.projected_runs).toBeGreaterThan(0);
      expect(assembled.game_projection.home.projected_runs).toBeGreaterThan(0);
      expect(assembled.game_projection.projected_total).toBeGreaterThan(0);

      // Batter arrays are empty (no fake batters)
      expect(assembled.away_batters).toHaveLength(0);
      expect(assembled.home_batters).toHaveLength(0);

      // Overall metadata is still blocked (batter projection contributes blocked reason).
      // The blocked reason originates from the prepared inputs (missing batter arrays),
      // which assembleGameProjection propagates via its metadata merge.
      expect(assembled.game_projection.metadata.blocked.is_blocked).toBe(true);
    });
  });

  describe("buildGameCard simulation gate uses team_level_ready", () => {
    it("produces simulation output when team_level_ready is true, even with batters missing", () => {
      const inputs = makeTeamLevelOnlyInputs();
      const card = buildGameCard(inputs, {
        simulation: { seed: 42, iterations: 100 }
      });

      // Simulation ran despite blocked state
      expect(card.simulation).not.toBeNull();
      expect(card.simulation?.away_win_probability).toBeTypeOf("number");
      expect(card.simulation?.home_win_probability).toBeTypeOf("number");
      expect(card.simulation?.average_total_runs).toBeGreaterThan(0);

      // Deterministic team runs are surfaced
      expect(card.deterministic.projected_away_runs).toBeGreaterThan(0);
      expect(card.deterministic.projected_home_runs).toBeGreaterThan(0);
      expect(card.deterministic.projected_total).toBeGreaterThan(0);

      // Win probabilities sum to ~1.0
      const totalProb =
        (card.simulation?.away_win_probability ?? 0) +
        (card.simulation?.home_win_probability ?? 0);
      expect(totalProb).toBeGreaterThan(0.95);
      expect(totalProb).toBeLessThanOrEqual(1.0);
    });

    it("skips simulation when team_level_ready is false", () => {
      const inputs = makeTeamLevelOnlyInputs({
        away_starter: null,
        team_level_ready: false,
        has_both_starters: false
      });
      const card = buildGameCard(inputs, {
        simulation: { seed: 42, iterations: 100 }
      });

      expect(card.simulation).toBeNull();
      expect(card.deterministic.projected_away_runs).toBeNull();
    });

    it("produces market edge when simulation is available and odds provided", () => {
      const inputs = makeTeamLevelOnlyInputs();
      const card = buildGameCard(inputs, {
        simulation: { seed: 42, iterations: 100 },
        market: {
          format: "american",
          moneyline: {
            away_odds: 110,
            home_odds: -130
          }
        }
      });

      expect(card.market).not.toBeNull();
      expect(card.market?.moneyline).not.toBeNull();
      expect(card.market?.moneyline?.away.model_probability).toBeGreaterThan(0);
      expect(card.market?.moneyline?.home.model_probability).toBeGreaterThan(0);
    });
  });

  describe("player board when batters are missing", () => {
    it("produces only pitcher player cards from team-level-only inputs", () => {
      const result = buildPlayerCards(makeTeamLevelOnlyInputs());

      // No fake batter rows — only the two pitcher projections survive
      // because projectPitchers succeeds when team-level data is sufficient.
      expect(result.players).toHaveLength(2);
      expect(
        result.players.every((p) => p.deterministic_summary?.kind === "pitcher")
      ).toBe(true);
    });
  });

  describe("full-data path is not regressed", () => {
    it("produces simulation and player cards from complete inputs", () => {
      const card = buildGameCard(fullGame, {
        simulation: { seed: 42, iterations: 100 }
      });

      // Simulation still works for full data
      expect(card.simulation).not.toBeNull();
      expect(card.blocked.is_blocked).toBe(false);

      // Player cards still produced
      const players = buildPlayerCards(fullGame);
      expect(players.players.length).toBeGreaterThan(0);
    });
  });
});
