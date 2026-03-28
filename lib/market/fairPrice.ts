import { decimalOddsToAmerican, type OddsFormat } from "./odds";

export const assertModelProbability = (probability: number): number => {
  if (!Number.isFinite(probability) || probability <= 0 || probability >= 1) {
    throw new Error("Model probability must be finite and strictly between 0 and 1");
  }

  return probability;
};

export const probabilityToFairDecimalOdds = (probability: number): number => {
  const normalized = assertModelProbability(probability);
  return 1 / normalized;
};

export const probabilityToFairAmericanOdds = (probability: number): number => {
  return decimalOddsToAmerican(probabilityToFairDecimalOdds(probability));
};

export const probabilityToFairPrice = (
  probability: number,
  format: OddsFormat = "american"
): number => {
  return format === "american"
    ? probabilityToFairAmericanOdds(probability)
    : probabilityToFairDecimalOdds(probability);
};
