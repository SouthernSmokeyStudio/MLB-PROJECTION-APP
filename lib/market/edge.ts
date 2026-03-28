import type { SimulatedGameSample } from "@lib/simulation/simulateGames";
import { probabilityToFairAmericanOdds, probabilityToFairDecimalOdds } from "./fairPrice";
import {
  deriveTwoWayMarketImpliedProbabilities,
  oddsToImpliedProbability
} from "./implied";
import type { OddsFormat } from "./odds";

const assertProbability = (probability: number): number => {
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new Error("Probability must be finite and between 0 and 1");
  }

  return probability;
};

const round6 = (value: number): number => Math.round(value * 1000000) / 1000000;

export interface MarketEdge {
  readonly market_implied_probability: number;
  readonly model_probability: number;
  readonly raw_edge: number;
  readonly fair_american_odds: number;
  readonly fair_decimal_odds: number;
}

export interface TwoWayMarketEdge extends MarketEdge {
  readonly market_no_vig_probability: number;
  readonly no_vig_edge: number;
}

export interface TotalDistributionSummary {
  readonly line: number;
  readonly over_probability: number;
  readonly under_probability: number;
  readonly push_probability: number;
}

export interface TotalMarketEdge extends MarketEdge {
  readonly line: number;
  readonly side: "over" | "under";
  readonly push_probability: number;
}

export const compareMarketProbability = (
  modelProbability: number,
  marketProbability: number
): MarketEdge => {
  const normalizedModel = assertProbability(modelProbability);
  const normalizedMarket = assertProbability(marketProbability);

  return {
    market_implied_probability: round6(normalizedMarket),
    model_probability: round6(normalizedModel),
    raw_edge: round6(normalizedModel - normalizedMarket),
    fair_american_odds: probabilityToFairAmericanOdds(normalizedModel),
    fair_decimal_odds: round6(probabilityToFairDecimalOdds(normalizedModel))
  };
};

export const buildMarketEdgeFromOdds = (
  modelProbability: number,
  marketOdds: number,
  format: OddsFormat = "american"
): MarketEdge => {
  return compareMarketProbability(
    modelProbability,
    oddsToImpliedProbability(marketOdds, format)
  );
};

export const buildTwoWayMarketEdgeFromOdds = (
  modelProbability: number,
  targetMarketOdds: number,
  opposingMarketOdds: number,
  format: OddsFormat = "american"
): TwoWayMarketEdge => {
  const base = buildMarketEdgeFromOdds(modelProbability, targetMarketOdds, format);
  const twoWay = deriveTwoWayMarketImpliedProbabilities(
    targetMarketOdds,
    opposingMarketOdds,
    format
  );

  return {
    ...base,
    market_no_vig_probability: round6(twoWay.market_a_no_vig_probability),
    no_vig_edge: round6(assertProbability(modelProbability) - twoWay.market_a_no_vig_probability)
  };
};

export const summarizeTotalDistribution = (
  samples: readonly SimulatedGameSample[],
  line: number
): TotalDistributionSummary => {
  if (samples.length === 0) {
    throw new Error("At least one simulation sample is required");
  }

  if (!Number.isFinite(line)) {
    throw new Error("Total line must be finite");
  }

  const overCount = samples.filter((sample) => sample.total_runs > line).length;
  const underCount = samples.filter((sample) => sample.total_runs < line).length;
  const pushCount = samples.length - overCount - underCount;

  return {
    line,
    over_probability: round6(overCount / samples.length),
    under_probability: round6(underCount / samples.length),
    push_probability: round6(pushCount / samples.length)
  };
};

export const buildTotalMarketEdgeFromSamples = (
  samples: readonly SimulatedGameSample[],
  line: number,
  side: "over" | "under",
  marketOdds: number,
  format: OddsFormat = "american"
): TotalMarketEdge => {
  const summary = summarizeTotalDistribution(samples, line);
  const modelProbability = side === "over"
    ? summary.over_probability
    : summary.under_probability;
  const base = buildMarketEdgeFromOdds(modelProbability, marketOdds, format);

  return {
    ...base,
    line,
    side,
    push_probability: summary.push_probability
  };
};
