import {
  americanOddsToDecimal,
  assertAmericanOdds,
  assertDecimalOdds,
  type OddsFormat
} from "./odds";

const assertProbability = (value: number): number => {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error("Probability must be finite and between 0 and 1");
  }

  return value;
};

export const americanOddsToImpliedProbability = (odds: number): number => {
  const normalized = assertAmericanOdds(odds);
  return normalized > 0
    ? 100 / (normalized + 100)
    : Math.abs(normalized) / (Math.abs(normalized) + 100);
};

export const decimalOddsToImpliedProbability = (decimalOdds: number): number => {
  const normalized = assertDecimalOdds(decimalOdds);
  return 1 / normalized;
};

export const oddsToImpliedProbability = (
  odds: number,
  format: OddsFormat = "american"
): number => {
  return format === "american"
    ? americanOddsToImpliedProbability(odds)
    : decimalOddsToImpliedProbability(odds);
};

export const normalizeImpliedProbabilities = (
  probabilities: readonly number[]
): readonly number[] => {
  if (probabilities.length === 0) {
    throw new Error("At least one implied probability is required");
  }

  const validated = probabilities.map(assertProbability);
  const total = validated.reduce((sum, value) => sum + value, 0);

  if (total <= 0) {
    throw new Error("Probability total must be greater than 0");
  }

  return validated.map((value) => value / total);
};

export interface TwoWayMarketImpliedProbabilities {
  readonly market_a_implied_probability: number;
  readonly market_b_implied_probability: number;
  readonly market_a_no_vig_probability: number;
  readonly market_b_no_vig_probability: number;
}

export const deriveTwoWayMarketImpliedProbabilities = (
  marketAOdds: number,
  marketBOdds: number,
  format: OddsFormat = "american"
): TwoWayMarketImpliedProbabilities => {
  const marketAImplied = oddsToImpliedProbability(marketAOdds, format);
  const marketBImplied = oddsToImpliedProbability(marketBOdds, format);
  const [marketANoVig, marketBNoVig] = normalizeImpliedProbabilities([
    marketAImplied,
    marketBImplied
  ]);

  return {
    market_a_implied_probability: marketAImplied,
    market_b_implied_probability: marketBImplied,
    market_a_no_vig_probability: marketANoVig ?? 0,
    market_b_no_vig_probability: marketBNoVig ?? 0
  };
};

export const decimalToImpliedProbability = decimalOddsToImpliedProbability;
export const americanToImpliedProbability = americanOddsToImpliedProbability;
export const americanToDecimalToImpliedProbability = (odds: number): number =>
  decimalOddsToImpliedProbability(americanOddsToDecimal(odds));
