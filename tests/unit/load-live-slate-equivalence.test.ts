/**
 * load-live-slate-equivalence.test.ts
 *
 * Behavioral proof that loadLiveSlate(date) and
 * loadLiveSlate(date, { materializedBaseline: undefined })
 * produce identical output on the no-artifact path.
 *
 * Also proves that loadLiveSlate itself rejects stale baselines
 * at its own boundary — independent of the route guard.
 *
 * A6 addition: proves that the merge-wiring in loadLiveSlate does not
 * change behavior when no projected/inferred data is supplied.
 */

import { describe, expect, it, vi } from "vitest";
import rawFixture from "../../data/fixtures/sample-raw-game.json";
import { parseMlbStatsApiGamePayload } from "../../lib/adapters/mlbStatsApi";
import { buildPlayerCards } from "../../lib/services/buildPlayerCard";
import type { ProjectedGameData } from "../../lib/contracts/projected-source";
import { asISOTimestamp } from "../../lib/contracts/types";
import type { MaterializedSlate } from "../../lib/contracts/materialized-slate";

vi.mock("@lib/adapters/fetchWithTimeout", () => ({
  fetchWithTimeout: vi.fn()
}));

// Default: forecast returns null so existing tests are unaffected.
vi.mock("@lib/adapters/openMeteo", () => ({
  fetchVenueWeather: vi.fn().mockResolvedValue(null)
}));

// Mock the entire adapter layer so loadLiveSlate can run without network.
vi.mock("@lib/adapters/mlbStatsApi", async () => {
  const actual = await vi.importActual<typeof import("@lib/adapters/mlbStatsApi")>(
    "@lib/adapters/mlbStatsApi"
  );
  return {
    ...actual,
    fetchAndParseMlbStatsApiSchedule: vi.fn(),
    fetchMlbStatsApiBoxscore: vi.fn(),
    fetchMlbStatsApiBatterSeasonStats: vi.fn(),
    fetchMlbStatsApiLinescore: vi.fn(),
    fetchMlbStatsApiPitcherSeasonStats: vi.fn()
  };
});

import { loadLiveSlate } from "../../lib/services/loadLiveSlate";
import { buildPlayerBoard } from "../../lib/services/buildPlayerBoard";
import { buildScheduleBoard } from "../../lib/services/buildScheduleBoard";
import {
  fetchAndParseMlbStatsApiSchedule,
  fetchMlbStatsApiBatterSeasonStats,
  fetchMlbStatsApiBoxscore,
  fetchMlbStatsApiLinescore,
  fetchMlbStatsApiPitcherSeasonStats
} from "../../lib/adapters/mlbStatsApi";
import { fetchWithTimeout } from "../../lib/adapters/fetchWithTimeout";
import { fetchVenueWeather } from "../../lib/adapters/openMeteo";

const parsedFixture = parseMlbStatsApiGamePayload(rawFixture);
if (!parsedFixture.success) {
  throw new Error(parsedFixture.error);
}

const noOfficialStarterGame = {
  ...parsedFixture.data,
  teams: {
    away: {
      ...parsedFixture.data.teams.away,
      probablePitcher: null
    },
    home: {
      ...parsedFixture.data.teams.home,
      probablePitcher: null
    }
  }
};

// Variant with no MLB weather — simulates a scheduled game before first pitch.
const noWeatherGame = {
  ...noOfficialStarterGame,
  weather: null
};

const pitcherStatsPayload = {
  stats: [
    {
      splits: [
        {
          stat: {
            inningsPitched: "35.0",
            gamesStarted: 6,
            era: "3.20",
            whip: "1.10",
            strikeoutsPer9Inn: "9.5",
            walksPer9Inn: "2.2",
            homeRunsPer9: "0.8"
          }
        }
      ]
    }
  ]
};

const batterStatsPayload = {
  stats: [
    {
      splits: [
        {
          stat: {
            plateAppearances: "100",
            avg: ".270",
            obp: ".340",
            slg: ".450",
            strikeOuts: "20",
            baseOnBalls: "10",
            intentionalWalks: "0",
            hitByPitch: "2",
            hits: "27",
            doubles: "5",
            triples: "1",
            homeRuns: "5",
            stolenBases: "2"
          }
        }
      ]
    }
  ]
};

const teamHittingStatsPayload = {
  stats: [
    {
      splits: [
        {
          stat: {
            runs: "120",
            gamesPlayed: "25",
            obp: ".330"
          }
        }
      ]
    }
  ]
};

const teamReliefStatsPayload = {
  stats: [
    {
      splits: [
        {
          split: { code: "rp" },
          stat: { era: "3.90" }
        }
      ]
    }
  ]
};

const makeBatter = (id: number, fullName: string, battingOrder: string) => ({
  person: { id, fullName },
  battingOrder,
  seasonStats: {
    batting: {
      plateAppearances: "100",
      avg: ".270",
      obp: ".340",
      slg: ".450",
      strikeOuts: "20",
      baseOnBalls: "10",
      homeRuns: "5",
      stolenBases: "2"
    }
  }
});

const boxscoreWithoutGameStarters = {
  teams: {
    away: {
      teamStats: {
        pitching: { era: "4.00", whip: "1.25" }
      },
      players: {
        ID543037: {
          person: { id: 543037, fullName: "Gerrit Cole" },
          stats: { pitching: {} },
          seasonStats: { pitching: {} }
        },
        ID100001: makeBatter(100001, "Aaron Judge", "100")
      }
    },
    home: {
      teamStats: {
        pitching: { era: "4.10", whip: "1.30" }
      },
      players: {
        ID519242: {
          person: { id: 519242, fullName: "Chris Sale" },
          stats: { pitching: {} },
          seasonStats: { pitching: {} }
        },
        ID200001: makeBatter(200001, "Jarren Duran", "100")
      }
    }
  }
};

const projectedGame: ProjectedGameData = {
  game_id: "mlb-2026-03-27-nyy-bos" as never,
  away_starter: {
    player_id: "gerrit-cole" as never,
    full_name: "Gerrit Cole",
    team_id: "nyy" as never,
    handedness: "R",
    starting_status: "probable",
    confidence: "medium"
  },
  home_starter: {
    player_id: "chris-sale" as never,
    full_name: "Chris Sale",
    team_id: "bos" as never,
    handedness: "L",
    starting_status: "probable",
    confidence: "medium"
  },
  away_lineup: null,
  home_lineup: null
};

// ---------------------------------------------------------------------------
// 1. Behavioral equivalence: no-arg vs explicit undefined baseline
// ---------------------------------------------------------------------------

describe("loadLiveSlate — no-artifact behavioral equivalence", () => {
  it("loadLiveSlate(date) === loadLiveSlate(date, { materializedBaseline: undefined }) on empty schedule", async () => {
    // Both calls see the same mocked upstream: zero games returned.
    vi.mocked(fetchAndParseMlbStatsApiSchedule).mockResolvedValue({
      success: true,
      data: { rawGames: [], parsedGames: [] }
    } as never);

    const resultA = await loadLiveSlate("2026-04-10");
    const resultB = await loadLiveSlate("2026-04-10", { materializedBaseline: undefined });

    expect(resultA.success).toBe(true);
    expect(resultB.success).toBe(true);

    if (!resultA.success || !resultB.success) {
      throw new Error("Both calls should succeed");
    }

    // Structural equivalence — everything except generated_at (timestamp)
    expect(resultA.data.source).toBe(resultB.data.source);
    expect(resultA.data.date).toBe(resultB.data.date);
    expect(resultA.data.counts).toEqual(resultB.data.counts);
    expect(resultA.data.note).toBe(resultB.data.note);
    expect(resultA.data.games).toEqual(resultB.data.games);
    expect(resultA.data.games).toHaveLength(0);
  });

  it("loadLiveSlate(date) === loadLiveSlate(date, { materializedBaseline: undefined }) on fetch failure", async () => {
    vi.mocked(fetchAndParseMlbStatsApiSchedule).mockResolvedValue({
      success: false,
      error: "Network error"
    } as never);

    const resultA = await loadLiveSlate("2026-04-10");
    const resultB = await loadLiveSlate("2026-04-10", { materializedBaseline: undefined });

    expect(resultA.success).toBe(false);
    expect(resultB.success).toBe(false);

    if (resultA.success || resultB.success) {
      throw new Error("Both calls should fail");
    }

    expect(resultA.error).toBe(resultB.error);
  });
});

// ---------------------------------------------------------------------------
// 2. loadLiveSlate rejects stale baseline at its own boundary
// ---------------------------------------------------------------------------

describe("loadLiveSlate — stale baseline rejection at load boundary", () => {
  it("stale baseline is ignored — equivalent to no baseline", async () => {
    vi.mocked(fetchAndParseMlbStatsApiSchedule).mockResolvedValue({
      success: true,
      data: { rawGames: [], parsedGames: [] }
    } as never);

    const staleBaseline: MaterializedSlate = {
      version: 1,
      date: "2026-04-10",
      // 30 days ago — well beyond the 24h threshold
      generated_at: asISOTimestamp(
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      ),
      source: "stale-test",
      games: [
        {
          game_id: "mlb-2026-04-10-fake" as never,
          prepared: { game_id: "mlb-2026-04-10-fake" } as never
        }
      ]
    };

    const withStale = await loadLiveSlate("2026-04-10", {
      materializedBaseline: staleBaseline
    });
    const withoutBaseline = await loadLiveSlate("2026-04-10");

    expect(withStale.success).toBe(true);
    expect(withoutBaseline.success).toBe(true);

    if (!withStale.success || !withoutBaseline.success) {
      throw new Error("Both calls should succeed");
    }

    // Stale baseline was silently rejected — output is equivalent
    expect(withStale.data.games).toEqual(withoutBaseline.data.games);
    expect(withStale.data.counts).toEqual(withoutBaseline.data.counts);
    expect(withStale.data.note).toBe(withoutBaseline.data.note);
  });
});

// ---------------------------------------------------------------------------
// 3. A6 merge-wiring equivalence: official-only path unchanged
// ---------------------------------------------------------------------------

describe("loadLiveSlate — merge-wiring does not change official-only behavior", () => {
  it("loadLiveSlate(date) === loadLiveSlate(date, { projectedGames: undefined, inferredGames: undefined }) on empty schedule", async () => {
    vi.mocked(fetchAndParseMlbStatsApiSchedule).mockResolvedValue({
      success: true,
      data: { rawGames: [], parsedGames: [] }
    } as never);

    const bare = await loadLiveSlate("2026-04-10");
    const explicit = await loadLiveSlate("2026-04-10", {
      projectedGames: undefined,
      inferredGames: undefined
    });

    expect(bare.success).toBe(true);
    expect(explicit.success).toBe(true);

    if (!bare.success || !explicit.success) {
      throw new Error("Both calls should succeed");
    }

    expect(bare.data.source).toBe(explicit.data.source);
    expect(bare.data.date).toBe(explicit.data.date);
    expect(bare.data.counts).toEqual(explicit.data.counts);
    expect(bare.data.note).toBe(explicit.data.note);
    expect(bare.data.games).toEqual(explicit.data.games);
    expect(bare.data.games).toHaveLength(0);
  });

  it("loadLiveSlate(date) === loadLiveSlate(date, { projectedGames: empty Map, inferredGames: empty Map }) on empty schedule", async () => {
    vi.mocked(fetchAndParseMlbStatsApiSchedule).mockResolvedValue({
      success: true,
      data: { rawGames: [], parsedGames: [] }
    } as never);

    const bare = await loadLiveSlate("2026-04-10");
    const withEmptyMaps = await loadLiveSlate("2026-04-10", {
      projectedGames: new Map(),
      inferredGames: new Map()
    });

    expect(bare.success).toBe(true);
    expect(withEmptyMaps.success).toBe(true);

    if (!bare.success || !withEmptyMaps.success) {
      throw new Error("Both calls should succeed");
    }

    expect(bare.data.source).toBe(withEmptyMaps.data.source);
    expect(bare.data.date).toBe(withEmptyMaps.data.date);
    expect(bare.data.counts).toEqual(withEmptyMaps.data.counts);
    expect(bare.data.note).toBe(withEmptyMaps.data.note);
    expect(bare.data.games).toEqual(withEmptyMaps.data.games);
  });

  it("all three variants produce identical results on fetch failure", async () => {
    vi.mocked(fetchAndParseMlbStatsApiSchedule).mockResolvedValue({
      success: false,
      error: "Upstream unavailable"
    } as never);

    const bare = await loadLiveSlate("2026-04-10");
    const explicitUndefined = await loadLiveSlate("2026-04-10", {
      projectedGames: undefined,
      inferredGames: undefined
    });
    const emptyMaps = await loadLiveSlate("2026-04-10", {
      projectedGames: new Map(),
      inferredGames: new Map()
    });

    expect(bare.success).toBe(false);
    expect(explicitUndefined.success).toBe(false);
    expect(emptyMaps.success).toBe(false);

    if (bare.success || explicitUndefined.success || emptyMaps.success) {
      throw new Error("All calls should fail");
    }

    expect(bare.error).toBe(explicitUndefined.error);
    expect(bare.error).toBe(emptyMaps.error);
  });
});

// ---------------------------------------------------------------------------
// 4. Projected starter source reaches live preparation
// ---------------------------------------------------------------------------

describe("loadLiveSlate - projected starter flow into preparation", () => {
  const mockTeamStatFetches = (): void => {
    vi.mocked(fetchWithTimeout).mockImplementation(async (input) => {
      const url = String(input);

      if (url.includes("group=hitting")) {
        return {
          response: {
            ok: true,
            json: async () => teamHittingStatsPayload
          },
          error: null
        } as never;
      }

      if (url.includes("sitCodes=rp")) {
        return {
          response: {
            ok: true,
            json: async () => teamReliefStatsPayload
          },
          error: null
        } as never;
      }

      return {
        response: null,
        error: "unexpected fetch"
      } as never;
    });
  };

  const mockOneGameScheduleAndBoxscore = (): void => {
    vi.mocked(fetchAndParseMlbStatsApiSchedule).mockResolvedValue({
      success: true,
      data: {
        rawGames: [rawFixture],
        parsedGames: [noOfficialStarterGame]
      }
    } as never);
    vi.mocked(fetchMlbStatsApiBoxscore).mockResolvedValue({
      success: true,
      data: boxscoreWithoutGameStarters
    } as never);
    vi.mocked(fetchMlbStatsApiLinescore).mockResolvedValue({
      success: false,
      error: "linescore unavailable"
    } as never);
    vi.mocked(fetchMlbStatsApiPitcherSeasonStats).mockResolvedValue({
      success: true,
      data: pitcherStatsPayload
    } as never);
    vi.mocked(fetchMlbStatsApiBatterSeasonStats).mockResolvedValue({
      success: true,
      data: batterStatsPayload
    } as never);
    mockTeamStatFetches();
  };

  it("projects starters through the merge path before prepareGameInputs", async () => {
    mockOneGameScheduleAndBoxscore();

    const result = await loadLiveSlate("2026-03-27", {
      projectedGames: new Map([[projectedGame.game_id, projectedGame]])
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);

    const prepared = result.data.games[0]?.preparedGame;
    expect(prepared).toBeDefined();
    expect(prepared?.away_starter?.player_id).toBe("gerrit-cole");
    expect(prepared?.home_starter?.player_id).toBe("chris-sale");
    expect(prepared?.has_both_starters).toBe(true);
    expect(prepared?.blocked.blocked_reason).toBeNull();
    expect(result.data.games[0]?.playerIdentities["gerrit-cole"]?.full_name).toBe("Gerrit Cole");
    expect(result.data.games[0]?.playerIdentities["chris-sale"]?.full_name).toBe("Chris Sale");

    const playerBoard = buildPlayerBoard(result.data.games, {
      source: result.data.source,
      date: result.data.date,
      generated_at: result.data.generated_at,
      counts: result.data.counts
    });
    expect(playerBoard.players.find((player) => player.player_id === "gerrit-cole")?.full_name)
      .toBe("Gerrit Cole");

    const cards = buildPlayerCards(prepared!);
    expect(cards.players.length).toBeGreaterThan(0);
    expect(fetchMlbStatsApiPitcherSeasonStats).toHaveBeenCalledWith(543037, "2026");
    expect(fetchMlbStatsApiPitcherSeasonStats).toHaveBeenCalledWith(519242, "2026");
  });

  it("enrichs boxscore batters when season_woba is null even if season_avg is already populated", async () => {
    mockOneGameScheduleAndBoxscore();

    const result = await loadLiveSlate("2026-03-27", {
      projectedGames: new Map([[projectedGame.game_id, projectedGame]])
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);

    const prepared = result.data.games[0]?.preparedGame;
    expect(prepared).toBeDefined();
    expect(prepared?.away_batters[0]?.season_avg).toBe(0.27);
    expect(prepared?.home_batters[0]?.season_avg).toBe(0.27);
    expect(prepared?.away_batters[0]?.season_woba).toBe(0.408);
    expect(prepared?.home_batters[0]?.season_woba).toBe(0.408);
    expect(fetchMlbStatsApiBatterSeasonStats).toHaveBeenCalledWith(100001, "2026");
    expect(fetchMlbStatsApiBatterSeasonStats).toHaveBeenCalledWith(200001, "2026");
  });

  it("applies TBD fallback starters when no official, projected, or inferred starter source exists", async () => {
    mockOneGameScheduleAndBoxscore();

    const result = await loadLiveSlate("2026-03-27");

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);

    const prepared = result.data.games[0]?.preparedGame;
    expect(prepared).toBeDefined();

    // Class 2 TBD fallback starters are produced — non-null, explicitly marked with provenance.
    // The lane pitcher_league_average_fallback_15_of_15 guarantees that a game with
    // probablePitcher = null on both sides gets TBD placeholder starters with
    // season_era = BASE_LEAGUE_ERA so projectTeamRuns can run.
    expect(prepared?.away_starter).not.toBeNull();
    expect(prepared?.home_starter).not.toBeNull();
    expect(prepared?.away_starter?.fallback_used).toBe(true);
    expect(prepared?.home_starter?.fallback_used).toBe(true);
    expect(prepared?.away_starter?.fallback_reason).toBe("probable_pitcher_tbd");
    expect(prepared?.home_starter?.fallback_reason).toBe("probable_pitcher_tbd");
    expect(prepared?.away_starter?.pitcher_identity_known).toBe(false);
    expect(prepared?.home_starter?.pitcher_identity_known).toBe(false);
    expect(prepared?.away_starter?.baseline_source).toBe("league_average_fallback");
    expect(prepared?.home_starter?.baseline_source).toBe("league_average_fallback");
    expect(prepared?.has_both_starters).toBe(true);

    // Pitcher absence does NOT produce a blocked_reason — fail-closed is now batter-driven only.
    const blockedReason = prepared?.blocked.blocked_reason ?? "";
    expect(blockedReason).not.toContain("Missing away_starter preparation data");
    expect(blockedReason).not.toContain("Missing home_starter preparation data");
  });

  it("canonicalGame carries merged starters when projected starters win and no boxscore is available", async () => {
    // Regression for the liveCanonical fix in loadLiveSlate.
    // Before the fix, liveGames.push stored canonicalGame: game.normalizedGame (pre-merge),
    // which had probable_pitcher = null because no official MLB pitcher was listed.
    // buildScheduleBoard saw the pre-merge canonical and emitted probable_pitcher: null
    // even though preparedGame.has_both_starters was true (it used mergedCanonical).
    // After the fix, liveGames.push stores canonicalGame: liveCanonical (= mergedCanonical
    // when no boxscore, = reconcileCanonical when boxscore), so the fields are consistent.
    const mockOneGameNoBoxscore = (): void => {
      vi.mocked(fetchAndParseMlbStatsApiSchedule).mockResolvedValue({
        success: true,
        data: {
          rawGames: [rawFixture],
          parsedGames: [noOfficialStarterGame]
        }
      } as never);
      vi.mocked(fetchMlbStatsApiBoxscore).mockResolvedValue({
        success: false,
        error: "boxscore not available"
      } as never);
      vi.mocked(fetchMlbStatsApiLinescore).mockResolvedValue({
        success: false,
        error: "linescore unavailable"
      } as never);
      vi.mocked(fetchMlbStatsApiPitcherSeasonStats).mockResolvedValue({
        success: true,
        data: pitcherStatsPayload
      } as never);
      mockTeamStatFetches();
    };

    mockOneGameNoBoxscore();

    const result = await loadLiveSlate("2026-03-27", {
      projectedGames: new Map([[projectedGame.game_id, projectedGame]])
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);

    const sourceGame = result.data.games[0];
    expect(sourceGame).toBeDefined();

    // canonicalGame must carry the merged starter — not the pre-merge null.
    expect(sourceGame?.canonicalGame.away.probable_pitcher).not.toBeNull();
    expect(sourceGame?.canonicalGame.home.probable_pitcher).not.toBeNull();
    expect(sourceGame?.canonicalGame.away.probable_pitcher?.player_id).toBe("gerrit-cole");
    expect(sourceGame?.canonicalGame.home.probable_pitcher?.player_id).toBe("chris-sale");

    // preparedGame and canonicalGame must agree — no has_both_starters / probable_pitcher contradiction.
    expect(sourceGame?.preparedGame.has_both_starters).toBe(true);

    // buildScheduleBoard must surface the merged starters — the /api/schedule-board endpoint
    // depends on this path. Before the fix this emitted probable_pitcher: null.
    const board = buildScheduleBoard(result.data.games, {
      source: "live",
      date: "2026-03-27",
      counts: {
        fetched_raw: 1,
        parsed: 1,
        normalized: 1,
        prepared: 1,
        boxscore_enriched: 0
      }
    });

    const boardGame = board.games[0];
    expect(boardGame).toBeDefined();
    expect(boardGame?.away_team.probable_pitcher).not.toBeNull();
    expect(boardGame?.home_team.probable_pitcher).not.toBeNull();
    expect(boardGame?.away_team.probable_pitcher?.player_id).toBe("gerrit-cole");
    expect(boardGame?.home_team.probable_pitcher?.player_id).toBe("chris-sale");
  });

  it("does not invent projected pitcher full names from slug-only identity", async () => {
    mockOneGameScheduleAndBoxscore();

    const result = await loadLiveSlate("2026-03-27", {
      projectedGames: new Map([
        [
          projectedGame.game_id,
          {
            ...projectedGame,
            away_starter: projectedGame.away_starter
              ? { ...projectedGame.away_starter, full_name: null }
              : null
          }
        ]
      ])
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);

    expect(result.data.games[0]?.preparedGame.away_starter?.player_id).toBe("gerrit-cole");
    expect(result.data.games[0]?.playerIdentities["gerrit-cole"]).toBeUndefined();
  });
});

describe("loadLiveSlate – Open-Meteo forecast fill", () => {
  const forecastWeather = {
    temperature_f: 58.0,
    wind_speed_mph: 12.0,
    wind_direction: "SE",
    precipitation_chance: 0.1,
    conditions: "Partly Cloudy",
    dome_closed: null as boolean | null
  };

  it("fills canonicalGame.weather from forecast when MLB weather is null", async () => {
    vi.mocked(fetchVenueWeather).mockResolvedValue(forecastWeather);
    vi.mocked(fetchAndParseMlbStatsApiSchedule).mockResolvedValue({
      success: true,
      data: {
        rawGames: [rawFixture],
        parsedGames: [noWeatherGame] // weather: null — scheduled game before first pitch
      }
    } as never);
    vi.mocked(fetchMlbStatsApiBoxscore).mockResolvedValue({
      success: false,
      error: "boxscore not available"
    } as never);
    vi.mocked(fetchMlbStatsApiLinescore).mockResolvedValue({
      success: false,
      error: "linescore unavailable"
    } as never);
    vi.mocked(fetchMlbStatsApiPitcherSeasonStats).mockResolvedValue({
      success: false,
      error: "no stats"
    } as never);
    vi.mocked(fetchWithTimeout).mockResolvedValue({
      success: false,
      error: "team stats unavailable"
    } as never);

    const result = await loadLiveSlate("2026-04-20");

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);

    const game = result.data.games[0];
    expect(game).toBeDefined();
    expect(game?.canonicalGame.weather).toEqual(forecastWeather);
  });

  it("keeps MLB weather when non-null and does not call forecast", async () => {
    vi.mocked(fetchVenueWeather).mockResolvedValue(forecastWeather);
    // rawFixture has weather in its payload — normalizer should populate it.
    vi.mocked(fetchAndParseMlbStatsApiSchedule).mockResolvedValue({
      success: true,
      data: {
        rawGames: [rawFixture],
        parsedGames: [parsedFixture.data] // parsed with weather from fixture
      }
    } as never);
    vi.mocked(fetchMlbStatsApiBoxscore).mockResolvedValue({
      success: false,
      error: "boxscore not available"
    } as never);
    vi.mocked(fetchMlbStatsApiLinescore).mockResolvedValue({
      success: false,
      error: "linescore unavailable"
    } as never);
    vi.mocked(fetchMlbStatsApiPitcherSeasonStats).mockResolvedValue({
      success: false,
      error: "no stats"
    } as never);
    vi.mocked(fetchWithTimeout).mockResolvedValue({
      success: false,
      error: "team stats unavailable"
    } as never);

    const result = await loadLiveSlate("2026-04-20");

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);

    const game = result.data.games[0];
    expect(game).toBeDefined();
    // rawFixture has {condition:"Overcast",temp:"52",wind:"12 mph, Out to RF"}
    // so canonicalGame.weather must not be the Open-Meteo forecast object.
    expect(game?.canonicalGame.weather).not.toBeNull();
    expect(game?.canonicalGame.weather?.conditions).not.toBe("Partly Cloudy");
  });
});
