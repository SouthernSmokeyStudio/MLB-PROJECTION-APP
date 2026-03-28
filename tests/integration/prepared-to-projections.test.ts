import { describe, expect, it } from "vitest";
import preparedFixture from "../../data/fixtures/sample-prepared-game.json";
import type { PreparedGameInputs } from "../../lib/contracts/prepared";
import { assembleGameProjection } from "../../lib/projections/assembleGameProjection";

const prepared = preparedFixture as unknown as PreparedGameInputs;

describe("prepared -> projections integration", () => {
  it("builds a full non-blocked projection package from valid prepared inputs", () => {
    const assembled = assembleGameProjection(prepared);

    expect(assembled.game_projection.metadata.blocked.is_blocked).toBe(false);
    expect(assembled.game_projection.away.projected_runs).toBeGreaterThan(0);
    expect(assembled.game_projection.home.projected_runs).toBeGreaterThan(0);
    expect(assembled.game_projection.projected_total).toBeCloseTo(
      assembled.game_projection.away.projected_runs + assembled.game_projection.home.projected_runs
    );

    expect(assembled.away_pitcher).not.toBeNull();
    expect(assembled.home_pitcher).not.toBeNull();
    expect(assembled.away_batters).toHaveLength(9);
    expect(assembled.home_batters).toHaveLength(9);
  });
});
