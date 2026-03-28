import { describe, expect, it } from "vitest";
import preparedFixture from "../../data/fixtures/sample-prepared-game.json";
import invalidPreparedFixture from "../../data/fixtures/sample-prepared-game-invalid.json";
import type { PreparedGameInputs } from "../../lib/contracts/prepared";
import { assembleGameProjection } from "../../lib/projections/assembleGameProjection";
import { projectFantasyPoints } from "../../lib/scoring/projectFantasyPoints";
import { simulateFantasy } from "../../lib/simulation/simulateFantasy";
import { simulateGames } from "../../lib/simulation/simulateGames";

const prepared = preparedFixture as unknown as PreparedGameInputs;
const invalidPrepared = invalidPreparedFixture as unknown as PreparedGameInputs;

describe("projections -> simulation integration", () => {
  it("produces stable game and fantasy simulations from valid upstream projections", () => {
    const assembled = assembleGameProjection(prepared) as any;
    const gameProjection = assembled.game_projection ?? assembled.game ?? assembled;
    const fantasyProjection = projectFantasyPoints(assembled);

    const gameSimulations = simulateGames(gameProjection, {
      seed: 20260328,
      iterations: 250
    });

    const fantasySimulations = simulateFantasy(fantasyProjection, {
      seed: 20260328,
      iterations: 250
    });

    expect(gameSimulations.blocked.is_blocked).toBe(false);
    expect(gameSimulations.samples).toHaveLength(250);
    expect(gameSimulations.average_total_runs).toBeGreaterThan(0);

    expect(fantasySimulations.blocked.is_blocked).toBe(false);
    expect(fantasySimulations.pitcher_summaries).toHaveLength(2);
    expect(fantasySimulations.batter_summaries).toHaveLength(18);
  });

  it("is deterministic for identical seeded simulation runs", () => {
    const assembled = assembleGameProjection(prepared) as any;
    const gameProjection = assembled.game_projection ?? assembled.game ?? assembled;
    const fantasyProjection = projectFantasyPoints(assembled);

    const firstGame = simulateGames(gameProjection, {
      seed: 17,
      iterations: 150
    });

    const secondGame = simulateGames(gameProjection, {
      seed: 17,
      iterations: 150
    });

    const firstFantasy = simulateFantasy(fantasyProjection, {
      seed: 17,
      iterations: 150
    });

    const secondFantasy = simulateFantasy(fantasyProjection, {
      seed: 17,
      iterations: 150
    });

    expect(firstGame).toStrictEqual(secondGame);
    expect(firstFantasy).toStrictEqual(secondFantasy);
  });

  it("propagates blocked upstream projections", () => {
    const assembled = assembleGameProjection(invalidPrepared) as any;
    const gameProjection = assembled.game_projection ?? assembled.game ?? assembled;
    const fantasyProjection = projectFantasyPoints(assembled);

    const blockedGame = simulateGames(gameProjection, {
      seed: 5,
      iterations: 100
    });

    const blockedFantasy = simulateFantasy(fantasyProjection, {
      seed: 5,
      iterations: 100
    });

    expect(blockedGame.blocked.is_blocked).toBe(true);
    expect(blockedFantasy.blocked.is_blocked).toBe(true);
    expect(blockedGame.samples).toHaveLength(0);
    expect(blockedFantasy.pitcher_summaries).toHaveLength(0);
    expect(blockedFantasy.batter_summaries).toHaveLength(0);
  });
});
