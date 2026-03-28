import type { ActualFantasyOutcome, ActualGameOutcome } from "@lib/contracts/actuals";
import type { AssembledGameProjection } from "@lib/projections/assembleGameProjection";
import type { FantasyProjectionPackage } from "@lib/scoring/projectFantasyPoints";
import { summarizeErrorMetrics, type NumericErrorMetrics } from "./metrics";

export interface EvaluationResult {
  readonly game_runs: NumericErrorMetrics;
  readonly fantasy_points: NumericErrorMetrics;
}

export interface EvaluateProjectionInputs {
  readonly game_projection: AssembledGameProjection;
  readonly fantasy_projection: FantasyProjectionPackage;
  readonly game_actuals: ActualGameOutcome;
  readonly fantasy_actuals: readonly ActualFantasyOutcome[];
}

const fantasyKey = (value: {
  readonly player_id: string;
  readonly game_id: string;
  readonly platform: string;
  readonly contest_type: string;
}): string =>
  `${value.player_id}::${value.game_id}::${value.platform}::${value.contest_type}`;

export const evaluateProjections = (
  inputs: EvaluateProjectionInputs
): EvaluationResult => {
  const gameRows = inputs.game_actuals.is_complete
    ? [
        {
          projected: inputs.game_projection.game_projection.away.projected_runs,
          actual: inputs.game_actuals.away.runs
        },
        {
          projected: inputs.game_projection.game_projection.home.projected_runs,
          actual: inputs.game_actuals.home.runs
        },
        {
          projected: inputs.game_projection.game_projection.projected_total,
          actual: inputs.game_actuals.total_runs
        }
      ]
    : [
        { projected: inputs.game_projection.game_projection.away.projected_runs, actual: null, skipped: true },
        { projected: inputs.game_projection.game_projection.home.projected_runs, actual: null, skipped: true },
        { projected: inputs.game_projection.game_projection.projected_total, actual: null, skipped: true }
      ];

  const actualMap = new Map(
    inputs.fantasy_actuals.map((actual) => [fantasyKey(actual), actual.actual_points])
  );

  const fantasyRows =
    inputs.fantasy_projection.blocked.is_blocked
      ? [
          { projected: null, actual: null, skipped: true }
        ]
      : [
          ...inputs.fantasy_projection.pitcher_fantasy_points,
          ...inputs.fantasy_projection.batter_fantasy_points
        ].map((projection) => {
          const key = fantasyKey(projection);
          const actual = actualMap.get(key);

          return {
            projected: projection.projected_points,
            actual: actual ?? null,
            skipped: actual === undefined
          };
        });

  return {
    game_runs: summarizeErrorMetrics(gameRows),
    fantasy_points: summarizeErrorMetrics(fantasyRows)
  };
};
