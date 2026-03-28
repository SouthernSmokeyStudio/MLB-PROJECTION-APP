import type { RandomSource } from "./random";

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

export const sampleBernoulli = (rng: RandomSource, probability: number): boolean => {
  const p = clamp(probability, 0, 1);
  return rng.next() < p;
};

export const sampleStandardNormal = (rng: RandomSource): number => {
  let u1 = 0;
  while (u1 <= Number.EPSILON) {
    u1 = rng.next();
  }

  const u2 = rng.next();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
};

export const sampleNormal = (
  rng: RandomSource,
  mean: number,
  stdDev: number
): number => {
  if (!Number.isFinite(mean)) {
    throw new Error("mean must be finite");
  }

  if (!Number.isFinite(stdDev) || stdDev <= 0) {
    return mean;
  }

  return mean + sampleStandardNormal(rng) * stdDev;
};

export const sampleTruncatedNormal = (
  rng: RandomSource,
  mean: number,
  stdDev: number,
  min: number,
  max: number
): number => {
  if (min > max) {
    throw new Error("min cannot be greater than max");
  }

  if (!Number.isFinite(stdDev) || stdDev <= 0) {
    return clamp(mean, min, max);
  }

  for (let i = 0; i < 8; i += 1) {
    const sampled = sampleNormal(rng, mean, stdDev);
    if (sampled >= min && sampled <= max) {
      return sampled;
    }
  }

  return clamp(sampleNormal(rng, mean, stdDev), min, max);
};

export const samplePoisson = (rng: RandomSource, lambda: number): number => {
  const rate = Math.max(lambda, 0);

  if (rate === 0) {
    return 0;
  }

  if (rate < 30) {
    const limit = Math.exp(-rate);
    let k = 0;
    let product = 1;

    do {
      k += 1;
      product *= rng.next();
    } while (product > limit);

    return k - 1;
  }

  const approximated = Math.round(sampleNormal(rng, rate, Math.sqrt(rate)));
  return Math.max(0, approximated);
};
