import type { PitcherProjection } from "@lib/contracts/projections";
import type {
  PreparedGameInputs,
  PreparedPitcherInputs,
  PreparedTeamInputs
} from "@lib/contracts/prepared";
import type { BlockedState } from "@lib/contracts/types";
import { projectTeamRuns } from "./projectTeamRuns";

export interface PitcherProjectionResult {
  readonly blocked: BlockedState;
  readonly away_pitcher: PitcherProjection | null;
  readonly home_pitcher: PitcherProjection | null;
}

const BASELINE_K_RATE = 0.22;
const BASELINE_BB_RATE = 0.085;
const BASELINE_RUNS_PER_GAME = 4.6;

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);
const round2 = (value: number): number => Math.round(value * 100) / 100;
const average = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;

const buildBlocked = (reason: string): PitcherProjectionResult => ({
  blocked: {
    is_blocked: true,
    blocked_reason: reason
  },
  away_pitcher: null,
  home_pitcher: null
});

const computeProjectedIp = (pitcher: PreparedPitcherInputs, opponentTeam: PreparedTeamInputs): number | null => {
  if (pitcher.recent_ip_per_start === null) {
    return null;
  }

  const daysRest = pitcher.days_rest ?? 5;
  const lastStartPitches = pitcher.last_start_pitches ?? 95;
  const restFactor = clamp(1 + (daysRest - 5) * 0.015, 0.94, 1.08);
  const pitchCountFactor = clamp(lastStartPitches / 95, 0.88, 1.08);
  const lineupFactor = clamp(opponentTeam.lineup_batters_available / 9, 0.8, 1);

  return round2(clamp(pitcher.recent_ip_per_start * restFactor * pitchCountFactor * lineupFactor, 3.5, 7.5));
};

const buildPitcherProjection = (
  inputs: PreparedGameInputs,
  pitcher: PreparedPitcherInputs,
  pitcherTeam: PreparedTeamInputs,
  opponentTeam: PreparedTeamInputs,
  opponentRuns: number
): PitcherProjection | null => {
  if (
    pitcher.season_era === null ||
    pitcher.season_whip === null ||
    pitcher.season_k_per_9 === null ||
    pitcher.season_bb_per_9 === null
  ) {
    return null;
  }

  const projectedIp = computeProjectedIp(pitcher, opponentTeam);
  if (projectedIp === null) {
    return null;
  }

  const blendedKPer9 =
    pitcher.recent_k_per_9 === null
      ? pitcher.season_k_per_9
      : average([pitcher.season_k_per_9, pitcher.recent_k_per_9]);

  const opponentKModifier = clamp((opponentTeam.team_k_rate ?? BASELINE_K_RATE) / BASELINE_K_RATE, 0.8, 1.2);
  const opponentRunModifier = clamp((opponentTeam.team_runs_per_game ?? BASELINE_RUNS_PER_GAME) / BASELINE_RUNS_PER_GAME, 0.8, 1.2);
  const environmentModifier = clamp(opponentRuns / BASELINE_RUNS_PER_GAME, 0.75, 1.3);
  const walkModifier = clamp((opponentTeam.team_bb_rate ?? BASELINE_BB_RATE) / BASELINE_BB_RATE, 0.8, 1.2);

  const projectedBb = round2(projectedIp * (pitcher.season_bb_per_9 / 9) * walkModifier);
  const projectedK = round2(projectedIp * (blendedKPer9 / 9) * opponentKModifier);

  const blendedEra =
    pitcher.recent_era === null
      ? pitcher.season_era
      : average([pitcher.season_era, pitcher.recent_era]);

  const projectedEr = round2(
    clamp(projectedIp * (blendedEra / 9) * opponentRunModifier * environmentModifier, 0, opponentRuns)
  );

  const projectedHits = round2(
    Math.max(projectedIp * pitcher.season_whip - projectedBb, 0)
  );

  return {
    player_id: pitcher.player_id,
    team_id: pitcherTeam.team_id,
    game_id: inputs.game_id,
    projected_ip: projectedIp,
    projected_ip_std: null,
    projected_k: projectedK,
    projected_k_std: null,
    projected_er: projectedEr,
    projected_er_std: null,
    projected_hits: projectedHits,
    projected_bb: projectedBb,
    win_probability: null,
    quality_start_probability: null
  };
};

export const projectPitchers = (inputs: PreparedGameInputs): PitcherProjectionResult => {
  if (inputs.blocked.is_blocked) {
    return buildBlocked(inputs.blocked.blocked_reason ?? "Prepared inputs are blocked");
  }

  if (!inputs.away_starter || !inputs.home_starter) {
    return buildBlocked("Both starting pitchers are required for baseline pitcher projections");
  }

  const teamRuns = projectTeamRuns(inputs);
  if (
    teamRuns.blocked.is_blocked ||
    teamRuns.projected_away_runs === null ||
    teamRuns.projected_home_runs === null
  ) {
    return buildBlocked(teamRuns.blocked.blocked_reason ?? "Team run projection failed");
  }

  const awayPitcher = buildPitcherProjection(
    inputs,
    inputs.away_starter,
    inputs.away_team,
    inputs.home_team,
    teamRuns.projected_home_runs
  );

  const homePitcher = buildPitcherProjection(
    inputs,
    inputs.home_starter,
    inputs.home_team,
    inputs.away_team,
    teamRuns.projected_away_runs
  );

  if (!awayPitcher || !homePitcher) {
    return buildBlocked("Missing required pitcher baseline fields for deterministic pitcher projections");
  }

  return {
    blocked: {
      is_blocked: false,
      blocked_reason: null
    },
    away_pitcher: awayPitcher,
    home_pitcher: homePitcher
  };
};
