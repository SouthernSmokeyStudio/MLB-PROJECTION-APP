import { describe, expect, it } from "vitest";
import {
  asGameId,
  asPlayerId,
  asTeamId
} from "../../lib/contracts/types";
import { samplePoisson } from "../../lib/simulation/distributions";
import { createSeededRng } from "../../lib/simulation/random";
import { simulateFantasy } from "../../lib/simulation/simulateFantasy";
import { simulateGames } from "../../lib/simulation/simulateGames";

describe("phase 7 simulation", () => {
  it("produces deterministic seeded random sequences", () => {
    const first = createSeededRng(42);
    const second = createSeededRng(42);

    const firstValues = [first.next(), first.next(), first.next()];
    const secondValues = [second.next(), second.next(), second.next()];

    expect(firstValues).toStrictEqual(secondValues);
  });

  it("produces deterministic poisson samples for the same seed", () => {
    const first = createSeededRng(7);
    const second = createSeededRng(7);

    const firstSample = [
      samplePoisson(first, 4.8),
      samplePoisson(first, 4.8),
      samplePoisson(first, 4.8)
    ];

    const secondSample = [
      samplePoisson(second, 4.8),
      samplePoisson(second, 4.8),
      samplePoisson(second, 4.8)
    ];

    expect(firstSample).toStrictEqual(secondSample);
  });

  it("simulates games deterministically from projected runs", () => {
    const gameProjection = {
      blocked: {
        is_blocked: false,
        blocked_reason: null
      },
      away: {
        projected_runs: 4.8
      },
      home: {
        projected_runs: 4.2
      },
      projected_total: 9
    };

    const first = simulateGames(gameProjection, {
      seed: 99,
      iterations: 250
    });

    const second = simulateGames(gameProjection, {
      seed: 99,
      iterations: 250
    });

    expect(first).toStrictEqual(second);
    expect(first.samples).toHaveLength(250);
    expect(first.away_win_probability).toBeGreaterThanOrEqual(0);
    expect(first.away_win_probability).toBeLessThanOrEqual(1);
    expect(first.home_win_probability).toBeGreaterThanOrEqual(0);
    expect(first.home_win_probability).toBeLessThanOrEqual(1);
  });

  it("simulates fantasy outcomes deterministically", () => {
    const fantasyProjection = {
      blocked: {
        is_blocked: false,
        blocked_reason: null
      },
      pitcher_fantasy_points: [
        {
          player_id: asPlayerId("pitcher-1"),
          team_id: asTeamId("nyy"),
          game_id: asGameId("game-1"),
          platform: "draftkings" as const,
          contest_type: "classic" as const,
          projected_points: 18.5,
          projected_points_std: 4.2,
          ceiling: 27,
          floor: 11,
          salary: null,
          value: null
        }
      ],
      batter_fantasy_points: [
        {
          player_id: asPlayerId("batter-1"),
          team_id: asTeamId("bos"),
          game_id: asGameId("game-1"),
          platform: "draftkings" as const,
          contest_type: "classic" as const,
          projected_points: 9.8,
          projected_points_std: 3.1,
          ceiling: 17,
          floor: 3,
          salary: null,
          value: null
        }
      ]
    };

    const first = simulateFantasy(fantasyProjection, {
      seed: 321,
      iterations: 250
    });

    const second = simulateFantasy(fantasyProjection, {
      seed: 321,
      iterations: 250
    });

    expect(first).toStrictEqual(second);
    expect(first.pitcher_summaries).toHaveLength(1);
    expect(first.batter_summaries).toHaveLength(1);
    expect(first.pitcher_summaries[0]?.mean_points).toBeGreaterThan(0);
    expect(first.batter_summaries[0]?.mean_points).toBeGreaterThan(0);
  });
});