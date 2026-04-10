/**
 * testProjectedSource.ts
 *
 * A minimal fake projected-source adapter for proof/test purposes only.
 * Demonstrates that the ProjectedSourceAdapter contract is implementable
 * and that provider-specific details stay inside the adapter boundary.
 *
 * NOT a production adapter — no real data fetching.
 */

import type {
  ProjectedSourceAdapter,
  ProjectedSourceResult
} from "@lib/contracts/projected-source";
import { asISOTimestamp, err, ok, type Result } from "@lib/contracts/types";

export interface TestProjectedSourceOptions {
  /** When true, the adapter returns an error instead of data. */
  readonly simulateFailure?: boolean;
  /** Pre-built result to return.  When absent, returns empty games. */
  readonly result?: ProjectedSourceResult;
}

export const createTestProjectedSourceAdapter = (
  options: TestProjectedSourceOptions = {}
): ProjectedSourceAdapter => ({
  source: "test-projected",

  async fetchProjectedData(
    date: string
  ): Promise<Result<ProjectedSourceResult, string>> {
    if (options.simulateFailure) {
      return err("Test adapter simulated failure");
    }

    if (options.result) {
      return ok(options.result);
    }

    return ok({
      provider_meta: {
        provider: "test-projected",
        fetched_at: asISOTimestamp(new Date().toISOString()),
        source_url: null
      },
      date,
      generated_at: asISOTimestamp(new Date().toISOString()),
      games: []
    });
  }
});
