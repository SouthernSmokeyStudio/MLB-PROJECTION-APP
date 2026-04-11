/**
 * S1 Final Proof — MLB Stats API adapter batter mlb_stats_api_id propagation.
 *
 * Exercises the REAL adapter path: extractPreparedGameDataFromBoxscore →
 * buildPreparedBatters → verify person.id flows into mlb_stats_api_id.
 *
 * Does NOT use manual object construction as the main proof.
 */

import { describe, expect, it } from "vitest";
import { extractPreparedGameDataFromBoxscore } from "../../lib/adapters/mlbStatsApi";
import normalizedFixture from "../../data/fixtures/sample-normalized-game.json";
import type { CanonicalGame } from "../../lib/contracts/canonical";

const normalizedGame = normalizedFixture as unknown as CanonicalGame;

/**
 * Minimal boxscore payload shaped exactly like the MLB Stats API boxscore
 * response. Each batter has a known `person.id` that the adapter must
 * propagate to `mlb_stats_api_id`.
 */
const makeBoxscoreWithBatters = (batters: {
  away: Array<{ personId: number; battingOrder: number; avg: string }>;
  home: Array<{ personId: number; battingOrder: number; avg: string }>;
}) => {
  const buildPlayers = (list: typeof batters.away) => {
    const players: Record<string, unknown> = {};
    for (const b of list) {
      players[`ID${b.personId}`] = {
        person: { id: b.personId },
        battingOrder: `${b.battingOrder}00`,
        seasonStats: {
          batting: {
            plateAppearances: 100,
            avg: b.avg,
            obp: ".340",
            slg: ".450",
            strikeOuts: 20,
            baseOnBalls: 10,
            homeRuns: 5,
            stolenBases: 3
          }
        }
      };
    }
    return players;
  };

  return {
    teams: {
      away: {
        players: buildPlayers(batters.away),
        teamStats: { pitching: { era: "3.50", whip: "1.20" } }
      },
      home: {
        players: buildPlayers(batters.home),
        teamStats: { pitching: { era: "4.00", whip: "1.30" } }
      }
    }
  };
};

describe("extractPreparedGameDataFromBoxscore — mlb_stats_api_id propagation", () => {
  const AWAY_BATTER_ID = 592450; // Aaron Judge
  const HOME_BATTER_ID = 660271; // Ronald Acuna Jr.
  const AWAY_BATTER_2_ID = 543037; // Gerrit Cole (hypothetical batter slot)

  const boxscore = makeBoxscoreWithBatters({
    away: [
      { personId: AWAY_BATTER_ID, battingOrder: 1, avg: ".300" },
      { personId: AWAY_BATTER_2_ID, battingOrder: 2, avg: ".180" }
    ],
    home: [
      { personId: HOME_BATTER_ID, battingOrder: 1, avg: ".280" }
    ]
  });

  it("extracts batters through the real adapter path", () => {
    const result = extractPreparedGameDataFromBoxscore(boxscore, normalizedGame);
    expect(result.success).toBe(true);

    if (!result.success) {
      throw new Error(result.error);
    }

    expect(result.data.away_batters.length).toBe(2);
    expect(result.data.home_batters.length).toBe(1);
  });

  it("propagates person.id into mlb_stats_api_id as String(person.id)", () => {
    const result = extractPreparedGameDataFromBoxscore(boxscore, normalizedGame);

    if (!result.success) {
      throw new Error(result.error);
    }

    // Away batters
    const judgeBatter = result.data.away_batters.find(
      (b) => b.mlb_stats_api_id === String(AWAY_BATTER_ID)
    );
    expect(judgeBatter).toBeDefined();
    expect(judgeBatter!.mlb_stats_api_id).toBe("592450");
    expect(judgeBatter!.player_id).toBe(judgeBatter!.mlb_stats_api_id);

    const coleBatter = result.data.away_batters.find(
      (b) => b.mlb_stats_api_id === String(AWAY_BATTER_2_ID)
    );
    expect(coleBatter).toBeDefined();
    expect(coleBatter!.mlb_stats_api_id).toBe("543037");

    // Home batter
    const acunaBatter = result.data.home_batters[0];
    expect(acunaBatter).toBeDefined();
    expect(acunaBatter!.mlb_stats_api_id).toBe(String(HOME_BATTER_ID));
    expect(acunaBatter!.mlb_stats_api_id).toBe("660271");
  });

  it("mlb_stats_api_id is exactly String(person.id) for every batter", () => {
    const result = extractPreparedGameDataFromBoxscore(boxscore, normalizedGame);

    if (!result.success) {
      throw new Error(result.error);
    }

    const allBatters = [...result.data.away_batters, ...result.data.home_batters];
    const expectedIds = [
      String(AWAY_BATTER_ID),
      String(AWAY_BATTER_2_ID),
      String(HOME_BATTER_ID)
    ];

    expect(allBatters.map((b) => b.mlb_stats_api_id).sort()).toEqual(
      expectedIds.sort()
    );

    // Every batter's mlb_stats_api_id matches its player_id
    // (because buildPreparedBatters sets both from the same person.id)
    for (const batter of allBatters) {
      expect(batter.mlb_stats_api_id).toBe(batter.player_id);
      expect(batter.mlb_stats_api_id).toMatch(/^\d+$/);
    }
  });
});
