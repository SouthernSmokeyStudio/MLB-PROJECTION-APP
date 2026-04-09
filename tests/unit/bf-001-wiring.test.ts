/**
 * BF-001 loadLiveSlate wiring proof.
 *
 * Proves that when boxscore starter extraction returns null for both sides
 * but probable pitcher IDs are present, loadLiveSlate falls back to the
 * people-stats endpoint and populates starters on the resulting preparedGame.
 */

import { describe, expect, it, vi, afterEach } from "vitest";
import rawFixtureData from "../../data/fixtures/sample-raw-game.json";
import { loadLiveSlate } from "@lib/services/loadLiveSlate";

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Minimal API response builders
// ---------------------------------------------------------------------------

const scheduleResponse = () => ({
  ok: true,
  json: async () => ({ dates: [{ games: [rawFixtureData] }] })
});

// Boxscore: valid structure, but no player has stats.pitching.gamesStarted === 1.
// buildPreparedStarter will return null for both sides.
const boxscoreNoStartersResponse = () => ({
  ok: true,
  json: async () => ({
    teams: {
      away: { players: {} },
      home: { players: {} }
    }
  })
});

// Linescore: minimal valid shape (teams block present, null scores for pre-game).
const linescoreResponse = () => ({
  ok: true,
  json: async () => ({
    teams: { away: { runs: null }, home: { runs: null } }
  })
});

const teamHittingResponse = () => ({
  ok: true,
  json: async () => ({
    stats: [{ splits: [{ stat: { runs: 400, gamesPlayed: 100, obp: "0.340" } }] }]
  })
});

const teamReliefResponse = () => ({
  ok: true,
  json: async () => ({
    stats: [{ splits: [{ split: { code: "rp" }, stat: { era: "3.80" } }] }]
  })
});

const pitcherStatsResponse = (era: string) => ({
  ok: true,
  json: async () => ({
    stats: [{
      splits: [{
        stat: {
          era,
          whip: "1.10",
          strikeoutsPer9Inn: "9.50",
          walksPer9Inn: "2.50",
          homeRunsPer9: "1.00",
          inningsPitched: "120.0",
          gamesStarted: 20
        }
      }]
    }]
  })
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("loadLiveSlate BF-001 wiring", () => {
  it("populates starters from people-stats when boxscore extraction returns null starters", async () => {
    // Stub global fetch in call order:
    // 1. schedule
    // 2. boxscore  (Promise.all slot 0)
    // 3. linescore (Promise.all slot 1)
    // 4. away team season hitting  (inner Promise.all slot 0)
    // 5. home team season hitting  (inner Promise.all slot 1)
    // 6. away team relief pitching (inner Promise.all slot 2)
    // 7. home team relief pitching (inner Promise.all slot 3)
    // 8. away pitcher stats        (inner Promise.all slot 4 — only because away_starter === null)
    // 9. home pitcher stats        (inner Promise.all slot 5 — only because home_starter === null)
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(scheduleResponse())
      .mockResolvedValueOnce(boxscoreNoStartersResponse())
      .mockResolvedValueOnce(linescoreResponse())
      .mockResolvedValueOnce(teamHittingResponse())
      .mockResolvedValueOnce(teamHittingResponse())
      .mockResolvedValueOnce(teamReliefResponse())
      .mockResolvedValueOnce(teamReliefResponse())
      .mockResolvedValueOnce(pitcherStatsResponse("3.20"))  // away = Gerrit Cole
      .mockResolvedValueOnce(pitcherStatsResponse("2.95")); // home = Chris Sale

    vi.stubGlobal("fetch", mockFetch);

    const result = await loadLiveSlate("2026-03-27");

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);

    expect(result.data.games).toHaveLength(1);

    const game = result.data.games[0];
    if (!game) throw new Error("Expected at least one game");

    // Away starter must be populated from people stats (not from boxscore extraction)
    expect(game.preparedGame.away_starter).not.toBeNull();
    expect(game.preparedGame.away_starter?.season_era).toBeCloseTo(3.20);

    // Home starter must be populated from people stats
    expect(game.preparedGame.home_starter).not.toBeNull();
    expect(game.preparedGame.home_starter?.season_era).toBeCloseTo(2.95);

    // Player IDs must match canonical probable pitchers (identity contract)
    expect(game.preparedGame.away_starter?.player_id).toBe("gerrit-cole");
    expect(game.preparedGame.home_starter?.player_id).toBe("chris-sale");

    // Starters must NOT be the reason the game is blocked
    const blockedReason = game.preparedGame.blocked.blocked_reason ?? "";
    expect(blockedReason).not.toContain("away_starter");
    expect(blockedReason).not.toContain("home_starter");

    // All 9 fetch calls must have been made
    expect(mockFetch).toHaveBeenCalledTimes(9);
  });

  it("does NOT fetch pitcher stats for a side whose starter was already extracted from boxscore", async () => {
    // Construct a boxscore where the AWAY pitcher has gamesStarted === 1
    // (as in a live/in-progress game) but home does not.
    const boxscoreWithAwayStarter = {
      ok: true,
      json: async () => ({
        teams: {
          away: {
            players: {
              "ID543037": {
                person: { id: 543037, fullName: "Gerrit Cole" },
                position: { abbreviation: "P" },
                stats: { pitching: { gamesStarted: 1 } },
                seasonStats: {
                  pitching: {
                    era: "3.00",
                    whip: "1.05",
                    strikeoutsPer9Inn: "10.50",
                    walksPer9Inn: "2.20",
                    inningsPitched: "150.0",
                    gamesStarted: 25
                  }
                }
              }
            }
          },
          home: { players: {} }
        }
      })
    };

    const mockFetch = vi.fn()
      .mockResolvedValueOnce(scheduleResponse())
      .mockResolvedValueOnce(boxscoreWithAwayStarter)
      .mockResolvedValueOnce(linescoreResponse())
      .mockResolvedValueOnce(teamHittingResponse())
      .mockResolvedValueOnce(teamHittingResponse())
      .mockResolvedValueOnce(teamReliefResponse())
      .mockResolvedValueOnce(teamReliefResponse())
      // home pitcher stats only — away was already extracted (5th parallel slot resolves false early)
      .mockResolvedValueOnce(pitcherStatsResponse("2.95")); // home = Chris Sale

    vi.stubGlobal("fetch", mockFetch);

    const result = await loadLiveSlate("2026-03-27");

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);

    const game = result.data.games[0];
    if (!game) throw new Error("Expected at least one game");

    // Away starter comes from boxscore (no people-stats fetch for away side)
    expect(game.preparedGame.away_starter).not.toBeNull();

    // Home starter comes from people stats
    expect(game.preparedGame.home_starter).not.toBeNull();
    expect(game.preparedGame.home_starter?.season_era).toBeCloseTo(2.95);

    // Only 8 calls: 1 schedule + 2 parallel (boxscore+linescore) + 4 team stats + 1 home pitcher stats
    expect(mockFetch).toHaveBeenCalledTimes(8);
  });
});
