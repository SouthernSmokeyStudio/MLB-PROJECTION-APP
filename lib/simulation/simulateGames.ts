import type { BlockedState } from "@lib/contracts/types";
import { sampleBernoulli, samplePoisson } from "./distributions";
import { createSeededRng } from "./random";

export interface SimulatedGameSample {
  readonly away_runs: number;
  readonly home_runs: number;
  readonly total_runs: number;
  readonly away_win: boolean;
  readonly home_win: boolean;
}

export interface SimulatedGamesResult {
  readonly blocked: BlockedState;
  readonly seed: number;
  readonly iterations: number;
  readonly samples: readonly SimulatedGameSample[];
  readonly away_win_probability: number | null;
  readonly home_win_probability: number | null;
  readonly average_away_runs: number | null;
  readonly average_home_runs: number | null;
  readonly average_total_runs: number | null;
}

export interface SimulateGamesOptions {
  readonly seed?: number;
  readonly iterations?: number;
  readonly extra_innings?: number;
}

export interface SimulatableTeamProjection {
  readonly projected_runs: number;
}

type SimulatableGameProjection = {
  readonly away: SimulatableTeamProjection;
  readonly home: SimulatableTeamProjection;
  readonly projected_total: number;
  readonly metadata?: {
    readonly blocked?: BlockedState;
  };
  readonly blocked?: BlockedState;
};

const DEFAULT_ITERATIONS = 1000;
const DEFAULT_SEED = 1;
const DEFAULT_EXTRA_INNINGS = 3;

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);
const round4 = (value: number): number => Math.round(value * 10000) / 10000;

const buildBlocked = (
  reason: string,
  seed: number,
  iterations: number
): SimulatedGamesResult => ({
  blocked: {
    is_blocked: true,
    blocked_reason: reason
  },
  seed,
  iterations,
  samples: [],
  away_win_probability: null,
  home_win_probability: null,
  average_away_runs: null,
  average_home_runs: null,
  average_total_runs: null
});

const readBlockedState = (projection: SimulatableGameProjection): BlockedState => {
  return projection.blocked ?? projection.metadata?.blocked ?? {
    is_blocked: false,
    blocked_reason: null
  };
};

export const simulateGames = (
  projection: SimulatableGameProjection,
  options: SimulateGamesOptions = {}
): SimulatedGamesResult => {
  const seed = options.seed ?? DEFAULT_SEED;
  const iterations = options.iterations ?? DEFAULT_ITERATIONS;
  const extraInnings = options.extra_innings ?? DEFAULT_EXTRA_INNINGS;

  if (!Number.isInteger(iterations) || iterations <= 0) {
    throw new Error("iterations must be a positive integer");
  }

  if (!Number.isInteger(extraInnings) || extraInnings < 0) {
    throw new Error("extra_innings must be a non-negative integer");
  }

  const blocked = readBlockedState(projection);
  if (blocked.is_blocked) {
    return buildBlocked(blocked.blocked_reason ?? "Game projection is blocked", seed, iterations);
  }

  const awayMean = clamp(projection.away.projected_runs, 0.01, 25);
  const homeMean = clamp(projection.home.projected_runs, 0.01, 25);
  const rng = createSeededRng(seed);
  const samples: SimulatedGameSample[] = [];

  let awayWins = 0;
  let homeWins = 0;
  let awayRunsSum = 0;
  let homeRunsSum = 0;
  let totalRunsSum = 0;

  for (let i = 0; i < iterations; i += 1) {
    let awayRuns = samplePoisson(rng, awayMean);
    let homeRuns = samplePoisson(rng, homeMean);

    if (awayRuns === homeRuns) {
      const awayExtraMean = Math.max(awayMean / 18, 0.05);
      const homeExtraMean = Math.max(homeMean / 18, 0.05);

      for (let inning = 0; inning < extraInnings && awayRuns === homeRuns; inning += 1) {
        awayRuns += samplePoisson(rng, awayExtraMean);
        homeRuns += samplePoisson(rng, homeExtraMean);
      }

      if (awayRuns === homeRuns) {
        const awayBias = awayMean / (awayMean + homeMean);
        if (sampleBernoulli(rng, awayBias)) {
          awayRuns += 1;
        } else {
          homeRuns += 1;
        }
      }
    }

    const awayWin = awayRuns > homeRuns;
    const homeWin = !awayWin;
    const totalRuns = awayRuns + homeRuns;

    if (awayWin) {
      awayWins += 1;
    } else {
      homeWins += 1;
    }

    awayRunsSum += awayRuns;
    homeRunsSum += homeRuns;
    totalRunsSum += totalRuns;

    samples.push({
      away_runs: awayRuns,
      home_runs: homeRuns,
      total_runs: totalRuns,
      away_win: awayWin,
      home_win: homeWin
    });
  }

  return {
    blocked: {
      is_blocked: false,
      blocked_reason: null
    },
    seed,
    iterations,
    samples,
    away_win_probability: round4(awayWins / iterations),
    home_win_probability: round4(homeWins / iterations),
    average_away_runs: round4(awayRunsSum / iterations),
    average_home_runs: round4(homeRunsSum / iterations),
    average_total_runs: round4(totalRunsSum / iterations)
  };
};
