import type {
  BatterProjection,
  GameProjection,
  PitcherProjection,
  ProjectionMetadata
} from "@lib/contracts/projections";
import type { PreparedGameInputs } from "@lib/contracts/prepared";
import { asRunId } from "@lib/contracts/types";
import { projectBatters } from "./projectBatters";
import { projectPitchers } from "./projectPitchers";
import { projectTeamRuns } from "./projectTeamRuns";

export interface AssembledGameProjection {
  readonly game_projection: GameProjection;
  readonly away_pitcher: PitcherProjection | null;
  readonly home_pitcher: PitcherProjection | null;
  readonly away_batters: readonly BatterProjection[];
  readonly home_batters: readonly BatterProjection[];
  /**
   * True when the team run engine itself failed (missing park factor, starters,
   * or team stats). In this case projected_runs === 0 and simulation must not run.
   * Distinct from metadata.blocked, which can be true for batter-only reasons
   * while team-level numbers remain valid.
   */
  readonly team_runs_blocked: boolean;
}

const PROJECTION_VERSION = {
  model_version: "phase4-baseline-v1",
  feature_set_version: "phase4-baseline-v1",
  scoring_version: "not-applicable",
  data_version: "phase3-prepared-inputs-v1"
} as const;

const buildMetadata = (inputs: PreparedGameInputs, blockedReason: string | null): ProjectionMetadata => ({
  run_id: asRunId(`phase4-${inputs.game_id}`),
  projected_at: inputs.prepared_at,
  version: PROJECTION_VERSION,
  model_confidence: null,
  sources_used: ["prepared_game_inputs"],
  blocked: {
    is_blocked: blockedReason !== null,
    blocked_reason: blockedReason
  }
});

export const assembleGameProjection = (inputs: PreparedGameInputs): AssembledGameProjection => {
  const teamRuns = projectTeamRuns(inputs);
  const pitcherProjection = projectPitchers(inputs, teamRuns);
  const batterProjection = projectBatters(inputs, teamRuns);

  const blockedReason =
    (teamRuns.blocked.is_blocked ? teamRuns.blocked.blocked_reason : null) ??
    (pitcherProjection.blocked.is_blocked ? pitcherProjection.blocked.blocked_reason : null) ??
    (batterProjection.blocked.is_blocked ? batterProjection.blocked.blocked_reason : null) ??
    null;

  const awayRuns = teamRuns.projected_away_runs ?? 0;
  const homeRuns = teamRuns.projected_home_runs ?? 0;

  return {
    game_projection: {
      game_id: inputs.game_id,
      sport_id: inputs.sport_id,
      metadata: buildMetadata(inputs, blockedReason),
      away: {
        team_id: inputs.away_team.team_id,
        projected_runs: awayRuns,
        projected_runs_std: null,
        win_probability: null
      },
      home: {
        team_id: inputs.home_team.team_id,
        projected_runs: homeRuns,
        projected_runs_std: null,
        win_probability: null
      },
      projected_total: teamRuns.projected_total_runs ?? 0,
      projected_total_std: null,
      over_probability: null,
      under_probability: null
    },
    away_pitcher: pitcherProjection.away_pitcher,
    home_pitcher: pitcherProjection.home_pitcher,
    away_batters: batterProjection.away_batters,
    home_batters: batterProjection.home_batters,
    team_runs_blocked: teamRuns.blocked.is_blocked
  };
};
