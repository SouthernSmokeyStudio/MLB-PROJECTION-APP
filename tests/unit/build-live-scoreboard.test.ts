import { describe, expect, it } from "vitest";
import rawFixture from "../../data/fixtures/sample-raw-game.json";
import { parseMlbStatsApiGamePayload } from "../../lib/adapters/mlbStatsApi";
import { normalizeMlbStatsApiGame } from "../../lib/normalization/mlbStatsApiNormalizer";
import { asGameId, asISOTimestamp, asTeamId } from "../../lib/contracts/types";
import { prepareGameInputs } from "../../lib/preparation";
import type { LiveSlateSourceGame } from "../../lib/services/loadLiveSlate";
import { buildLiveScoreboard } from "../../lib/services/buildLiveScoreboard";

const parsed = parseMlbStatsApiGamePayload(rawFixture);

if (!parsed.success) {
  throw new Error(parsed.error);
}

const normalized = normalizeMlbStatsApiGame(parsed.data);

if (!normalized.success) {
  throw new Error(normalized.error);
}

// KC @ NYY canonical game shell — overrides team identity and game_id.
// The raw fixture base (NYY @ BOS) is only a structural scaffold; all
// ribbon-relevant fields are explicitly overridden below.
const kcNyyBase = {
  ...normalized.data,
  game_id: asGameId("mlb-2026-04-19-kc-nyy"),
  scheduled_start: asISOTimestamp("2026-04-19T18:05:00Z"),
  away: {
    ...normalized.data.away,
    team: {
      ...normalized.data.away.team,
      team_id: asTeamId("kc"),
      abbreviation: "KC",
      full_name: "Kansas City Royals"
    }
  },
  home: {
    ...normalized.data.home,
    team: {
      ...normalized.data.home.team,
      team_id: asTeamId("nyy"),
      abbreviation: "NYY",
      full_name: "New York Yankees"
    }
  }
};

const buildOptions = {
  source: "mlb-statsapi-live",
  date: "2026-04-19",
  counts: {
    fetched_raw: 1,
    parsed: 1,
    normalized: 1,
    prepared: 1,
    boxscore_enriched: 0
  }
};

describe("buildLiveScoreboard — KC @ NYY ribbon regression", () => {
  it("final game with unavailable scores is not blocked and shows Final, not Score blocked", () => {
    // This is the exact broken case from the FARRIS packet:
    // KC @ NYY ends but linescore/boxscore data is unavailable (API lag or fetch
    // failure).  Before the fix, buildBlockedState returned is_blocked: true for
    // any final game with null scores, making formatStatusRailBadge return
    // "Score blocked" instead of "Final".  That is wrong for a completed game.
    const sourceGame: LiveSlateSourceGame = {
      parsedGame: parsed.data,
      canonicalGame: { ...kcNyyBase, status: "final" as const },
      preparedGame: prepareGameInputs({ ...kcNyyBase, status: "final" as const }),
      playerIdentities: {},
      liveScoreState: {
        away_score: null,
        home_score: null,
        inning_number: null,
        inning_state: null,
        is_live: false,
        is_final: true,
        display_state: "Final"
      }
    };

    const result = buildLiveScoreboard([sourceGame], buildOptions);
    const game = result.games[0]!;

    expect(game.blocked.is_blocked).toBe(false);
    expect(game.blocked.blocked_reason).toBeNull();
    expect(game.is_final).toBe(true);
    expect(game.is_live).toBe(false);
    expect(game.away_score).toBeNull();
    expect(game.home_score).toBeNull();
    expect(game.away_team_abbreviation).toBe("KC");
    expect(game.home_team_abbreviation).toBe("NYY");
    expect(game.game_id).toBe("mlb-2026-04-19-kc-nyy");
    expect(result.summary.blocked_games).toBe(0);
  });

  it("final game with available scores is not blocked and exposes final score", () => {
    const sourceGame: LiveSlateSourceGame = {
      parsedGame: parsed.data,
      canonicalGame: { ...kcNyyBase, status: "final" as const },
      preparedGame: prepareGameInputs({ ...kcNyyBase, status: "final" as const }),
      playerIdentities: {},
      liveScoreState: {
        away_score: 3,
        home_score: 7,
        inning_number: 9,
        inning_state: "end" as const,
        is_live: false,
        is_final: true,
        display_state: "Final"
      }
    };

    const result = buildLiveScoreboard([sourceGame], buildOptions);
    const game = result.games[0]!;

    expect(game.blocked.is_blocked).toBe(false);
    expect(game.is_final).toBe(true);
    expect(game.away_score).toBe(3);
    expect(game.home_score).toBe(7);
    expect(result.summary.final_games).toBe(1);
    expect(result.summary.blocked_games).toBe(0);
  });

  it("in-progress game with unavailable scores is still blocked", () => {
    // Fail-closed for live games: if scores are missing mid-game, the ribbon
    // must not show a score it does not have.
    const sourceGame: LiveSlateSourceGame = {
      parsedGame: parsed.data,
      canonicalGame: { ...kcNyyBase, status: "in_progress" as const },
      preparedGame: prepareGameInputs({ ...kcNyyBase, status: "in_progress" as const }),
      playerIdentities: {},
      liveScoreState: {
        away_score: null,
        home_score: null,
        inning_number: null,
        inning_state: null,
        is_live: true,
        is_final: false,
        display_state: null
      }
    };

    const result = buildLiveScoreboard([sourceGame], buildOptions);
    const game = result.games[0]!;

    expect(game.blocked.is_blocked).toBe(true);
    expect(game.blocked.blocked_reason).toContain("away/home score");
    expect(game.blocked.blocked_reason).toContain("live game");
    expect(result.summary.blocked_games).toBe(1);
  });

  it("in-progress game with valid scores and inning data is not blocked", () => {
    const sourceGame: LiveSlateSourceGame = {
      parsedGame: parsed.data,
      canonicalGame: { ...kcNyyBase, status: "in_progress" as const },
      preparedGame: prepareGameInputs({ ...kcNyyBase, status: "in_progress" as const }),
      playerIdentities: {},
      liveScoreState: {
        away_score: 3,
        home_score: 5,
        inning_number: 7,
        inning_state: "top" as const,
        is_live: true,
        is_final: false,
        display_state: "Top 7th"
      }
    };

    const result = buildLiveScoreboard([sourceGame], buildOptions);
    const game = result.games[0]!;

    expect(game.blocked.is_blocked).toBe(false);
    expect(game.away_score).toBe(3);
    expect(game.home_score).toBe(5);
    expect(game.inning_number).toBe(7);
    expect(game.inning_state).toBe("top");
    expect(game.display_state).toBe("Top 7th");
    expect(game.away_team_abbreviation).toBe("KC");
    expect(game.home_team_abbreviation).toBe("NYY");
    expect(result.summary.live_games).toBe(1);
    expect(result.summary.blocked_games).toBe(0);
  });
});
