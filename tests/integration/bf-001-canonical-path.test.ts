/**
 * BF-001 canonical-path proof.
 *
 * Without BF-001: boxscore extraction returns null starters for pre-game games.
 * prepareGameInputs falls back to buildFallbackPitcherInputs (player_id set,
 * all stat fields null). The result is a PreparedGameInputs where
 * away_starter.season_era === null, which causes projectTeamRuns to block.
 *
 * With BF-001: buildPreparedStarterFromPeopleStats populates real stat fields.
 * projectTeamRuns no longer blocks on null season_era, and produces non-null
 * run projections.
 *
 * Uses the normalized game fixture (both probable pitchers present) with the
 * prepared fixture's lineups, so the starter-stat-null path is the only
 * gating variable under test.
 */

import { describe, expect, it } from "vitest";
import normalizedFixture from "../../data/fixtures/sample-normalized-game.json";
import preparedFixture from "../../data/fixtures/sample-prepared-game.json";
import { buildPreparedStarterFromPeopleStats } from "@lib/adapters/mlbStatsApi";
import type { CanonicalGame } from "@lib/contracts/canonical";
import type { PreparedBatterInputs, PreparedGameInputs } from "@lib/contracts/prepared";
import { prepareGameInputs } from "@lib/preparation";
import { projectTeamRuns } from "@lib/projections/projectTeamRuns";

const canonicalGame = normalizedFixture as unknown as CanonicalGame;
const prepared = preparedFixture as unknown as PreparedGameInputs;

// Reuse lineups from the full prepared fixture — isolates starter-stat-null
// as the single variable under test.
const awayBatters = prepared.away_batters as readonly PreparedBatterInputs[];
const homeBatters = prepared.home_batters as readonly PreparedBatterInputs[];

// Team stats payloads — supply non-null team_runs_per_game, team_woba, bullpen_era
// so those paths do not gate the test.
const teamHittingPayload = (runs: number, games: number, obp: string) => ({
  stats: [{ splits: [{ stat: { runs, gamesPlayed: games, obp } }] }]
});

const teamReliefPayload = (era: string) => ({
  stats: [{ splits: [{ split: { code: "rp" }, stat: { era } }] }]
});

const pitcherStatsPayload = (era: string) => ({
  stats: [{
    splits: [{
      stat: {
        era,
        whip: "1.10",
        strikeoutsPer9Inn: "9.50",
        walksPer9Inn: "2.50",
        homeRunsPer9: "1.00",
        inningsPitched: "120.0",
        gamesStarted: 20
      }
    }]
  }]
});

// Shared enrichment context — team stats, lineups. Starter key intentionally absent
// so prepareGameInputs falls back to buildFallbackPitcherInputs (all stat fields null).
const sharedPreGame = {
  away_batters: awayBatters,
  home_batters: homeBatters,
  away_team_season_hitting: teamHittingPayload(400, 100, "0.340"),
  home_team_season_hitting: teamHittingPayload(380, 100, "0.330"),
  away_team_relief_pitching: teamReliefPayload("3.80"),
  home_team_relief_pitching: teamReliefPayload("4.10")
  // away_starter / home_starter absent → prepareGameInputs uses fallback (all stats null)
};

describe("BF-001 canonical-path: projectTeamRuns unblocked by people-stats starters", () => {

  it("Phase A — without people stats, fallback starters have null season_era, projectTeamRuns blocks", () => {
    // This is the pre-BF-001 state: boxscore extraction returned null starters,
    // prepareGameInputs fell back to buildFallbackPitcherInputs.
    const phase_a = prepareGameInputs(canonicalGame, sharedPreGame);

    // Starters exist (fallback), but all stat fields are null
    expect(phase_a.away_starter).not.toBeNull();
    expect(phase_a.away_starter?.season_era).toBeNull();
    expect(phase_a.home_starter).not.toBeNull();
    expect(phase_a.home_starter?.season_era).toBeNull();

    // preparedGame may or may not be blocked (batters are supplied), but
    // the projection gate is inside projectTeamRuns, not prepareGameInputs.
    const teamRuns_a = projectTeamRuns(phase_a);
    expect(teamRuns_a.blocked.is_blocked).toBe(true);
    expect(teamRuns_a.projected_away_runs).toBeNull();
    expect(teamRuns_a.projected_home_runs).toBeNull();
    expect(teamRuns_a.projected_total_runs).toBeNull();
  });

  it("Phase B — after BF-001 fallback, real season_era populates starters, projectTeamRuns unblocks", () => {
    // BF-001 path: people-stats fetch succeeded, buildPreparedStarterFromPeopleStats
    // was called with the canonical player_id from normalizedGame.
    const awayStarter = buildPreparedStarterFromPeopleStats(
      canonicalGame.away.probable_pitcher!.player_id,
      canonicalGame.away.team.team_id,
      pitcherStatsPayload("3.20")
    );

    const homeStarter = buildPreparedStarterFromPeopleStats(
      canonicalGame.home.probable_pitcher!.player_id,
      canonicalGame.home.team.team_id,
      pitcherStatsPayload("2.95")
    );

    expect(awayStarter).not.toBeNull();
    expect(homeStarter).not.toBeNull();

    const phase_b = prepareGameInputs(canonicalGame, {
      ...sharedPreGame,
      away_starter: awayStarter!,
      home_starter: homeStarter!
    });

    // season_era is populated
    expect(phase_b.away_starter?.season_era).toBeCloseTo(3.20);
    expect(phase_b.home_starter?.season_era).toBeCloseTo(2.95);

    // Player IDs match canonical probable pitchers (identity contract preserved)
    expect(phase_b.away_starter?.player_id).toBe(
      canonicalGame.away.probable_pitcher!.player_id
    );
    expect(phase_b.home_starter?.player_id).toBe(
      canonicalGame.home.probable_pitcher!.player_id
    );

    // Downstream: projectTeamRuns now unblocked
    expect(phase_b.blocked.is_blocked).toBe(false);

    const teamRuns_b = projectTeamRuns(phase_b);
    expect(teamRuns_b.blocked.is_blocked).toBe(false);
    expect(teamRuns_b.projected_away_runs).not.toBeNull();
    expect(teamRuns_b.projected_home_runs).not.toBeNull();
    expect(teamRuns_b.projected_total_runs).not.toBeNull();
    expect(teamRuns_b.projected_away_runs!).toBeGreaterThan(0);
    expect(teamRuns_b.projected_home_runs!).toBeGreaterThan(0);
  });

  it("Phase A→B delta — only season_era changes; team inputs and lineups are identical", () => {
    const phase_a = prepareGameInputs(canonicalGame, sharedPreGame);

    const awayStarter = buildPreparedStarterFromPeopleStats(
      canonicalGame.away.probable_pitcher!.player_id,
      canonicalGame.away.team.team_id,
      pitcherStatsPayload("3.20")
    )!;

    const homeStarter = buildPreparedStarterFromPeopleStats(
      canonicalGame.home.probable_pitcher!.player_id,
      canonicalGame.home.team.team_id,
      pitcherStatsPayload("2.95")
    )!;

    const phase_b = prepareGameInputs(canonicalGame, {
      ...sharedPreGame,
      away_starter: awayStarter,
      home_starter: homeStarter
    });

    // Phase A → blocked at projectTeamRuns because season_era is null
    expect(phase_a.away_starter?.season_era).toBeNull();
    expect(projectTeamRuns(phase_a).blocked.is_blocked).toBe(true);

    // Phase B → unblocked at projectTeamRuns because season_era is populated
    expect(phase_b.away_starter?.season_era).toBeCloseTo(3.20);
    expect(projectTeamRuns(phase_b).blocked.is_blocked).toBe(false);

    // The single difference: starter season_era. All team/lineup inputs are identical.
    expect(phase_a.away_team).toEqual(phase_b.away_team);
    expect(phase_a.home_team).toEqual(phase_b.home_team);
    expect(phase_a.away_batters).toEqual(phase_b.away_batters);
    expect(phase_a.home_batters).toEqual(phase_b.home_batters);
  });
});
