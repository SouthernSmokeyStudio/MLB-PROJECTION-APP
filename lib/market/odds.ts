export type OddsFormat = "american" | "decimal";

export const isAmericanOdds = (value: number): boolean =>
  Number.isFinite(value) && Number.isInteger(value) && value !== 0 && Math.abs(value) >= 100;

export const assertAmericanOdds = (value: number): number => {
  if (!isAmericanOdds(value)) {
    throw new Error("American odds must be an integer with absolute value of at least 100 and cannot be 0");
  }

  return value;
};

export const assertDecimalOdds = (value: number): number => {
  if (!Number.isFinite(value) || value <= 1) {
    throw new Error("Decimal odds must be finite and greater than 1");
  }

  return value;
};

export const americanOddsToDecimal = (odds: number): number => {
  const normalized = assertAmericanOdds(odds);
  return normalized > 0 ? 1 + normalized / 100 : 1 + 100 / Math.abs(normalized);
};

export const decimalOddsToAmerican = (decimalOdds: number): number => {
  const normalized = assertDecimalOdds(decimalOdds);

  if (normalized >= 2) {
    return Math.round((normalized - 1) * 100);
  }

  return -Math.round(100 / (normalized - 1));
};
