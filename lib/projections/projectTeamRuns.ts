import type { PreparedGameInputs } from "@lib/contracts/prepared";
import type { BlockedState } from "@lib/contracts/types";

export interface TeamRunsProjectionResult {
  readonly blocked: BlockedState;
  readonly projected_away_runs: number | null;
  readonly projected_home_runs: number | null;
  readonly projected_total_runs: number | null;
}

const BASE_LEAGUE_RUNS_PER_GAME = 4.6;
const BASE_LEAGUE_WOBA = 0.32;
const BASE_LEAGUE_ERA = 4.2;
const BASE_LEAGUE_BULLPEN_ERA = 4.1;

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);
const round2 = (value: number): number => Math.round(value * 100) / 100;
const average = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;

const buildBlocked = (reason: string): TeamRunsProjectionResult => ({
  blocked: {
    is_blocked: true,
    blocked_reason: reason
  },
  projected_away_runs: null,
  projected_home_runs: null,
  projected_total_runs: null
});

const computeTeamOffenseFactor = (
  teamRunsPerGame: number,
  teamWoba: number,
  lineupAvgWoba: number | null
): number => {
  const lineupComponent = lineupAvgWoba ?? teamWoba;

  return clamp(
    average([
      teamRunsPerGame / BASE_LEAGUE_RUNS_PER_GAME,
      teamWoba / BASE_LEAGUE_WOBA,
      lineupComponent / BASE_LEAGUE_WOBA
    ]),
    0.75,
    1.35
  );
};

const computePitchingFactor = (seasonEra: number, recentEra: number | null): number => {
  const blendedEra = recentEra === null ? seasonEra : average([seasonEra, recentEra]);
  return clamp(blendedEra / BASE_LEAGUE_ERA, 0.7, 1.35);
};

const computeBullpenFactor = (bullpenEra: number): number =>
  clamp(bullpenEra / BASE_LEAGUE_BULLPEN_ERA, 0.75, 1.3);

const computeWeatherRunFactor = (inputs: PreparedGameInputs): number => {
  if (!inputs.weather || inputs.weather.is_enclosed) {
    return 1;
  }

  const temperature = inputs.weather.temperature_f ?? 72;
  const windSpeed = inputs.weather.wind_speed_mph ?? 0;
  const windDirection = inputs.weather.wind_direction_normalized;

  const temperatureFactor = clamp(1 + ((temperature - 72) / 10) * 0.01, 0.94, 1.06);

  let windFactor = 1;
  if (windDirection === "out") {
    windFactor += clamp(windSpeed, 0, 20) * 0.004;
  } else if (windDirection === "in") {
    windFactor -= clamp(windSpeed, 0, 20) * 0.004;
  }

  return clamp(temperatureFactor * windFactor, 0.9, 1.1);
};

export const projectTeamRuns = (inputs: PreparedGameInputs): TeamRunsProjectionResult => {
  if (inputs.blocked.is_blocked) {
    return buildBlocked(inputs.blocked.blocked_reason ?? "Prepared inputs are blocked");
  }

  if (!inputs.away_starter || !inputs.home_starter) {
    return buildBlocked("Both starting pitchers are required for team run projections");
  }

  if (inputs.venue === null || inputs.venue.park_factor_runs === null) {
    return buildBlocked("Venue park_factor_runs is required for team run projections");
  }

  if (
    inputs.away_team.team_runs_per_game === null ||
    inputs.away_team.team_woba === null ||
    inputs.home_team.team_runs_per_game === null ||
    inputs.home_team.team_woba === null ||
    inputs.away_team.bullpen_era === null ||
    inputs.home_team.bullpen_era === null ||
    inputs.away_starter.season_era === null ||
    inputs.home_starter.season_era === null
  ) {
    return buildBlocked("Missing required team or pitcher baseline fields for run projections");
  }

  const parkFactor = clamp(inputs.venue.park_factor_runs, 0.85, 1.2);
  const weatherFactor = computeWeatherRunFactor(inputs);

  const awayRuns =
    BASE_LEAGUE_RUNS_PER_GAME *
    computeTeamOffenseFactor(
      inputs.away_team.team_runs_per_game,
      inputs.away_team.team_woba,
      inputs.away_team.lineup_avg_woba
    ) *
    computePitchingFactor(inputs.home_starter.season_era, inputs.home_starter.recent_era) *
    computeBullpenFactor(inputs.home_team.bullpen_era) *
    parkFactor *
    weatherFactor;

  const homeRuns =
    BASE_LEAGUE_RUNS_PER_GAME *
    computeTeamOffenseFactor(
      inputs.home_team.team_runs_per_game,
      inputs.home_team.team_woba,
      inputs.home_team.lineup_avg_woba
    ) *
    computePitchingFactor(inputs.away_starter.season_era, inputs.away_starter.recent_era) *
    computeBullpenFactor(inputs.away_team.bullpen_era) *
    parkFactor *
    weatherFactor;

  const projectedAwayRuns = round2(clamp(awayRuns, 0, 15));
  const projectedHomeRuns = round2(clamp(homeRuns, 0, 15));

  return {
    blocked: {
      is_blocked: false,
      blocked_reason: null
    },
    projected_away_runs: projectedAwayRuns,
    projected_home_runs: projectedHomeRuns,
    projected_total_runs: round2(projectedAwayRuns + projectedHomeRuns)
  };
};
