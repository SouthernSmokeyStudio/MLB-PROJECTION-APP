import type { PreparedGameInputs } from "@lib/contracts/prepared";
import type { BlockedState } from "@lib/contracts/types";
import type { OddsFormat } from "@lib/market/odds";
import {
  buildTotalMarketEdgeFromSamples,
  buildTwoWayMarketEdgeFromOdds
} from "@lib/market/edge";
import { assembleGameProjection } from "@lib/projections/assembleGameProjection";
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
  readonly deterministic: {
    readonly derived_from: "deterministic";
    readonly projected_away_runs: number | null;
    readonly projected_home_runs: number | null;
    readonly projected_total: number | null;
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

type SimulatableGameProjectionInput = {
  readonly blocked?: BlockedState;
  readonly metadata?: {
    readonly blocked?: BlockedState;
  };
  readonly away: {
    readonly projected_runs: number;
  };
  readonly home: {
    readonly projected_runs: number;
  };
  readonly projected_total: number;
};

const readBlockedState = (
  preparedInputs: PreparedGameInputs,
  gameProjection: SimulatableGameProjectionInput
): BlockedState =>
  gameProjection.blocked ??
  gameProjection.metadata?.blocked ??
  preparedInputs.blocked;

const extractGameProjection = (
  preparedInputs: PreparedGameInputs
): SimulatableGameProjectionInput => {
  const assembled = assembleGameProjection(preparedInputs) as unknown as {
    readonly game_projection?: SimulatableGameProjectionInput;
    readonly game?: SimulatableGameProjectionInput;
  } & SimulatableGameProjectionInput;

  return assembled.game_projection ?? assembled.game ?? assembled;
};

export const buildGameCard = (
  preparedInputs: PreparedGameInputs,
  options: BuildGameCardOptions = {}
): GameCard => {
  const gameProjection = extractGameProjection(preparedInputs);
  const blocked = readBlockedState(preparedInputs, gameProjection);

  const simulations = blocked.is_blocked
    ? null
    : simulateGames(gameProjection, options.simulation);

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
    deterministic: {
      derived_from: "deterministic",
      projected_away_runs: blocked.is_blocked ? null : gameProjection.away.projected_runs,
      projected_home_runs: blocked.is_blocked ? null : gameProjection.home.projected_runs,
      projected_total: blocked.is_blocked ? null : gameProjection.projected_total
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
