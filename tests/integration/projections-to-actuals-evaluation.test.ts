import { describe, expect, it } from "vitest";
import preparedFixture from "../../data/fixtures/sample-prepared-game.json";
import type { PreparedGameInputs } from "../../lib/contracts/prepared";
import { extractFantasyActuals } from "../../lib/actuals/extractFantasyActuals";
import { extractGameActuals } from "../../lib/actuals/extractGameActuals";
import { extractPlayerActuals } from "../../lib/actuals/extractPlayerActuals";
import { evaluateProjections } from "../../lib/backtest/evaluateProjections";
import { assembleGameProjection } from "../../lib/projections/assembleGameProjection";
import { projectFantasyPoints } from "../../lib/scoring/projectFantasyPoints";

const prepared = preparedFixture as unknown as PreparedGameInputs;

describe("projections -> actuals -> evaluation integration", () => {
  it("evaluates deterministic projections against extracted actuals", () => {
    const assembled = assembleGameProjection(prepared);
    const fantasyProjection = projectFantasyPoints(assembled);

    const rawGameActuals = {
      game_id: "mlb-2026-03-27-nyy-bos",
      played_at: "2026-03-27T22:10:00Z",
      away: { team_id: "nyy", runs: 5, hits: 9, errors: 0, left_on_base: 7 },
      home: { team_id: "bos", runs: 4, hits: 8, errors: 1, left_on_base: 6 },
      total_innings: 9,
      is_complete: true,
      was_postponed: false,
      was_suspended: false,
      sources: []
    };

    const rawPlayerActuals = {
      players: [
        {
          player_id: "gerrit-cole",
          team_id: "nyy",
          game_id: "mlb-2026-03-27-nyy-bos",
          ip: 6,
          strikeouts: 8,
          earned_runs: 3,
          hits: 6,
          walks: 2,
          hbp: 0,
          win: true,
          complete_game: false,
          shutout: false,
          no_hitter: false
        },
        {
          player_id: "chris-sale",
          team_id: "bos",
          game_id: "mlb-2026-03-27-nyy-bos",
          ip: 5.2,
          strikeouts: 7,
          earned_runs: 4,
          hits: 7,
          walks: 1,
          hbp: 0,
          win: false,
          complete_game: false,
          shutout: false,
          no_hitter: false
        },
        ...prepared.away_batters.map((batter, index) => ({
          player_id: batter.player_id as unknown as string,
          team_id: batter.team_id as unknown as string,
          game_id: prepared.game_id as unknown as string,
          pa: 4,
          hits: index < 4 ? 1 : 0,
          runs: index < 2 ? 1 : 0,
          rbi: index < 3 ? 1 : 0,
          walks: index === 0 ? 1 : 0,
          stolen_bases: index === 1 ? 1 : 0,
          singles: index < 4 ? 1 : 0,
          doubles: 0,
          triples: 0,
          home_runs: 0,
          hbp: 0,
          caught_stealing: 0
        })),
        ...prepared.home_batters.map((batter, index) => ({
          player_id: batter.player_id as unknown as string,
          team_id: batter.team_id as unknown as string,
          game_id: prepared.game_id as unknown as string,
          pa: 4,
          hits: index < 3 ? 1 : 0,
          runs: index < 2 ? 1 : 0,
          rbi: index < 2 ? 1 : 0,
          walks: index === 0 ? 1 : 0,
          stolen_bases: 0,
          singles: index < 3 ? 1 : 0,
          doubles: 0,
          triples: 0,
          home_runs: 0,
          hbp: 0,
          caught_stealing: 0
        }))
      ]
    };

    const gameActuals = extractGameActuals(rawGameActuals);
    const playerActuals = extractPlayerActuals(rawPlayerActuals);

    expect(gameActuals.success).toBe(true);
    expect(playerActuals.success).toBe(true);

    if (!gameActuals.success || !playerActuals.success) {
      throw new Error("Expected actual extraction to succeed");
    }

    const fantasyActuals = extractFantasyActuals(playerActuals.data);
    const evaluation = evaluateProjections({
      game_projection: assembled,
      fantasy_projection: fantasyProjection,
      game_actuals: gameActuals.data,
      fantasy_actuals: fantasyActuals
    });

    expect(evaluation.game_runs.evaluated_count).toBe(3);
    expect(evaluation.game_runs.skipped_count).toBe(0);
    expect(evaluation.game_runs.mae).not.toBeNull();
    expect(evaluation.fantasy_points.evaluated_count).toBe(20);
    expect(evaluation.fantasy_points.skipped_count).toBe(0);
    expect(evaluation.fantasy_points.mae).not.toBeNull();
  });

  it("skips incomplete games honestly", () => {
    const assembled = assembleGameProjection(prepared);
    const fantasyProjection = projectFantasyPoints(assembled);

    const gameActuals = extractGameActuals({
      game_id: "mlb-2026-03-27-nyy-bos",
      played_at: "2026-03-27T21:00:00Z",
      away: { team_id: "nyy", runs: 2, hits: 5, errors: 0, left_on_base: 4 },
      home: { team_id: "bos", runs: 1, hits: 4, errors: 0, left_on_base: 3 },
      total_innings: 6,
      is_complete: false,
      was_postponed: false,
      was_suspended: true,
      sources: []
    });

    expect(gameActuals.success).toBe(true);

    if (!gameActuals.success) {
      throw new Error(gameActuals.error);
    }

    const evaluation = evaluateProjections({
      game_projection: assembled,
      fantasy_projection: fantasyProjection,
      game_actuals: gameActuals.data,
      fantasy_actuals: []
    });

    expect(evaluation.game_runs.evaluated_count).toBe(0);
    expect(evaluation.game_runs.skipped_count).toBe(3);
  });
});
