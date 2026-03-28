import type { PlayerFantasyProjection } from "@lib/contracts/projections";
import type { BlockedState } from "@lib/contracts/types";
import { sampleTruncatedNormal } from "./distributions";
import { createSeededRng } from "./random";

export interface SimulatedFantasyPlayerSummary {
  readonly player_id: string;
  readonly team_id: string;
  readonly game_id: string;
  readonly iterations: number;
  readonly mean_points: number;
  readonly simulated_floor: number;
  readonly simulated_ceiling: number;
}

export interface SimulatedFantasyResult {
  readonly blocked: BlockedState;
  readonly seed: number;
  readonly iterations: number;
  readonly pitcher_summaries: readonly SimulatedFantasyPlayerSummary[];
  readonly batter_summaries: readonly SimulatedFantasyPlayerSummary[];
}

export interface SimulateFantasyOptions {
  readonly seed?: number;
  readonly iterations?: number;
}

type FantasyProjectionCollection = {
  readonly blocked: BlockedState;
  readonly pitcher_fantasy_points: readonly PlayerFantasyProjection[];
  readonly batter_fantasy_points: readonly PlayerFantasyProjection[];
};

const DEFAULT_SEED = 1;
const DEFAULT_ITERATIONS = 1000;

const round4 = (value: number): number => Math.round(value * 10000) / 10000;

const buildBlocked = (
  reason: string,
  seed: number,
  iterations: number
): SimulatedFantasyResult => ({
  blocked: {
    is_blocked: true,
    blocked_reason: reason
  },
  seed,
  iterations,
  pitcher_summaries: [],
  batter_summaries: []
});

const sortAscending = (values: readonly number[]): readonly number[] => [...values].sort((a, b) => a - b);

const percentile = (values: readonly number[], quantile: number): number => {
  if (values.length === 0) {
    return 0;
  }

  const sorted = sortAscending(values);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((sorted.length - 1) * quantile))
  );

  return sorted[index] ?? 0;
};

const inferStdDev = (projection: PlayerFantasyProjection): number => {
  if (projection.projected_points_std !== null && projection.projected_points_std > 0) {
    return projection.projected_points_std;
  }

  if (projection.ceiling !== null && projection.floor !== null && projection.ceiling >= projection.floor) {
    const inferred = (projection.ceiling - projection.floor) / 4;
    if (inferred > 0) {
      return inferred;
    }
  }

  return Math.max(1, projection.projected_points * 0.2);
};

const simulateProjection = (
  projections: readonly PlayerFantasyProjection[],
  iterations: number,
  seed: number
): readonly SimulatedFantasyPlayerSummary[] => {
  return projections.map((projection, index) => {
    const rng = createSeededRng(seed + index + 1);
    const stdDev = inferStdDev(projection);
    const floor = Math.max(0, projection.floor ?? 0);
    const ceiling = Math.max(floor, projection.ceiling ?? projection.projected_points + stdDev * 2);

    const samples: number[] = [];
    for (let i = 0; i < iterations; i += 1) {
      samples.push(
        sampleTruncatedNormal(
          rng,
          projection.projected_points,
          stdDev,
          floor,
          ceiling
        )
      );
    }

    const meanPoints = samples.reduce((sum, value) => sum + value, 0) / samples.length;

    return {
      player_id: projection.player_id,
      team_id: projection.team_id,
      game_id: projection.game_id,
      iterations,
      mean_points: round4(meanPoints),
      simulated_floor: round4(percentile(samples, 0.1)),
      simulated_ceiling: round4(percentile(samples, 0.9))
    };
  });
};

export const simulateFantasy = (
  fantasy: FantasyProjectionCollection,
  options: SimulateFantasyOptions = {}
): SimulatedFantasyResult => {
  const seed = options.seed ?? DEFAULT_SEED;
  const iterations = options.iterations ?? DEFAULT_ITERATIONS;

  if (!Number.isInteger(iterations) || iterations <= 0) {
    throw new Error("iterations must be a positive integer");
  }

  if (fantasy.blocked.is_blocked) {
    return buildBlocked(fantasy.blocked.blocked_reason ?? "Fantasy projection input is blocked", seed, iterations);
  }

  return {
    blocked: {
      is_blocked: false,
      blocked_reason: null
    },
    seed,
    iterations,
    pitcher_summaries: simulateProjection(fantasy.pitcher_fantasy_points, iterations, seed),
    batter_summaries: simulateProjection(fantasy.batter_fantasy_points, iterations, seed + 100000)
  };
};
