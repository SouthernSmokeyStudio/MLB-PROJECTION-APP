export interface RandomSource {
  readonly seed: number;
  next(): number;
  nextInt(maxExclusive: number): number;
}

const normalizeSeed = (seed: number): number => {
  if (!Number.isFinite(seed)) {
    return 1;
  }

  const normalized = Math.trunc(seed) >>> 0;
  return normalized === 0 ? 1 : normalized;
};

export const createSeededRng = (seed: number): RandomSource => {
  let state = normalizeSeed(seed);

  const nextUint32 = (): number => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };

  return {
    seed: normalizeSeed(seed),
    next(): number {
      return nextUint32() / 4294967296;
    },
    nextInt(maxExclusive: number): number {
      if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
        throw new Error("maxExclusive must be a positive integer");
      }

      return Math.floor(this.next() * maxExclusive);
    }
  };
};
