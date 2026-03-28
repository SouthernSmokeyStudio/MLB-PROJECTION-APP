import { describe, expect, it } from "vitest";
import type { ActualPlayerOutcome } from "../../lib/contracts/actuals";
import { DK_CLASSIC_RULES_V1 } from "../../lib/contracts/scoring";
import {
  asGameId,
  asPlayerId,
  asTeamId
} from "../../lib/contracts/types";
import { deriveBatterFantasyPoints } from "../../lib/scoring/deriveFantasyPoints";
import { extractFantasyActuals } from "../../lib/actuals/extractFantasyActuals";
import { extractGameActuals } from "../../lib/actuals/extractGameActuals";
import { extractPlayerActuals } from "../../lib/actuals/extractPlayerActuals";

describe("phase 6 actuals extraction", () => {
  it("extracts game actuals deterministically", () => {
    const raw = {
      game_id: "mlb-2026-03-27-nyy-bos",
      played_at: "2026-03-27T22:10:00Z",
      away: { team_id: "nyy", runs: 5, hits: 9, errors: 0, left_on_base: 7 },
      home: { team_id: "bos", runs: 3, hits: 8, errors: 1, left_on_base: 6 },
      total_innings: 9,
      is_complete: true,
      was_postponed: false,
      was_suspended: false,
      sources: []
    };

    const first = extractGameActuals(raw);
    const second = extractGameActuals(raw);

    expect(first).toStrictEqual(second);
    expect(first.success).toBe(true);

    if (!first.success) {
      throw new Error(first.error);
    }

    expect(first.data.total_runs).toBe(8);
  });

  it("extracts player actuals deterministically", () => {
    const raw = {
      players: [
        {
          player_id: "nyy-1",
          team_id: "nyy",
          game_id: "mlb-2026-03-27-nyy-bos",
          pa: 5,
          hits: 2,
          runs: 1,
          rbi: 2,
          walks: 1,
          singles: 1,
          doubles: 1,
          triples: 0,
          home_runs: 0,
          stolen_bases: 1,
          hbp: 0,
          caught_stealing: 0
        }
      ]
    };

    const first = extractPlayerActuals(raw);
    const second = extractPlayerActuals(raw);

    expect(first).toStrictEqual(second);
    expect(first.success).toBe(true);
  });

  it("uses locked DK scoring constants for fantasy actuals", () => {
    const actuals: readonly ActualPlayerOutcome[] = [
      {
        player_id: asPlayerId("one-of-each"),
        team_id: asTeamId("nyy"),
        game_id: asGameId("mlb-2026-03-27-nyy-bos"),
        pa: 6,
        ip: null,
        strikeouts: null,
        earned_runs: null,
        hits: 4,
        runs: 1,
        rbi: 1,
        walks: 1,
        stolen_bases: 1,
        singles: 1,
        doubles: 1,
        triples: 1,
        home_runs: 1,
        hbp: 1,
        caught_stealing: 1,
        win: null,
        complete_game: null,
        shutout: null,
        no_hitter: null
      }
    ];

    const fantasy = extractFantasyActuals(actuals);
    const first = fantasy[0];

    expect(first).toBeDefined();

    if (!first) {
      throw new Error("Expected fantasy actual output");
    }

    const expected = deriveBatterFantasyPoints(
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

    expect(first.actual_points).toBeCloseTo(expected);
  });
});
