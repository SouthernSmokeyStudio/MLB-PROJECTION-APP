import { describe, expect, it } from "vitest";
import rawFixture from "../../data/fixtures/sample-raw-game.json";
import preparedFixture from "../../data/fixtures/sample-prepared-game.json";
import invalidPreparedFixture from "../../data/fixtures/sample-prepared-game-invalid.json";
import { parseMlbStatsApiGamePayload } from "../../lib/adapters/mlbStatsApi";
import type { PreparedGameInputs } from "../../lib/contracts/prepared";
import { normalizeMlbStatsApiGame } from "../../lib/normalization/mlbStatsApiNormalizer";
import { buildGameCard } from "../../lib/services/buildGameCard";
import { buildPlayerCards } from "../../lib/services/buildPlayerCard";
import { buildPlayerBoard } from "../../lib/services/buildPlayerBoard";
import { buildScheduleBoard } from "../../lib/services/buildScheduleBoard";
import { parseScheduleBoardPayload } from "../../lib/schedule-board";


const prepared = preparedFixture as unknown as PreparedGameInputs;
const invalidPrepared = invalidPreparedFixture as unknown as PreparedGameInputs;

describe("phase 9 services", () => {
  it("builds a clean game card without changing model meaning", () => {
    const card = buildGameCard(prepared);

    expect(card.game_id).toBe(prepared.game_id);
    expect(card.away_team_id).toBe(prepared.away_team.team_id);
    expect(card.home_team_id).toBe(prepared.home_team.team_id);
    expect(card.projection_lineage.game_id).toBe(card.game_id);
    expect(card.projection_lineage.prepared_at).toBe(prepared.prepared_at);
    expect(card.projection_lineage.run_id).toBeTruthy();
    expect(card.deterministic.derived_from).toBe("deterministic");
    expect(card.deterministic.projected_total).toBeGreaterThan(0);
    expect(card.simulation?.derived_from).toBe("simulation");
    expect(card.market).toBeNull();
    expect(card.evaluation).toBeNull();
    expect(card.blocked.is_blocked).toBe(false);
  });

  it("keeps blocked states visibly blocked", () => {
    const card = buildGameCard(invalidPrepared);
    const players = buildPlayerCards(invalidPrepared);

    expect(card.blocked.is_blocked).toBe(true);
    expect(card.simulation).toBeNull();
    expect(players.blocked.is_blocked).toBe(true);
  });

  it("surfaces market fields as market-derived instead of merging them into certainty", () => {
    const card = buildGameCard(prepared, {
      market: {
        moneyline: {
          away_odds: 110,
          home_odds: -110
        },
        total: {
          line: 8.5,
          over_odds: -110,
          under_odds: -110
        }
      },
      simulation: {
        seed: 17,
        iterations: 250
      }
    });

    expect(card.market?.derived_from).toBe("market");
    expect(card.market?.moneyline?.away.model_probability).toBeGreaterThanOrEqual(0);
    expect(card.market?.moneyline?.away.model_probability).toBeLessThanOrEqual(1);
    expect(card.market?.total?.over.side).toBe("over");
    expect(card.market?.total?.under.side).toBe("under");
  });

  it("builds player cards with ids, fantasy summaries, and simulation-derived fields", () => {
    const result = buildPlayerCards(prepared, {
      simulation: {
        seed: 321,
        iterations: 250
      }
    });

    expect(result.players.length).toBeGreaterThan(0);

    const first = result.players[0];
    expect(first).toBeDefined();

    if (!first) {
      throw new Error("Expected at least one player card");
    }

    expect(first.player_id).toBeTruthy();
    expect(first.team_id).toBeTruthy();
    expect(first.game_id).toBeTruthy();
    expect(first.projection_lineage.game_id).toBe(first.game_id);
    expect(first.projection_lineage.run_id).toBeTruthy();
    expect(first.fantasy_summary).not.toBeNull();
    expect(first.simulation_summary?.derived_from).toBe("simulation");
    expect(result.players.some((player) => player.deterministic_summary !== null)).toBe(true);
  });

  it("builds a schedule board contract from real route-backed fields", () => {
    const parsed = parseMlbStatsApiGamePayload(rawFixture);
    expect(parsed.success).toBe(true);

    if (!parsed.success) {
      throw new Error(parsed.error);
    }

    const normalized = normalizeMlbStatsApiGame(parsed.data);
    expect(normalized.success).toBe(true);

    if (!normalized.success) {
      throw new Error(normalized.error);
    }

    const board = buildScheduleBoard(
      [
        {
          parsedGame: parsed.data,
          canonicalGame: normalized.data,
          preparedGame: prepared,
          playerIdentities: {}
        }
      ],
      {
        source: "mlb-statsapi-live",
        date: "2026-03-27",
        generated_at: "2026-03-27T15:30:00Z",
        counts: {
          fetched_raw: 1,
          parsed: 1,
          normalized: 1,
          prepared: 1,
          boxscore_enriched: 1
        },
        simulation: {
          seed: 7,
          iterations: 100
        }
      }
    );

    expect(board.mode).toBe("schedule-board-v1");
    expect(board.summary.total_games).toBe(1);
    expect(board.summary.projection_ready_games).toBe(1);
    expect(board.summary.games_ready_for_player_projections).toBe(1);
    expect(board.games[0]?.venue_name).toBe("Fenway Park");
    expect(board.games[0]?.player_projection_status).toBe("ready");
    expect(board.games[0]?.away_team.probable_pitcher?.full_name).toBe("Gerrit Cole");
    expect(board.games[0]?.home_team.probable_pitcher?.full_name).toBe("Chris Sale");
    expect(board.games[0]?.projection.projected_total).toBeGreaterThan(0);
    // input_coverage — fixture has both starters set with known handedness,
    // 9 batters per team all with non-null season_woba
    expect(board.games[0]?.input_coverage.away_pitcher_handedness).toBe("R");
    expect(board.games[0]?.input_coverage.home_pitcher_handedness).toBe("L");
    expect(board.games[0]?.input_coverage.away_lineup_avg_woba).toBeCloseTo(0.336);
    expect(board.games[0]?.input_coverage.home_lineup_avg_woba).toBeCloseTo(0.327);
    expect(board.games[0]?.input_coverage.away_woba_batter_count).toBe(9);
    expect(board.games[0]?.input_coverage.home_woba_batter_count).toBe(9);
  });

  it("builds a player board contract with identity and matchup context", async () => {
    const parsed = parseMlbStatsApiGamePayload(rawFixture);
    expect(parsed.success).toBe(true);

    if (!parsed.success) {
      throw new Error(parsed.error);
    }

    const normalized = normalizeMlbStatsApiGame(parsed.data);
    expect(normalized.success).toBe(true);

    if (!normalized.success) {
      throw new Error(normalized.error);
    }

    const board = await buildPlayerBoard(
      [
        {
          parsedGame: parsed.data,
          canonicalGame: normalized.data,
          preparedGame: prepared,
          liveScoreState: {
            away_score: null,
            home_score: null,
            inning_number: null,
            inning_state: null,
            is_live: false,
            is_final: false,
            display_state: "Scheduled"
          },
          playerIdentities: {
            "gerrit-cole": {
              player_id: "gerrit-cole" as never,
              full_name: "Gerrit Cole",
              position: "P",
              batting_order: null
            },
            "chris-sale": {
              player_id: "chris-sale" as never,
              full_name: "Chris Sale",
              position: "P",
              batting_order: null
            },
            "nyy-1": {
              player_id: "nyy-1" as never,
              full_name: "Aaron Judge",
              position: "RF",
              batting_order: 1
            },
            "bos-1": {
              player_id: "bos-1" as never,
              full_name: "Jarren Duran",
              position: "LF",
              batting_order: 1
            }
          }
        }
      ],
      {
        source: "mlb-statsapi-live",
        date: "2026-03-27",
        generated_at: "2026-03-27T15:30:00Z",
        counts: {
          fetched_raw: 1,
          parsed: 1,
          normalized: 1,
          prepared: 1,
          boxscore_enriched: 1
        },
        simulation: {
          seed: 7,
          iterations: 100
        }
      }
    );

    expect(board.mode).toBe("player-board-v1");
    expect(board.summary.total_players).toBeGreaterThan(0);
    expect(board.summary.games_covered).toBe(1);

    const pitcher = board.players.find(
      (player) => player.player_id === ("gerrit-cole" as never)
    );
    expect(pitcher?.full_name).toBe("Gerrit Cole");
    expect(pitcher?.position).toBe("P");
    expect(pitcher?.team_abbreviation).toBe("NYY");
    expect(pitcher?.opponent_team_abbreviation).toBe("BOS");

    const batter = board.players.find((player) => player.player_id === ("nyy-1" as never));
    expect(batter?.full_name).toBe("Aaron Judge");
    expect(batter?.batting_order).toBe(1);
    expect(batter?.matchup).toBe("New York Yankees at Boston Red Sox");
    expect(batter?.projection.fantasy_summary?.projected_points).toBeGreaterThan(0);
  });
});

describe("buildScheduleBoard input_coverage", () => {
  const boardCounts = {
    fetched_raw: 1,
    parsed: 1,
    normalized: 1,
    prepared: 1,
    boxscore_enriched: 1
  } as const;

  const parseResult = parseMlbStatsApiGamePayload(rawFixture);
  const normalizeResult = parseResult.success ? normalizeMlbStatsApiGame(parseResult.data) : null;

  const buildGame = (preparedOverride: Record<string, unknown>) => {
    if (!parseResult.success) throw new Error(parseResult.error);
    if (!normalizeResult?.success) throw new Error("normalize failed");
    return {
      parsedGame: parseResult.data,
      canonicalGame: normalizeResult.data,
      preparedGame: { ...prepared, ...preparedOverride } as unknown as PreparedGameInputs,
      playerIdentities: {} as const
    };
  };

  it("surfaces 'unknown' handedness when starters are null", () => {
    const board = buildScheduleBoard(
      [buildGame({ away_starter: null, home_starter: null })],
      { source: "test", date: "2026-04-22", counts: boardCounts }
    );
    expect(board.games[0]?.input_coverage.away_pitcher_handedness).toBe("unknown");
    expect(board.games[0]?.input_coverage.home_pitcher_handedness).toBe("unknown");
  });

  it("surfaces null lineup_avg_woba when unresolved for both teams", () => {
    const board = buildScheduleBoard(
      [buildGame({
        away_team: { ...prepared.away_team, lineup_avg_woba: null },
        home_team: { ...prepared.home_team, lineup_avg_woba: null }
      })],
      { source: "test", date: "2026-04-22", counts: boardCounts }
    );
    expect(board.games[0]?.input_coverage.away_lineup_avg_woba).toBeNull();
    expect(board.games[0]?.input_coverage.home_lineup_avg_woba).toBeNull();
  });

  it("returns zero away count when no batter has season_woba populated", () => {
    const board = buildScheduleBoard(
      [buildGame({
        away_batters: prepared.away_batters.map((b) => ({ ...b, season_woba: null }))
      })],
      { source: "test", date: "2026-04-22", counts: boardCounts }
    );
    expect(board.games[0]?.input_coverage.away_woba_batter_count).toBe(0);
    // home batters unchanged — all 9 have non-null season_woba in the fixture
    expect(board.games[0]?.input_coverage.home_woba_batter_count).toBe(9);
  });

  it("counts exactly 6 when only the first 6 away batters have season_woba populated", () => {
    const board = buildScheduleBoard(
      [buildGame({
        away_batters: prepared.away_batters.map((b, i) => ({ ...b, season_woba: i < 6 ? b.season_woba : null }))
      })],
      { source: "test", date: "2026-04-22", counts: boardCounts }
    );
    expect(board.games[0]?.input_coverage.away_woba_batter_count).toBe(6);
  });

  it("survives parseScheduleBoardPayload round-trip with all input_coverage fields intact", () => {
    const board = buildScheduleBoard(
      [buildGame({})],
      { source: "mlb-statsapi-live", date: "2026-04-22", counts: boardCounts }
    );
    const roundTripped = parseScheduleBoardPayload(JSON.parse(JSON.stringify(board)));
    const coverage = roundTripped.games[0]?.input_coverage;
    expect(coverage?.away_pitcher_handedness).toBe("R");
    expect(coverage?.home_pitcher_handedness).toBe("L");
    expect(coverage?.away_lineup_avg_woba).toBeCloseTo(0.336);
    expect(coverage?.home_lineup_avg_woba).toBeCloseTo(0.327);
    expect(coverage?.away_woba_batter_count).toBe(9);
    expect(coverage?.home_woba_batter_count).toBe(9);
  });
});

