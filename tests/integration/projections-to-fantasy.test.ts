import { describe, expect, it } from "vitest";
import preparedFixture from "../../data/fixtures/sample-prepared-game.json";
import invalidPreparedFixture from "../../data/fixtures/sample-prepared-game-invalid.json";
import type { PreparedGameInputs } from "../../lib/contracts/prepared";
import { assembleGameProjection } from "../../lib/projections/assembleGameProjection";
import { projectFantasyPoints } from "../../lib/scoring/projectFantasyPoints";

const prepared = preparedFixture as unknown as PreparedGameInputs;
const invalidPrepared = invalidPreparedFixture as unknown as PreparedGameInputs;

describe("projections -> fantasy integration", () => {
  it("produces stable non-blocked fantasy outputs from valid projections", () => {
    const assembled = assembleGameProjection(prepared);
    const fantasy = projectFantasyPoints(assembled);

    expect(fantasy.blocked.is_blocked).toBe(false);
    expect(fantasy.pitcher_fantasy_points).toHaveLength(2);
    expect(fantasy.batter_fantasy_points).toHaveLength(18);

    const firstPitcher = fantasy.pitcher_fantasy_points[0];
    const firstBatter = fantasy.batter_fantasy_points[0];

    expect(firstPitcher).toBeDefined();
    expect(firstBatter).toBeDefined();

    if (!firstPitcher || !firstBatter) {
      throw new Error("Expected non-empty fantasy projection arrays for valid prepared input");
    }

    expect(firstPitcher.projected_points).toBeGreaterThan(0);
    expect(firstBatter.projected_points).toBeGreaterThan(0);
  });

  it("is deterministic for identical upstream projections", () => {
    const first = projectFantasyPoints(assembleGameProjection(prepared));
    const second = projectFantasyPoints(assembleGameProjection(prepared));

    expect(first).toStrictEqual(second);
  });

  it("propagates blocked upstream projections with explicit blocked_reason", () => {
    const blocked = projectFantasyPoints(assembleGameProjection(invalidPrepared));

    expect(blocked.blocked.is_blocked).toBe(true);
    expect(blocked.blocked.blocked_reason).toBeTruthy();
    expect(blocked.pitcher_fantasy_points).toHaveLength(0);
    expect(blocked.batter_fantasy_points).toHaveLength(0);
  });
});
