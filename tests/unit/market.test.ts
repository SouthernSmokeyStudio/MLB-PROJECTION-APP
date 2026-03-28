import { describe, expect, it } from "vitest";
import {
  americanOddsToDecimal,
  decimalOddsToAmerican
} from "../../lib/market/odds";
import {
  americanOddsToImpliedProbability,
  decimalOddsToImpliedProbability,
  deriveTwoWayMarketImpliedProbabilities,
  normalizeImpliedProbabilities,
  oddsToImpliedProbability
} from "../../lib/market/implied";
import {
  probabilityToFairAmericanOdds,
  probabilityToFairDecimalOdds
} from "../../lib/market/fairPrice";
import {
  buildMarketEdgeFromOdds,
  buildTwoWayMarketEdgeFromOdds,
  buildTotalMarketEdgeFromSamples,
  summarizeTotalDistribution
} from "../../lib/market/edge";

describe("phase 8 market math", () => {
  it("converts american odds to decimal and back", () => {
    expect(americanOddsToDecimal(150)).toBeCloseTo(2.5);
    expect(americanOddsToDecimal(-150)).toBeCloseTo(1.6666666667);
    expect(decimalOddsToAmerican(2.5)).toBe(150);
    expect(decimalOddsToAmerican(1.6666666667)).toBe(-150);
  });

  it("derives implied probabilities from american and decimal odds", () => {
    expect(americanOddsToImpliedProbability(150)).toBeCloseTo(0.4);
    expect(americanOddsToImpliedProbability(-150)).toBeCloseTo(0.6);
    expect(decimalOddsToImpliedProbability(2.5)).toBeCloseTo(0.4);
    expect(oddsToImpliedProbability(150, "american")).toBeCloseTo(0.4);
    expect(oddsToImpliedProbability(2.5, "decimal")).toBeCloseTo(0.4);
  });

  it("normalizes implied probabilities explicitly when removing vig", () => {
    const normalized = normalizeImpliedProbabilities([0.5238095238, 0.5238095238]);

    expect(normalized[0]).toBeCloseTo(0.5);
    expect(normalized[1]).toBeCloseTo(0.5);

    const twoWay = deriveTwoWayMarketImpliedProbabilities(-110, -110);

    expect(twoWay.market_a_implied_probability).toBeCloseTo(0.5238095238);
    expect(twoWay.market_b_implied_probability).toBeCloseTo(0.5238095238);
    expect(twoWay.market_a_no_vig_probability).toBeCloseTo(0.5);
    expect(twoWay.market_b_no_vig_probability).toBeCloseTo(0.5);
  });

  it("derives fair prices from model probabilities", () => {
    expect(probabilityToFairDecimalOdds(0.4)).toBeCloseTo(2.5);
    expect(probabilityToFairAmericanOdds(0.4)).toBe(150);
    expect(probabilityToFairAmericanOdds(0.6)).toBe(-150);
  });

  it("builds explicit market edge metrics", () => {
    const edge = buildMarketEdgeFromOdds(0.55, 110);

    expect(edge.market_implied_probability).toBeCloseTo(0.476190, 5);
    expect(edge.model_probability).toBeCloseTo(0.55, 5);
    expect(edge.raw_edge).toBeCloseTo(0.07381, 4);
    expect(edge.fair_american_odds).toBe(-122);
    expect(edge.fair_decimal_odds).toBeCloseTo(1.818182, 5);

    const twoWayEdge = buildTwoWayMarketEdgeFromOdds(0.55, -110, -110);

    expect(twoWayEdge.market_no_vig_probability).toBeCloseTo(0.5);
    expect(twoWayEdge.no_vig_edge).toBeCloseTo(0.05);
  });

  it("derives total probabilities and total edge from simulated samples", () => {
    const samples = [
      { away_runs: 4, home_runs: 5, total_runs: 9, away_win: false, home_win: true },
      { away_runs: 2, home_runs: 3, total_runs: 5, away_win: false, home_win: true },
      { away_runs: 6, home_runs: 4, total_runs: 10, away_win: true, home_win: false },
      { away_runs: 4, home_runs: 4, total_runs: 8, away_win: false, home_win: false }
    ];

    const summary = summarizeTotalDistribution(samples, 8.5);

    expect(summary.over_probability).toBeCloseTo(0.5);
    expect(summary.under_probability).toBeCloseTo(0.5);
    expect(summary.push_probability).toBe(0);

    const edge = buildTotalMarketEdgeFromSamples(samples, 8.5, "over", -110);

    expect(edge.side).toBe("over");
    expect(edge.line).toBe(8.5);
    expect(edge.market_implied_probability).toBeCloseTo(0.5238095238);
    expect(edge.model_probability).toBeCloseTo(0.5);
    expect(edge.raw_edge).toBeCloseTo(-0.0238095, 5);
    expect(edge.push_probability).toBe(0);
  });
});
