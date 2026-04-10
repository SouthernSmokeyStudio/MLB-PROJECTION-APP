import { describe, expect, it } from "vitest";
import rawFixture from "../../data/fixtures/sample-raw-game.json";
import { parseMlbStatsApiGamePayload, parseMlbStatsApiLinescorePayload } from "../../lib/adapters/mlbStatsApi";
import { normalizeMlbStatsApiGame } from "../../lib/normalization/mlbStatsApiNormalizer";
import { buildLiveSlateScoreState } from "../../lib/services/loadLiveSlate";

const parsed = parseMlbStatsApiGamePayload(rawFixture);

if (!parsed.success) {
  throw new Error(parsed.error);
}

const normalized = normalizeMlbStatsApiGame(parsed.data);

if (!normalized.success) {
  throw new Error(normalized.error);
}

describe("live score upstream state", () => {
  it("parses MLB linescore truth for inning and score state", () => {
    const parsedLinescore = parseMlbStatsApiLinescorePayload({
      currentInning: 7,
      currentInningOrdinal: "7th",
      inningState: "Top",
      inningHalf: "Top",
      isTopInning: true,
      teams: {
        away: { runs: 4 },
        home: { runs: 3 }
      }
    });

    expect(parsedLinescore.success).toBe(true);

    if (!parsedLinescore.success) {
      throw new Error(parsedLinescore.error);
    }

    expect(parsedLinescore.data.currentInning).toBe(7);
    expect(parsedLinescore.data.currentInningOrdinal).toBe("7th");
    expect(parsedLinescore.data.inningState).toBe("Top");
    expect(parsedLinescore.data.teams.away.runs).toBe(4);
    expect(parsedLinescore.data.teams.home.runs).toBe(3);
  });

  it("builds a canonical live-score state from linescore truth", () => {
    const state = buildLiveSlateScoreState({
      sourceGame: {
        parsedGame: parsed.data,
        normalizedGame: {
          ...normalized.data,
          status: "in_progress"
        }
      },
      boxscore: {
        teams: {
          away: {
            teamStats: {
              batting: {
                runs: 4
              }
            }
          },
          home: {
            teamStats: {
              batting: {
                runs: 3
              }
            }
          }
        }
      },
      linescore: {
        currentInning: 7,
        currentInningOrdinal: "7th",
        inningState: "Top",
        teams: {
          away: { runs: 4 },
          home: { runs: 3 }
        }
      }
    });

    expect(state).toEqual({
      away_score: 4,
      home_score: 3,
      inning_number: 7,
      inning_state: "top",
      is_live: true,
      is_final: false,
      display_state: "Top 7th"
    });
  });

  it("falls back to boxscore runs while leaving inning state null when linescore is unavailable", () => {
    const state = buildLiveSlateScoreState({
      sourceGame: {
        parsedGame: parsed.data,
        normalizedGame: normalized.data
      },
      boxscore: {
        teams: {
          away: {
            teamStats: {
              batting: {
                runs: 5
              }
            }
          },
          home: {
            teamStats: {
              batting: {
                runs: 2
              }
            }
          }
        }
      },
      linescore: null
    });

    expect(state.away_score).toBe(5);
    expect(state.home_score).toBe(2);
    expect(state.inning_number).toBeNull();
    expect(state.inning_state).toBeNull();
    expect(state.is_live).toBe(false);
    expect(state.is_final).toBe(false);
    expect(state.display_state).toBe("Scheduled");
  });
});
