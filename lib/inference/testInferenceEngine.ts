/**
 * testInferenceEngine.ts
 *
 * A minimal deterministic fake inference engine for proof/test purposes.
 * Demonstrates that the InferenceEngine contract is implementable and
 * that inference-specific metadata stays at the engine boundary.
 *
 * NOT a production engine — no real heuristics.
 */

import type {
  InferenceContext,
  InferenceEngine,
  InferenceResult,
  InferredGameData
} from "@lib/contracts/inferred-source";
import { asISOTimestamp, err, ok, type Result } from "@lib/contracts/types";

export interface TestInferenceEngineOptions {
  /** When true, the engine returns an error. */
  readonly simulateFailure?: boolean;
  /** Pre-built game data to return.  When absent, returns empty games. */
  readonly games?: readonly InferredGameData[];
}

export const createTestInferenceEngine = (
  options: TestInferenceEngineOptions = {}
): InferenceEngine => ({
  engine: "test-inference",

  async infer(
    date: string,
    context: InferenceContext
  ): Promise<Result<InferenceResult, string>> {
    if (options.simulateFailure) {
      return err("Test inference engine simulated failure");
    }

    const games = options.games ?? [];
    let startersInferred = 0;
    let lineupsInferred = 0;

    for (const game of games) {
      if (game.away_starter) startersInferred++;
      if (game.home_starter) startersInferred++;
      if (game.away_lineup) lineupsInferred++;
      if (game.home_lineup) lineupsInferred++;
    }

    return ok({
      engine: "test-inference",
      date,
      generated_at: asISOTimestamp("2026-04-10T12:00:00Z"),
      summary: {
        games_attempted: context.game_ids.length,
        starters_inferred: startersInferred,
        lineups_inferred: lineupsInferred,
        failures: context.game_ids.length - games.length
      },
      games
    });
  }
});
