import type { BatterProjection } from "@lib/contracts/projections";
import type {
  PreparedBatterInputs,
  PreparedGameInputs,
  PreparedPitcherInputs,
  PreparedTeamInputs
} from "@lib/contracts/prepared";
import type { BlockedState, Handedness } from "@lib/contracts/types";
import { projectTeamRuns } from "./projectTeamRuns";

export interface BatterProjectionResult {
  readonly blocked: BlockedState;
  readonly away_batters: readonly BatterProjection[];
  readonly home_batters: readonly BatterProjection[];
}

const BASELINE_WOBA = 0.32;
const BASELINE_ERA = 4.2;
const BASELINE_BB_RATE = 0.085;

const PA_BY_SLOT: Record<number, number> = {
  1: 4.85,
  2: 4.7,
  3: 4.55,
  4: 4.4,
  5: 4.25,
  6: 4.1,
  7: 3.95,
  8: 3.8,
  9: 3.7
};

const RUN_SHARE_BY_SLOT: Record<number, number> = {
  1: 0.14,
  2: 0.13,
  3: 0.12,
  4: 0.11,
  5: 0.11,
  6: 0.1,
  7: 0.1,
  8: 0.1,
  9: 0.09
};

const RBI_SHARE_BY_SLOT: Record<number, number> = {
  1: 0.09,
  2: 0.1,
  3: 0.13,
  4: 0.16,
  5: 0.14,
  6: 0.11,
  7: 0.1,
  8: 0.09,
  9: 0.08
};

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);
const round2 = (value: number): number => Math.round(value * 100) / 100;

const buildBlocked = (reason: string): BatterProjectionResult => ({
  blocked: {
    is_blocked: true,
    blocked_reason: reason
  },
  away_batters: [],
  home_batters: []
});

const getMatchupWoba = (batter: PreparedBatterInputs, pitcherHandedness: Handedness): number | null => {
  if (pitcherHandedness === "L") {
    return batter.vs_lhp_woba ?? batter.season_woba;
  }

  if (pitcherHandedness === "R") {
    return batter.vs_rhp_woba ?? batter.season_woba;
  }

  return batter.season_woba;
};

const buildTeamBatterProjection = (
  inputs: PreparedGameInputs,
  batters: readonly PreparedBatterInputs[],
  team: PreparedTeamInputs,
  opponentPitcher: PreparedPitcherInputs,
  teamProjectedRuns: number
): readonly BatterProjection[] | null => {
  if (
    opponentPitcher.season_era === null ||
    opponentPitcher.season_bb_per_9 === null
  ) {
    return null;
  }

  const teamEnvironmentFactor = clamp(teamProjectedRuns / (team.team_runs_per_game ?? 4.6), 0.8, 1.25);
  const lineupAvailabilityFactor = clamp(team.lineup_batters_available / 9, 0.8, 1);

  const projections: BatterProjection[] = [];

  for (const batter of batters) {
    const slot = batter.batting_order;
    const seasonAvg = batter.season_avg;
    const seasonBbRate = batter.season_bb_rate;
    const seasonHrRate = batter.season_hr_rate;
    const seasonPa = batter.season_pa;
    const seasonSb = batter.season_sb;

    if (
      slot === null ||
      seasonAvg === null ||
      seasonBbRate === null ||
      seasonHrRate === null ||
      seasonPa === null ||
      seasonSb === null
    ) {
      return null;
    }

    const basePa = PA_BY_SLOT[slot] ?? 3.7;
    const projectedPa = round2(basePa * teamEnvironmentFactor * lineupAvailabilityFactor);

    const matchupWoba =
      getMatchupWoba(batter, opponentPitcher.handedness) ??
      batter.season_woba ??
      BASELINE_WOBA;

    const matchupFactor = clamp(
      (matchupWoba / BASELINE_WOBA) * (opponentPitcher.season_era / BASELINE_ERA),
      0.75,
      1.3
    );

    const powerFactor = clamp((batter.season_iso ?? 0.17) / 0.17, 0.7, 1.35);
    const hrModifier = clamp(
      powerFactor * ((opponentPitcher.season_hr_per_9 ?? 1) / 1.1),
      0.7,
      1.35
    );

    const walkModifier = clamp(
      (opponentPitcher.season_bb_per_9 / 9) / BASELINE_BB_RATE,
      0.8,
      1.2
    );

    const projectedBb = round2(projectedPa * seasonBbRate * walkModifier);
    const projectedAb = round2(Math.max(projectedPa - projectedBb, 0));
    const projectedHr = round2(projectedPa * seasonHrRate * hrModifier);

    const projectedHits = round2(
      Math.max(projectedAb * seasonAvg * clamp(matchupFactor, 0.85, 1.15), projectedHr)
    );

    const nonHrHits = Math.max(projectedHits - projectedHr, 0);

    const projectedDoubles = round2(
      nonHrHits * clamp(0.18 + (((batter.season_iso ?? 0.17) - 0.17) * 0.5), 0.12, 0.3)
    );

    const projectedTriples = round2(Math.max(nonHrHits - projectedDoubles, 0) * 0.03);
    const projectedSingles = round2(
      Math.max(projectedHits - projectedHr - projectedDoubles - projectedTriples, 0)
    );

    const projectedRuns = round2(
      teamProjectedRuns *
        (RUN_SHARE_BY_SLOT[slot] ?? 0.09) *
        clamp((batter.season_obp ?? 0.32) / 0.32, 0.8, 1.2)
    );

    const projectedRbi = round2(
      teamProjectedRuns *
        (RBI_SHARE_BY_SLOT[slot] ?? 0.08) *
        clamp(matchupWoba / BASELINE_WOBA, 0.8, 1.2)
    );

    const projectedSb = round2((seasonSb / seasonPa) * projectedPa);

    projections.push({
      player_id: batter.player_id,
      team_id: team.team_id,
      game_id: inputs.game_id,
      projected_pa: projectedPa,
      projected_ab: projectedAb,
      projected_hits: projectedHits,
      projected_singles: projectedSingles,
      projected_doubles: projectedDoubles,
      projected_triples: projectedTriples,
      projected_hr: projectedHr,
      projected_rbi: projectedRbi,
      projected_runs: projectedRuns,
      projected_bb: projectedBb,
      projected_sb: projectedSb
    });
  }

  return projections;
};

export const projectBatters = (inputs: PreparedGameInputs): BatterProjectionResult => {
  if (inputs.blocked.is_blocked) {
    return buildBlocked(inputs.blocked.blocked_reason ?? "Prepared inputs are blocked");
  }

  if (!inputs.away_starter || !inputs.home_starter) {
    return buildBlocked("Both starting pitchers are required for baseline batter projections");
  }

  const teamRuns = projectTeamRuns(inputs);
  if (
    teamRuns.blocked.is_blocked ||
    teamRuns.projected_away_runs === null ||
    teamRuns.projected_home_runs === null
  ) {
    return buildBlocked(teamRuns.blocked.blocked_reason ?? "Team run projection failed");
  }

  const awayBatters = buildTeamBatterProjection(
    inputs,
    inputs.away_batters,
    inputs.away_team,
    inputs.home_starter,
    teamRuns.projected_away_runs
  );

  const homeBatters = buildTeamBatterProjection(
    inputs,
    inputs.home_batters,
    inputs.home_team,
    inputs.away_starter,
    teamRuns.projected_home_runs
  );

  if (!awayBatters || !homeBatters) {
    return buildBlocked("Missing required batter baseline fields for deterministic batter projections");
  }

  return {
    blocked: {
      is_blocked: false,
      blocked_reason: null
    },
    away_batters: awayBatters,
    home_batters: homeBatters
  };
};
