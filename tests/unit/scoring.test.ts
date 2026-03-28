import { describe, expect, it } from "vitest";
import { DK_CLASSIC_RULES_V1 } from "../../lib/contracts/scoring";
import {
  deriveBatterFantasyPoints,
  derivePitcherFantasyPoints
} from "../../lib/scoring/deriveFantasyPoints";

describe("phase 5 scoring helpers", () => {
  it("matches pitcher scoring constants exactly for a known stat line", () => {
    const points = derivePitcherFantasyPoints(
      {
        projected_ip: 6,
        projected_k: 7,
        projected_er: 2,
        projected_hits: 5,
        projected_bb: 2,
        projected_win_probability: 1,
        projected_hbp_allowed: 1,
        projected_complete_game: 1,
        projected_shutout: 1,
        projected_no_hitter: 1
      },
      DK_CLASSIC_RULES_V1
    );

    const expected =
      6 * 2.25 +
      7 * 2 +
      1 * 4 +
      2 * -2 +
      5 * -0.6 +
      2 * -0.6 +
      1 * -0.6 +
      1 * 2.5 +
      1 * 2.5 +
      1 * 5;

    expect(points).toBeCloseTo(expected);
  });

  it("matches batter scoring constants exactly for a one-of-each stat line", () => {
    const points = deriveBatterFantasyPoints(
      {
        projected_singles: 1,
        projected_doubles: 1,
        projected_triples: 1,
        projected_hr: 1,
        projected_rbi: 1,
        projected_runs: 1,
        projected_bb: 1,
        projected_hbp: 1,
        projected_sb: 1,
        projected_cs: 1
      },
      DK_CLASSIC_RULES_V1
    );

    const expected =
      1 * 3 +
      1 * 5 +
      1 * 8 +
      1 * 10 +
      1 * 2 +
      1 * 2 +
      1 * 2 +
      1 * 2 +
      1 * 5 +
      1 * -2;

    expect(points).toBeCloseTo(expected);
  });

  it("is deterministic for identical inputs", () => {
    const first = deriveBatterFantasyPoints(
      {
        projected_singles: 0.8,
        projected_doubles: 0.3,
        projected_triples: 0.04,
        projected_hr: 0.22,
        projected_rbi: 0.9,
        projected_runs: 0.85,
        projected_bb: 0.41,
        projected_hbp: 0,
        projected_sb: 0.11,
        projected_cs: 0
      },
      DK_CLASSIC_RULES_V1
    );

    const second = deriveBatterFantasyPoints(
      {
        projected_singles: 0.8,
        projected_doubles: 0.3,
        projected_triples: 0.04,
        projected_hr: 0.22,
        projected_rbi: 0.9,
        projected_runs: 0.85,
        projected_bb: 0.41,
        projected_hbp: 0,
        projected_sb: 0.11,
        projected_cs: 0
      },
      DK_CLASSIC_RULES_V1
    );

    expect(first).toBe(second);
  });
});
