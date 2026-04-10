import type { ProjectionLineage } from "@lib/contracts/projection-lineage";
import type { PreparedGameInputs } from "@lib/contracts/prepared";
import type { BlockedState } from "@lib/contracts/types";
import { createProjectionLineage } from "@lib/contracts/projection-lineage";
import type { OddsFormat } from "@lib/market/odds";
import {
  buildTotalMarketEdgeFromSamples,
  buildTwoWayMarketEdgeFromOdds
} from "@lib/market/edge";
import {
  assembleGameProjection,
  type AssembledGameProjection
} from "@lib/projections/assembleGameProjection";
import type { PitcherProjection } from "@lib/contracts/projections";
import { simulateGames } from "@lib/simulation/simulateGames";

export interface GameCardMarketInput {
  readonly format?: OddsFormat;
  readonly moneyline?: {
    readonly away_odds: number;
    readonly home_odds: number;
  };
  readonly total?: {
    readonly line: number;
    readonly over_odds: number;
    readonly under_odds: number;
  };
}

export interface BuildGameCardOptions {
  readonly market?: GameCardMarketInput;
  readonly simulation?: {
    readonly seed?: number;
    readonly iterations?: number;
  };
}

export interface GameCard {
  readonly game_id: string;
  readonly away_team_id: string;
  readonly home_team_id: string;
  readonly projection_lineage: ProjectionLineage;
  readonly deterministic: {
    readonly derived_from: "deterministic";
    readonly projected_away_runs: number | null;
    readonly projected_home_runs: number | null;
    readonly projected_total: number | null;
    readonly away_pitcher: PitcherProjection | null;
    readonly home_pitcher: PitcherProjection | null;
  };
  readonly simulation: {
    readonly derived_from: "simulation";
    readonly away_win_probability: number | null;
    readonly home_win_probability: number | null;
    readonly average_away_runs: number | null;
    readonly average_home_runs: number | null;
    readonly average_total_runs: number | null;
  } | null;
  readonly market: {
    readonly derived_from: "market";
    readonly moneyline: {
      readonly away: ReturnType<typeof buildTwoWayMarketEdgeFromOdds>;
      readonly home: ReturnType<typeof buildTwoWayMarketEdgeFromOdds>;
    } | null;
    readonly total: {
      readonly over: ReturnType<typeof buildTotalMarketEdgeFromSamples>;
      readonly under: ReturnType<typeof buildTotalMarketEdgeFromSamples>;
    } | null;
  } | null;
  readonly evaluation: null;
  readonly blocked: BlockedState;
}

const readBlockedState = (
  preparedInputs: PreparedGameInputs,
  gameProjection: AssembledGameProjection["game_projection"]
): BlockedState => gameProjection.metadata.blocked ?? preparedInputs.blocked;


export const buildGameCard = (
  preparedInputs: PreparedGameInputs,
  options: BuildGameCardOptions = {}
): GameCard => {
  const assembled = assembleGameProjection(preparedInputs);
  const gameProjection = assembled.game_projection;
  const blocked = readBlockedState(preparedInputs, gameProjection);
  const projectionLineage = createProjectionLineage({
    game_id: preparedInputs.game_id,
    prepared_at: preparedInputs.prepared_at,
    metadata: gameProjection.metadata
  });

  // When team_level_ready is true, strip the metadata.blocked from the game
  // projection before passing to simulateGames.  The combined metadata.blocked
  // includes batter-level reasons that are irrelevant for team-level simulation.
  const simulations = preparedInputs.team_level_ready
    ? simulateGames(
        {
          away: gameProjection.away,
          home: gameProjection.home,
          projected_total: gameProjection.projected_total
        },
        options.simulation
      )
    : null;

  const moneyline = options.market?.moneyline && simulations
    ? {
        away: buildTwoWayMarketEdgeFromOdds(
          simulations.away_win_probability ?? 0,
          options.market.moneyline.away_odds,
          options.market.moneyline.home_odds,
          options.market.format ?? "american"
        ),
        home: buildTwoWayMarketEdgeFromOdds(
          simulations.home_win_probability ?? 0,
          options.market.moneyline.home_odds,
          options.market.moneyline.away_odds,
          options.market.format ?? "american"
        )
      }
    : null;

  const total = options.market?.total && simulations
    ? {
        over: buildTotalMarketEdgeFromSamples(
          simulations.samples,
          options.market.total.line,
          "over",
          options.market.total.over_odds,
          options.market.format ?? "american"
        ),
        under: buildTotalMarketEdgeFromSamples(
          simulations.samples,
          options.market.total.line,
          "under",
          options.market.total.under_odds,
          options.market.format ?? "american"
        )
      }
    : null;

  return {
    game_id: preparedInputs.game_id,
    away_team_id: preparedInputs.away_team.team_id,
    home_team_id: preparedInputs.home_team.team_id,
    projection_lineage: projectionLineage,
    deterministic: {
      derived_from: "deterministic",
      projected_away_runs: preparedInputs.team_level_ready ? gameProjection.away.projected_runs : null,
      projected_home_runs: preparedInputs.team_level_ready ? gameProjection.home.projected_runs : null,
      projected_total: preparedInputs.team_level_ready ? gameProjection.projected_total : null,
      away_pitcher: preparedInputs.team_level_ready ? assembled.away_pitcher : null,
      home_pitcher: preparedInputs.team_level_ready ? assembled.home_pitcher : null
    },
    simulation: simulations
      ? {
          derived_from: "simulation",
          away_win_probability: simulations.away_win_probability,
          home_win_probability: simulations.home_win_probability,
          average_away_runs: simulations.average_away_runs,
          average_home_runs: simulations.average_home_runs,
          average_total_runs: simulations.average_total_runs
        }
      : null,
    market: moneyline || total
      ? {
          derived_from: "market",
          moneyline,
          total
        }
      : null,
    evaluation: null,
    blocked
  };
};
