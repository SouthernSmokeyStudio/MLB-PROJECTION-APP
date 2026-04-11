/**
 * inferred-source.test.ts
 *
 * Proves the Tier 3 inference contract for A4:
 * - provider-neutral inferred shape
 * - fail-closed Result behavior
 * - downstream compatibility without inference-specific leakage
 * - deterministic behavior from the test engine
 * - confidence + reasoning metadata
 */

import { describe, expect, it } from "vitest";
import type {
  InferenceContext,
  InferenceEngine,
  InferenceResult,
  InferenceReasoning,
  InferredGameData,
  InferredLineupEntry,
  InferredStarter
} from "../../lib/contracts/inferred-source";
import type { LineupEntry, ProbablePitcher } from "../../lib/contracts/canonical";
import type { ProjectedLineupEntry, ProjectedStarter } from "../../lib/contracts/projected-source";
import { asGameId, asPlayerId, asTeamId } from "../../lib/contracts/types";
import { createTestInferenceEngine } from "../../lib/inference/testInferenceEngine";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeReasoning = (
  overrides: Partial<InferenceReasoning> = {}
): InferenceReasoning => ({
  strategy: "rotation-pattern",
  confidence: "medium",
  reason: "Pitcher on 5-day rotation, last started 5 days ago",
  based_on_games: 12,
  ...overrides
});

const makeInferredStarter = (
  playerId: string,
  teamId: string,
  overrides: Partial<InferenceReasoning> = {}
): InferredStarter => ({
  player_id: asPlayerId(playerId),
  team_id: asTeamId(teamId),
  handedness: "R",
  starting_status: "expected",
  inference: makeReasoning(overrides)
});

const makeInferredLineupEntry = (
  playerId: string,
  teamId: string,
  order: number,
  position: "C" | "1B" | "2B" | "3B" | "SS" | "LF" | "CF" | "RF" | "DH"
): InferredLineupEntry => ({
  player_id: asPlayerId(playerId),
  team_id: asTeamId(teamId),
  batting_order: order,
  position,
  starting_status: "expected",
  inference: makeReasoning({
    strategy: "recent-lineup-frequency",
    reason: `Started ${order === 1 ? "leadoff" : `${order}th`} in 8 of last 12 games`,
    based_on_games: 12
  })
});

const makeInferredGameData = (): InferredGameData => ({
  game_id: asGameId("mlb-2026-04-10-nyy-bos"),
  away_starter: makeInferredStarter("gerrit-cole", "nyy"),
  home_starter: {
    ...makeInferredStarter("chris-sale", "bos", {
      confidence: "high",
      reason: "Ace, normal rotation",
      based_on_games: 20
    }),
    handedness: "L"
  },
  away_lineup: [
    makeInferredLineupEntry("nyy-1", "nyy", 1, "RF"),
    makeInferredLineupEntry("nyy-2", "nyy", 2, "SS")
  ],
  home_lineup: [
    makeInferredLineupEntry("bos-1", "bos", 1, "LF"),
    makeInferredLineupEntry("bos-2", "bos", 2, "3B")
  ]
});

const makeContext = (): InferenceContext => ({
  date: "2026-04-10",
  game_ids: [asGameId("mlb-2026-04-10-nyy-bos")]
});

// ---------------------------------------------------------------------------
// 1. Provider-neutral inferred shape
// ---------------------------------------------------------------------------

describe("inference contract — provider-neutral shape", () => {
  it("InferredStarter has canonical fields plus inference metadata", () => {
    const starter = makeInferredStarter("gerrit-cole", "nyy");

    expect(starter.player_id).toBe("gerrit-cole");
    expect(starter.team_id).toBe("nyy");
    expect(starter.handedness).toBe("R");
    expect(starter.starting_status).toBe("expected");
    expect(starter.inference.strategy).toBe("rotation-pattern");
    expect(starter.inference.confidence).toBe("medium");

    const keys = Object.keys(starter).sort();
    expect(keys).toEqual([
      "handedness",
      "inference",
      "player_id",
      "starting_status",
      "team_id"
    ]);
  });

  it("InferredLineupEntry has canonical fields plus inference metadata", () => {
    const entry = makeInferredLineupEntry("nyy-1", "nyy", 1, "RF");

    expect(entry.player_id).toBe("nyy-1");
    expect(entry.batting_order).toBe(1);
    expect(entry.position).toBe("RF");
    expect(entry.inference.strategy).toBe("recent-lineup-frequency");

    const keys = Object.keys(entry).sort();
    expect(keys).toEqual([
      "batting_order",
      "inference",
      "player_id",
      "position",
      "starting_status",
      "team_id"
    ]);
  });

  it("InferenceReasoning carries strategy, confidence, reason, and sample size", () => {
    const reasoning = makeReasoning();

    expect(reasoning.strategy).toBe("rotation-pattern");
    expect(reasoning.confidence).toBe("medium");
    expect(reasoning.reason).toBeTruthy();
    expect(reasoning.based_on_games).toBe(12);
  });

  it("InferredGameData groups inferred starters and lineups per side", () => {
    const game = makeInferredGameData();

    expect(game.game_id).toBe("mlb-2026-04-10-nyy-bos");
    expect(game.away_starter).not.toBeNull();
    expect(game.home_starter).not.toBeNull();
    expect(game.away_lineup).toHaveLength(2);
    expect(game.home_lineup).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 2. Fail-closed Result behavior
// ---------------------------------------------------------------------------

describe("inference engine — fail-closed", () => {
  it("engine failure returns err, not throws", async () => {
    const engine = createTestInferenceEngine({ simulateFailure: true });
    const result = await engine.infer("2026-04-10", makeContext());

    expect(result.success).toBe(false);

    if (!result.success) {
      expect(result.error).toBe("Test inference engine simulated failure");
    }
  });

  it("caller treats failure as no-inferred-data-available", async () => {
    const engine = createTestInferenceEngine({ simulateFailure: true });
    const result = await engine.infer("2026-04-10", makeContext());

    const games = result.success ? result.data.games : [];
    expect(games).toHaveLength(0);
  });

  it("engine success with empty games is valid", async () => {
    const engine = createTestInferenceEngine();
    const result = await engine.infer("2026-04-10", makeContext());

    expect(result.success).toBe(true);

    if (!result.success) throw new Error(result.error);

    expect(result.data.games).toHaveLength(0);
    expect(result.data.summary.starters_inferred).toBe(0);
    expect(result.data.summary.lineups_inferred).toBe(0);
  });

  it("engine result includes run summary with attempt and failure counts", async () => {
    const game = makeInferredGameData();
    const engine = createTestInferenceEngine({ games: [game] });
    const context: InferenceContext = {
      date: "2026-04-10",
      game_ids: [asGameId("mlb-2026-04-10-nyy-bos"), asGameId("mlb-2026-04-10-lad-sf")]
    };
    const result = await engine.infer("2026-04-10", context);

    expect(result.success).toBe(true);

    if (!result.success) throw new Error(result.error);

    expect(result.data.summary.games_attempted).toBe(2);
    expect(result.data.summary.starters_inferred).toBe(2);
    expect(result.data.summary.lineups_inferred).toBe(2);
    expect(result.data.summary.failures).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 3. Downstream compatibility — no inference leakage into canonical
// ---------------------------------------------------------------------------

describe("inference contract — downstream compatibility", () => {
  it("InferredStarter maps to ProbablePitcher by dropping inference metadata", () => {
    const inferred = makeInferredStarter("gerrit-cole", "nyy");

    const asProbable: ProbablePitcher = {
      player_id: inferred.player_id,
      mlb_stats_api_id: null,
      starting_status: inferred.starting_status,
      handedness: inferred.handedness
    };

    expect(asProbable.player_id).toBe("gerrit-cole");
    expect(asProbable.starting_status).toBe("expected");
    expect(asProbable.handedness).toBe("R");
    expect(asProbable).not.toHaveProperty("inference");
    expect(asProbable).not.toHaveProperty("team_id");
  });

  it("InferredStarter maps to ProjectedStarter by replacing inference with confidence", () => {
    const inferred = makeInferredStarter("gerrit-cole", "nyy");

    const asProjected: ProjectedStarter = {
      player_id: inferred.player_id,
      full_name: null,
      team_id: inferred.team_id,
      handedness: inferred.handedness,
      starting_status: inferred.starting_status,
      confidence: inferred.inference.confidence
    };

    expect(asProjected.confidence).toBe("medium");
    expect(asProjected).not.toHaveProperty("inference");
  });

  it("InferredLineupEntry maps to LineupEntry by dropping inference metadata", () => {
    const inferred = makeInferredLineupEntry("nyy-1", "nyy", 1, "RF");

    const asLineup: LineupEntry = {
      player_id: inferred.player_id,
      batting_order: inferred.batting_order,
      starting_status: inferred.starting_status,
      position: inferred.position
    };

    expect(asLineup.player_id).toBe("nyy-1");
    expect(asLineup.batting_order).toBe(1);
    expect(asLineup).not.toHaveProperty("inference");
    expect(asLineup).not.toHaveProperty("team_id");
  });

  it("InferredLineupEntry maps to ProjectedLineupEntry by dropping inference", () => {
    const inferred = makeInferredLineupEntry("nyy-1", "nyy", 1, "RF");

    const asProjected: ProjectedLineupEntry = {
      player_id: inferred.player_id,
      team_id: inferred.team_id,
      batting_order: inferred.batting_order,
      position: inferred.position,
      starting_status: inferred.starting_status
    };

    expect(asProjected).not.toHaveProperty("inference");
  });

  it("no inference field leaks when constructing canonical types", () => {
    const game = makeInferredGameData();

    // Simulate a downstream consumer that extracts canonical-only data.
    const awayPitcher: ProbablePitcher | null = game.away_starter
      ? {
          player_id: game.away_starter.player_id,
          mlb_stats_api_id: null,
          starting_status: game.away_starter.starting_status,
          handedness: game.away_starter.handedness
        }
      : null;

    const awayLineup: readonly LineupEntry[] | null = game.away_lineup
      ? game.away_lineup.map((e) => ({
          player_id: e.player_id,
          batting_order: e.batting_order,
          starting_status: e.starting_status,
          position: e.position
        }))
      : null;

    expect(awayPitcher).not.toBeNull();
    expect(awayPitcher).not.toHaveProperty("inference");
    expect(awayPitcher).not.toHaveProperty("team_id");

    expect(awayLineup).toHaveLength(2);
    for (const entry of awayLineup!) {
      expect(entry).not.toHaveProperty("inference");
      expect(entry).not.toHaveProperty("team_id");
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Deterministic behavior from test engine
// ---------------------------------------------------------------------------

describe("test inference engine — deterministic behavior", () => {
  it("same inputs produce structurally identical outputs", async () => {
    const game = makeInferredGameData();
    const engine = createTestInferenceEngine({ games: [game] });
    const context = makeContext();

    const resultA = await engine.infer("2026-04-10", context);
    const resultB = await engine.infer("2026-04-10", context);

    expect(resultA.success).toBe(true);
    expect(resultB.success).toBe(true);

    if (!resultA.success || !resultB.success) {
      throw new Error("Both calls should succeed");
    }

    expect(resultA.data.games).toEqual(resultB.data.games);
    expect(resultA.data.summary).toEqual(resultB.data.summary);
    expect(resultA.data.engine).toBe(resultB.data.engine);
    expect(resultA.data.date).toBe(resultB.data.date);
    // generated_at is hardcoded in test engine — deterministic
    expect(resultA.data.generated_at).toBe(resultB.data.generated_at);
  });

  it("engine discriminant identifies the implementation", () => {
    const engine = createTestInferenceEngine();
    expect(engine.engine).toBe("test-inference");
  });

  it("different engine instances can have different discriminants", () => {
    const engineA = createTestInferenceEngine();

    // A hypothetical second engine would have a different discriminant
    const engineB: InferenceEngine = {
      engine: "rotation-heuristic-v1",
      async infer() {
        return { success: true, data: {} as InferenceResult };
      }
    };

    expect(engineA.engine).not.toBe(engineB.engine);
  });
});

// ---------------------------------------------------------------------------
// 5. Confidence + reasoning metadata
// ---------------------------------------------------------------------------

describe("inference confidence and reasoning", () => {
  it("each inferred entry carries its own reasoning independently", () => {
    const game = makeInferredGameData();

    // Away starter and home starter can have different confidence/strategy
    expect(game.away_starter!.inference.confidence).toBe("medium");
    expect(game.home_starter!.inference.confidence).toBe("high");
    expect(game.away_starter!.inference.strategy).toBe("rotation-pattern");
    expect(game.home_starter!.inference.strategy).toBe("rotation-pattern");
  });

  it("lineup entries carry per-player reasoning", () => {
    const game = makeInferredGameData();

    for (const entry of game.away_lineup!) {
      expect(entry.inference.strategy).toBe("recent-lineup-frequency");
      expect(entry.inference.based_on_games).toBe(12);
      expect(entry.inference.reason).toBeTruthy();
    }
  });

  it("low confidence is expressible for speculative inferences", () => {
    const speculative = makeInferredStarter("unknown-pitcher", "nyy", {
      confidence: "low",
      strategy: "season-opener-fallback",
      reason: "No historical data, using depth chart",
      based_on_games: 0
    });

    expect(speculative.inference.confidence).toBe("low");
    expect(speculative.inference.based_on_games).toBe(0);
    expect(speculative.inference.strategy).toBe("season-opener-fallback");
  });
});
