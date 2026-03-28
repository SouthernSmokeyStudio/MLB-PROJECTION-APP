import { describe, expect, it } from "vitest";
import preparedFixture from "../../data/fixtures/sample-prepared-game.json";
import type { PreparedGameInputs } from "../../lib/contracts/prepared";
import {
  buildMarketEdgeFromOdds,
  buildTotalMarketEdgeFromSamples,
  summarizeTotalDistribution
} from "../../lib/market/edge";
import { assembleGameProjection } from "../../lib/projections/assembleGameProjection";
import { simulateGames } from "../../lib/simulation/simulateGames";

const prepared = preparedFixture as unknown as PreparedGameInputs;

type SimulatableGameProjectionInput = {
  readonly blocked?: { readonly is_blocked: boolean; readonly blocked_reason: string | null };
  readonly metadata?: {
    readonly blocked?: { readonly is_blocked: boolean; readonly blocked_reason: string | null };
  };
  readonly away: { readonly projected_runs: number };
  readonly home: { readonly projected_runs: number };
  readonly projected_total: number;
};

const extractGameProjection = (
  preparedInputs: PreparedGameInputs
): SimulatableGameProjectionInput => {
  const assembled = assembleGameProjection(preparedInputs) as unknown as {
    readonly game_projection?: SimulatableGameProjectionInput;
    readonly game?: SimulatableGameProjectionInput;
  } & SimulatableGameProjectionInput;

  return assembled.game_projection ?? assembled.game ?? assembled;
};

describe("simulation -> market edge integration", () => {
  it("translates simulated moneyline probability into explicit market edge", () => {
    const gameProjection = extractGameProjection(prepared);

    const simulations = simulateGames(gameProjection, {
      seed: 20260328,
      iterations: 500
    });

    expect(simulations.blocked.is_blocked).toBe(false);
    expect(simulations.away_win_probability).not.toBeNull();

    const awayEdge = buildMarketEdgeFromOdds(
      simulations.away_win_probability ?? 0,
      110
    );

    expect(awayEdge.model_probability).toBeGreaterThanOrEqual(0);
    expect(awayEdge.model_probability).toBeLessThanOrEqual(1);
    expect(awayEdge.market_implied_probability).toBeCloseTo(0.476190, 5);
    expect(Number.isFinite(awayEdge.raw_edge)).toBe(true);
    expect(Number.isInteger(awayEdge.fair_american_odds)).toBe(true);
  });

  it("translates simulated total-run distribution into explicit total edge", () => {
    const gameProjection = extractGameProjection(prepared);

    const simulations = simulateGames(gameProjection, {
      seed: 17,
      iterations: 500
    });

    expect(simulations.blocked.is_blocked).toBe(false);

    const totalSummary = summarizeTotalDistribution(simulations.samples, 8.5);
    const overEdge = buildTotalMarketEdgeFromSamples(
      simulations.samples,
      8.5,
      "over",
      -110
    );

    expect(
      totalSummary.over_probability +
        totalSummary.under_probability +
        totalSummary.push_probability
    ).toBeCloseTo(1, 6);
    expect(overEdge.model_probability).toBeCloseTo(totalSummary.over_probability, 6);
    expect(overEdge.market_implied_probability).toBeCloseTo(0.5238095238);
    expect(Number.isFinite(overEdge.raw_edge)).toBe(true);
    expect(overEdge.push_probability).toBeCloseTo(totalSummary.push_probability, 6);
  });
});