/**
 * projected-source-adapter.test.ts
 *
 * Proves the projected-source adapter contract for A3:
 * - provider-neutral contract shape
 * - adapter failure is isolated / fail-closed
 * - downstream code needs no provider-specific fields
 * - provider swap at the adapter boundary preserves canonical output shape
 */

import { describe, expect, it } from "vitest";
import type {
  ProjectedGameData,
  ProjectedLineupEntry,
  ProjectedSourceAdapter,
  ProjectedSourceResult,
  ProjectedStarter
} from "../../lib/contracts/projected-source";
import type { ProbablePitcher, LineupEntry } from "../../lib/contracts/canonical";
import {
  asGameId,
  asISOTimestamp,
  asPlayerId,
  asTeamId
} from "../../lib/contracts/types";
import { createTestProjectedSourceAdapter } from "../../lib/adapters/testProjectedSource";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeStarter = (playerId: string, teamId: string): ProjectedStarter => ({
  player_id: asPlayerId(playerId),
  team_id: asTeamId(teamId),
  handedness: "R",
  starting_status: "expected",
  confidence: "high"
});

const makeLineupEntry = (
  playerId: string,
  teamId: string,
  order: number,
  position: "C" | "1B" | "2B" | "3B" | "SS" | "LF" | "CF" | "RF" | "DH"
): ProjectedLineupEntry => ({
  player_id: asPlayerId(playerId),
  team_id: asTeamId(teamId),
  batting_order: order,
  position,
  starting_status: "expected"
});

const makeGameData = (): ProjectedGameData => ({
  game_id: asGameId("mlb-2026-04-10-nyy-bos"),
  away_starter: makeStarter("gerrit-cole", "nyy"),
  home_starter: makeStarter("chris-sale", "bos"),
  away_lineup: [
    makeLineupEntry("nyy-1", "nyy", 1, "RF"),
    makeLineupEntry("nyy-2", "nyy", 2, "SS"),
    makeLineupEntry("nyy-3", "nyy", 3, "1B")
  ],
  home_lineup: [
    makeLineupEntry("bos-1", "bos", 1, "LF"),
    makeLineupEntry("bos-2", "bos", 2, "3B"),
    makeLineupEntry("bos-3", "bos", 3, "DH")
  ]
});

const makeResult = (): ProjectedSourceResult => ({
  provider_meta: {
    provider: "test-projected",
    fetched_at: asISOTimestamp("2026-04-10T14:00:00Z"),
    source_url: null
  },
  date: "2026-04-10",
  generated_at: asISOTimestamp("2026-04-10T14:00:00Z"),
  games: [makeGameData()]
});

// A second fake adapter with a different source name — proves swap works.
const createAlternativeAdapter = (
  result: ProjectedSourceResult
): ProjectedSourceAdapter => ({
  source: "alternative-projected",
  async fetchProjectedData(): Promise<{ success: true; data: ProjectedSourceResult }> {
    return {
      success: true,
      data: {
        ...result,
        provider_meta: {
          ...result.provider_meta,
          provider: "alternative-projected"
        }
      }
    };
  }
});

// ---------------------------------------------------------------------------
// 1. Provider-neutral contract shape
// ---------------------------------------------------------------------------

describe("projected-source contract — provider-neutral shape", () => {
  it("ProjectedStarter has only canonical fields, no provider-specific leakage", () => {
    const starter = makeStarter("gerrit-cole", "nyy");

    // Canonical fields present
    expect(starter.player_id).toBe("gerrit-cole");
    expect(starter.team_id).toBe("nyy");
    expect(starter.handedness).toBe("R");
    expect(starter.starting_status).toBe("expected");
    expect(starter.confidence).toBe("high");

    // Exhaustive key check — only these five fields exist
    const keys = Object.keys(starter).sort();
    expect(keys).toEqual([
      "confidence",
      "handedness",
      "player_id",
      "starting_status",
      "team_id"
    ]);
  });

  it("ProjectedLineupEntry has only canonical fields, no provider-specific leakage", () => {
    const entry = makeLineupEntry("nyy-1", "nyy", 1, "RF");

    expect(entry.player_id).toBe("nyy-1");
    expect(entry.team_id).toBe("nyy");
    expect(entry.batting_order).toBe(1);
    expect(entry.position).toBe("RF");
    expect(entry.starting_status).toBe("expected");

    const keys = Object.keys(entry).sort();
    expect(keys).toEqual([
      "batting_order",
      "player_id",
      "position",
      "starting_status",
      "team_id"
    ]);
  });

  it("ProjectedGameData groups starters and lineups per side", () => {
    const gameData = makeGameData();

    expect(gameData.game_id).toBe("mlb-2026-04-10-nyy-bos");
    expect(gameData.away_starter).not.toBeNull();
    expect(gameData.home_starter).not.toBeNull();
    expect(gameData.away_lineup).toHaveLength(3);
    expect(gameData.home_lineup).toHaveLength(3);
  });

  it("ProjectedSourceResult wraps games with provider metadata", () => {
    const result = makeResult();

    expect(result.provider_meta.provider).toBe("test-projected");
    expect(result.date).toBe("2026-04-10");
    expect(result.games).toHaveLength(1);

    // provider_meta is the ONLY place provider identity lives
    const gameKeys = Object.keys(result.games[0]!).sort();
    expect(gameKeys).not.toContain("provider");
    expect(gameKeys).not.toContain("provider_meta");
    expect(gameKeys).not.toContain("source_url");
  });
});

// ---------------------------------------------------------------------------
// 2. Adapter failure is isolated / fail-closed
// ---------------------------------------------------------------------------

describe("projected-source adapter — fail-closed", () => {
  it("adapter failure returns err, not throws", async () => {
    const adapter = createTestProjectedSourceAdapter({ simulateFailure: true });
    const result = await adapter.fetchProjectedData("2026-04-10");

    expect(result.success).toBe(false);

    if (!result.success) {
      expect(result.error).toBe("Test adapter simulated failure");
    }
  });

  it("caller can treat failure as no-data-available without catching", async () => {
    const adapter = createTestProjectedSourceAdapter({ simulateFailure: true });
    const result = await adapter.fetchProjectedData("2026-04-10");

    // Fail-closed: on failure, projected data is simply absent.
    const games = result.success ? result.data.games : [];
    expect(games).toHaveLength(0);
  });

  it("adapter success with empty games is valid (no projected data yet)", async () => {
    const adapter = createTestProjectedSourceAdapter();
    const result = await adapter.fetchProjectedData("2026-04-10");

    expect(result.success).toBe(true);

    if (!result.success) {
      throw new Error(result.error);
    }

    expect(result.data.games).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Downstream code needs no provider-specific fields
// ---------------------------------------------------------------------------

describe("projected-source contract — downstream compatibility", () => {
  it("ProjectedStarter fields are a superset of ProbablePitcher minus mlb_stats_api_id", () => {
    // ProbablePitcher has: player_id, mlb_stats_api_id, starting_status, handedness
    // ProjectedStarter has: player_id, team_id, handedness, starting_status, confidence
    // The overlap (player_id, handedness, starting_status) is sufficient for
    // canonical conversion.  mlb_stats_api_id is provider-specific and correctly
    // absent from the projected contract.
    const starter = makeStarter("gerrit-cole", "nyy");

    const asProbablePitcher: ProbablePitcher = {
      player_id: starter.player_id,
      mlb_stats_api_id: null,
      starting_status: starter.starting_status,
      handedness: starter.handedness
    };

    expect(asProbablePitcher.player_id).toBe("gerrit-cole");
    expect(asProbablePitcher.starting_status).toBe("expected");
    expect(asProbablePitcher.handedness).toBe("R");
    expect(asProbablePitcher.mlb_stats_api_id).toBeNull();
  });

  it("ProjectedLineupEntry fields are a superset of LineupEntry", () => {
    // LineupEntry has: player_id, batting_order, starting_status, position
    // ProjectedLineupEntry adds: team_id (used for routing, not leaked downstream)
    const entry = makeLineupEntry("nyy-1", "nyy", 1, "RF");

    const asLineupEntry: LineupEntry = {
      player_id: entry.player_id,
      batting_order: entry.batting_order,
      starting_status: entry.starting_status,
      position: entry.position
    };

    expect(asLineupEntry.player_id).toBe("nyy-1");
    expect(asLineupEntry.batting_order).toBe(1);
    expect(asLineupEntry.position).toBe("RF");
    expect(asLineupEntry.starting_status).toBe("expected");
  });

  it("no projected field requires knowledge of which provider sourced it", () => {
    const gameData = makeGameData();

    // A downstream consumer only needs canonical fields.
    // There is no provider discriminant, source URL, or API-specific ID
    // anywhere inside ProjectedGameData.
    const allKeys = new Set<string>();
    for (const key of Object.keys(gameData)) {
      allKeys.add(key);
    }
    if (gameData.away_starter) {
      for (const key of Object.keys(gameData.away_starter)) {
        allKeys.add(`starter.${key}`);
      }
    }
    if (gameData.away_lineup) {
      for (const key of Object.keys(gameData.away_lineup[0]!)) {
        allKeys.add(`lineup.${key}`);
      }
    }

    const providerSpecificPatterns = [
      "rotowire",
      "fangraphs",
      "espn",
      "source_url",
      "api_id",
      "scrape"
    ];

    for (const pattern of providerSpecificPatterns) {
      const leaked = [...allKeys].filter((k) =>
        k.toLowerCase().includes(pattern)
      );
      expect(leaked).toHaveLength(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Provider swap preserves canonical output shape
// ---------------------------------------------------------------------------

describe("projected-source adapter — provider swap", () => {
  it("two different adapters produce structurally identical canonical output", async () => {
    const sharedResult = makeResult();

    const adapterA = createTestProjectedSourceAdapter({ result: sharedResult });
    const adapterB = createAlternativeAdapter(sharedResult);

    expect(adapterA.source).toBe("test-projected");
    expect(adapterB.source).toBe("alternative-projected");
    expect(adapterA.source).not.toBe(adapterB.source);

    const resultA = await adapterA.fetchProjectedData("2026-04-10");
    const resultB = await adapterB.fetchProjectedData("2026-04-10");

    expect(resultA.success).toBe(true);
    expect(resultB.success).toBe(true);

    if (!resultA.success || !resultB.success) {
      throw new Error("Both adapters should succeed");
    }

    // Games array is structurally identical
    expect(resultA.data.games).toEqual(resultB.data.games);

    // Provider metadata differs (that's the point)
    expect(resultA.data.provider_meta.provider).toBe("test-projected");
    expect(resultB.data.provider_meta.provider).toBe("alternative-projected");
  });

  it("consumer code works identically regardless of adapter source", async () => {
    const sharedResult = makeResult();

    // Simulate a consumer function that only uses canonical shapes
    const consumeProjections = (
      adapter: ProjectedSourceAdapter
    ): Promise<{
      starters: number;
      lineupPlayers: number;
    }> =>
      adapter.fetchProjectedData("2026-04-10").then((result) => {
        if (!result.success) {
          return { starters: 0, lineupPlayers: 0 };
        }
        let starters = 0;
        let lineupPlayers = 0;
        for (const game of result.data.games) {
          if (game.away_starter) starters++;
          if (game.home_starter) starters++;
          lineupPlayers += game.away_lineup?.length ?? 0;
          lineupPlayers += game.home_lineup?.length ?? 0;
        }
        return { starters, lineupPlayers };
      });

    const fromA = await consumeProjections(
      createTestProjectedSourceAdapter({ result: sharedResult })
    );
    const fromB = await consumeProjections(
      createAlternativeAdapter(sharedResult)
    );

    expect(fromA).toEqual(fromB);
    expect(fromA.starters).toBe(2);
    expect(fromA.lineupPlayers).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// 5. Adapter source discriminant
// ---------------------------------------------------------------------------

describe("projected-source adapter — source discriminant", () => {
  it("source field is a string that identifies the provider", () => {
    const adapter = createTestProjectedSourceAdapter();
    expect(typeof adapter.source).toBe("string");
    expect(adapter.source).toBe("test-projected");
  });

  it("different adapters have different source values", () => {
    const adapterA = createTestProjectedSourceAdapter();
    const adapterB = createAlternativeAdapter(makeResult());

    expect(adapterA.source).not.toBe(adapterB.source);
  });
});
