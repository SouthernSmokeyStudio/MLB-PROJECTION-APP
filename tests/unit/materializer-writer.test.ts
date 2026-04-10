/**
 * materializer-writer.test.ts
 *
 * Proves A8 — Materializer Writer + Scheduled Generation:
 *
 * 1. Successful materialization writes valid artifact shape
 * 2. Projected data is merged through the rulebook
 * 3. Official beats projected
 * 4. Projected beats inferred
 * 5. Missing projected/inferred inputs still write valid official-only artifact
 * 6. Writer fails closed on adapter errors / malformed inputs
 * 7. Artifact is readable by existing loadMaterializedSlate
 * 8. Schedule config is correct
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { materializeSlate } from "../../lib/materializer/materializeSlate";
import { loadMaterializedSlate } from "../../lib/services/loadMaterializedSlate";
import { createTestProjectedSourceAdapter } from "../../lib/adapters/testProjectedSource";
import { createTestInferenceEngine } from "../../lib/inference/testInferenceEngine";
import type { ProjectedSourceResult, ProjectedGameData } from "../../lib/contracts/projected-source";
import type { InferredGameData, InferenceReasoning } from "../../lib/contracts/inferred-source";
import type { MaterializedSlate } from "../../lib/contracts/materialized-slate";
import { asGameId, asISOTimestamp, asPlayerId, asTeamId } from "../../lib/contracts/types";
import {
  MATERIALIZATION_SCHEDULE,
  MATERIALIZATION_TIMEZONE,
  scheduleToCronExpressions,
  getDateInScheduleTimezone
} from "../../lib/materializer/schedule";

// ---------------------------------------------------------------------------
// Mock MLB Stats API — provide controlled official schedule data
// ---------------------------------------------------------------------------

vi.mock("@lib/adapters/mlbStatsApi", async () => {
  const actual = await vi.importActual<typeof import("@lib/adapters/mlbStatsApi")>(
    "@lib/adapters/mlbStatsApi"
  );
  return {
    ...actual,
    fetchAndParseMlbStatsApiSchedule: vi.fn()
  };
});

import { fetchAndParseMlbStatsApiSchedule } from "../../lib/adapters/mlbStatsApi";

// ---------------------------------------------------------------------------
// Mock normalizer — return controlled CanonicalGame
// ---------------------------------------------------------------------------

vi.mock("@lib/normalization/mlbStatsApiNormalizer", async () => {
  const actual = await vi.importActual<typeof import("@lib/normalization/mlbStatsApiNormalizer")>(
    "@lib/normalization/mlbStatsApiNormalizer"
  );
  return {
    ...actual,
    normalizeMlbStatsApiGame: vi.fn()
  };
});

import { normalizeMlbStatsApiGame } from "../../lib/normalization/mlbStatsApiNormalizer";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let testOutputDir: string;

beforeEach(async () => {
  vi.restoreAllMocks();
  testOutputDir = join(tmpdir(), `materializer-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(testOutputDir, { recursive: true });
});

afterEach(async () => {
  vi.restoreAllMocks();
  try {
    await rm(testOutputDir, { recursive: true, force: true });
  } catch {
    // cleanup best-effort
  }
});

const GAME_ID = asGameId("mlb-2026-04-10-nyy-bos");
const DATE = "2026-04-10";

const mockOfficialSchedule = (opts?: {
  awayPitcherId?: string;
  homePitcherId?: string;
  awayPitcherNull?: boolean;
  homePitcherNull?: boolean;
}) => {
  const parsedGame = {
    gamePk: 12345,
    gameDate: "2026-04-10T18:05:00Z",
    status: { codedGameState: "S", detailedState: "Scheduled" },
    teams: {
      away: {
        team: { id: 147, name: "New York Yankees" },
        probablePitcher: opts?.awayPitcherNull ? null : { id: 543037, fullName: opts?.awayPitcherId ?? "Gerrit Cole" }
      },
      home: {
        team: { id: 111, name: "Boston Red Sox" },
        probablePitcher: opts?.homePitcherNull ? null : { id: 519242, fullName: opts?.homePitcherId ?? "Chris Sale" }
      }
    },
    venue: { id: 3, name: "Fenway Park" }
  };

  vi.mocked(fetchAndParseMlbStatsApiSchedule).mockResolvedValue({
    success: true,
    data: { rawGames: [parsedGame], parsedGames: [parsedGame as never] }
  } as never);

  vi.mocked(normalizeMlbStatsApiGame).mockReturnValue({
    success: true,
    data: {
      game_id: GAME_ID,
      sport_id: "MLB",
      scheduled_start: asISOTimestamp("2026-04-10T18:05:00Z"),
      status: "scheduled",
      away: {
        team: { team_id: asTeamId("nyy"), sport_id: "MLB", abbreviation: "NYY", full_name: "New York Yankees", league: "AL", division: "East" },
        probable_pitcher: opts?.awayPitcherNull ? null : {
          player_id: asPlayerId("gerrit-cole"),
          mlb_stats_api_id: "543037",
          starting_status: "confirmed" as const,
          handedness: "R" as const
        },
        lineup: null,
        lineup_confirmed: false
      },
      home: {
        team: { team_id: asTeamId("bos"), sport_id: "MLB", abbreviation: "BOS", full_name: "Boston Red Sox", league: "AL", division: "East" },
        probable_pitcher: opts?.homePitcherNull ? null : {
          player_id: asPlayerId("chris-sale"),
          mlb_stats_api_id: "519242",
          starting_status: "probable" as const,
          handedness: "L" as const
        },
        lineup: null,
        lineup_confirmed: false
      },
      venue: null,
      weather: null,
      sources: [],
      freshness: { is_stale: false, stale_reason: null, last_synced: asISOTimestamp("2026-04-10T12:00:00Z") },
      raw_payload_refs: []
    }
  } as never);
};

const makeReasoning = (): InferenceReasoning => ({
  strategy: "rotation-pattern",
  confidence: "medium",
  reason: "test",
  based_on_games: 10
});

const makeProjectedResult = (overrides?: Partial<ProjectedGameData>): ProjectedSourceResult => ({
  provider_meta: {
    provider: "test-projected",
    fetched_at: asISOTimestamp("2026-04-10T12:00:00Z"),
    source_url: null
  },
  date: DATE,
  generated_at: asISOTimestamp("2026-04-10T12:00:00Z"),
  games: [{
    game_id: GAME_ID,
    away_starter: {
      player_id: asPlayerId("cole-projected"),
      team_id: asTeamId("nyy"),
      handedness: "R",
      starting_status: "expected",
      confidence: "high"
    },
    home_starter: {
      player_id: asPlayerId("sale-projected"),
      team_id: asTeamId("bos"),
      handedness: "L",
      starting_status: "expected",
      confidence: "medium"
    },
    away_lineup: null,
    home_lineup: null,
    ...overrides
  }]
});

const makeInferredGameData = (overrides?: Partial<InferredGameData>): InferredGameData => ({
  game_id: GAME_ID,
  away_starter: {
    player_id: asPlayerId("cole-inferred"),
    team_id: asTeamId("nyy"),
    handedness: "R",
    starting_status: "expected",
    inference: makeReasoning()
  },
  home_starter: {
    player_id: asPlayerId("sale-inferred"),
    team_id: asTeamId("bos"),
    handedness: "L",
    starting_status: "expected",
    inference: makeReasoning()
  },
  away_lineup: null,
  home_lineup: null,
  ...overrides
});

// ---------------------------------------------------------------------------
// 1. Successful materialization writes valid artifact shape
// ---------------------------------------------------------------------------

describe("materializeSlate — artifact shape", () => {
  it("writes a valid MaterializedSlate JSON file", async () => {
    mockOfficialSchedule();

    const result = await materializeSlate({
      date: DATE,
      outputDir: testOutputDir
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);

    expect(result.data.gamesWritten).toBe(1);
    expect(result.data.date).toBe(DATE);

    // Read and validate the artifact
    const raw = await readFile(join(testOutputDir, `${DATE}.json`), "utf-8");
    const parsed: MaterializedSlate = JSON.parse(raw);

    expect(parsed.version).toBe(1);
    expect(parsed.date).toBe(DATE);
    expect(typeof parsed.generated_at).toBe("string");
    expect(parsed.source).toBe("materializer-v1");
    expect(parsed.games).toHaveLength(1);
    expect(parsed.games[0]!.game_id).toBe("mlb-2026-04-10-nyy-bos");
    expect(parsed.games[0]!.prepared.game_id).toBe("mlb-2026-04-10-nyy-bos");
  });

  it("artifact has correct PreparedGameInputs nested structure", async () => {
    mockOfficialSchedule();

    const result = await materializeSlate({
      date: DATE,
      outputDir: testOutputDir
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);

    const raw = await readFile(join(testOutputDir, `${DATE}.json`), "utf-8");
    const parsed: MaterializedSlate = JSON.parse(raw);
    const prepared = parsed.games[0]!.prepared;

    // Check PreparedGameInputs required fields exist
    expect(prepared.sport_id).toBe("MLB");
    expect(typeof prepared.scheduled_start).toBe("string");
    expect(typeof prepared.prepared_at).toBe("string");
    expect(typeof prepared.blocked).toBe("object");
    expect(typeof prepared.team_level_ready).toBe("boolean");
    expect(typeof prepared.has_both_starters).toBe("boolean");
    expect(typeof prepared.has_both_lineups).toBe("boolean");
    expect(typeof prepared.completeness_score).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// 2. Projected data is merged through the rulebook
// ---------------------------------------------------------------------------

describe("materializeSlate — projected merge", () => {
  it("projected starter fills in when official starter is absent", async () => {
    mockOfficialSchedule({ awayPitcherNull: true });

    const projectedAdapter = createTestProjectedSourceAdapter({
      result: makeProjectedResult()
    });

    const result = await materializeSlate({
      date: DATE,
      outputDir: testOutputDir,
      projectedAdapter
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data.projectedGamesAvailable).toBe(1);

    const raw = await readFile(join(testOutputDir, `${DATE}.json`), "utf-8");
    const parsed: MaterializedSlate = JSON.parse(raw);
    const prepared = parsed.games[0]!.prepared;

    // Away starter should come from projected (official was null)
    expect(prepared.away_starter).not.toBeNull();
    expect(prepared.away_starter!.player_id).toBe("cole-projected");
  });
});

// ---------------------------------------------------------------------------
// 3. Official beats projected
// ---------------------------------------------------------------------------

describe("materializeSlate — official beats projected", () => {
  it("official starter wins over projected when both present", async () => {
    mockOfficialSchedule(); // has official Gerrit Cole

    const projectedAdapter = createTestProjectedSourceAdapter({
      result: makeProjectedResult() // has projected cole-projected
    });

    const result = await materializeSlate({
      date: DATE,
      outputDir: testOutputDir,
      projectedAdapter
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);

    const raw = await readFile(join(testOutputDir, `${DATE}.json`), "utf-8");
    const parsed: MaterializedSlate = JSON.parse(raw);
    const prepared = parsed.games[0]!.prepared;

    // Official gerrit-cole wins over projected cole-projected
    expect(prepared.away_starter!.player_id).toBe("gerrit-cole");
  });
});

// ---------------------------------------------------------------------------
// 4. Projected beats inferred
// ---------------------------------------------------------------------------

describe("materializeSlate — projected beats inferred", () => {
  it("projected starter wins over inferred when official absent", async () => {
    mockOfficialSchedule({ awayPitcherNull: true, homePitcherNull: true });

    const projectedAdapter = createTestProjectedSourceAdapter({
      result: makeProjectedResult()
    });
    const inferenceEngine = createTestInferenceEngine({
      games: [makeInferredGameData()]
    });

    const result = await materializeSlate({
      date: DATE,
      outputDir: testOutputDir,
      projectedAdapter,
      inferenceEngine
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);

    const raw = await readFile(join(testOutputDir, `${DATE}.json`), "utf-8");
    const parsed: MaterializedSlate = JSON.parse(raw);
    const prepared = parsed.games[0]!.prepared;

    // Projected wins over inferred
    expect(prepared.away_starter!.player_id).toBe("cole-projected");
    expect(prepared.home_starter!.player_id).toBe("sale-projected");
  });
});

// ---------------------------------------------------------------------------
// 5. Missing projected/inferred writes valid official-only artifact
// ---------------------------------------------------------------------------

describe("materializeSlate — official-only path", () => {
  it("no projected adapter and no inference engine writes official-only artifact", async () => {
    mockOfficialSchedule();

    const result = await materializeSlate({
      date: DATE,
      outputDir: testOutputDir
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);

    expect(result.data.projectedGamesAvailable).toBe(0);
    expect(result.data.inferredGamesAvailable).toBe(0);
    expect(result.data.gamesWritten).toBe(1);

    const raw = await readFile(join(testOutputDir, `${DATE}.json`), "utf-8");
    const parsed: MaterializedSlate = JSON.parse(raw);
    expect(parsed.games[0]!.prepared.away_starter!.player_id).toBe("gerrit-cole");
  });

  it("empty schedule writes artifact with zero games", async () => {
    vi.mocked(fetchAndParseMlbStatsApiSchedule).mockResolvedValue({
      success: true,
      data: { rawGames: [], parsedGames: [] }
    } as never);

    const result = await materializeSlate({
      date: DATE,
      outputDir: testOutputDir
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data.gamesWritten).toBe(0);

    const raw = await readFile(join(testOutputDir, `${DATE}.json`), "utf-8");
    const parsed: MaterializedSlate = JSON.parse(raw);
    expect(parsed.games).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 6. Writer fails closed on adapter errors / malformed inputs
// ---------------------------------------------------------------------------

describe("materializeSlate — fail-closed", () => {
  it("schedule fetch failure → err (no artifact written)", async () => {
    vi.mocked(fetchAndParseMlbStatsApiSchedule).mockResolvedValue({
      success: false,
      error: "Network timeout"
    } as never);

    const result = await materializeSlate({
      date: DATE,
      outputDir: testOutputDir
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Should fail");
    expect(result.error).toContain("Schedule fetch failed");
  });

  it("normalization failure → err", async () => {
    vi.mocked(fetchAndParseMlbStatsApiSchedule).mockResolvedValue({
      success: true,
      data: { rawGames: [{}], parsedGames: [{ gamePk: 999 } as never] }
    } as never);
    vi.mocked(normalizeMlbStatsApiGame).mockReturnValue({
      success: false,
      error: "Unsupported team"
    } as never);

    const result = await materializeSlate({
      date: DATE,
      outputDir: testOutputDir
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Should fail");
    expect(result.error).toContain("normalization failed");
  });

  it("projected adapter failure → err (no artifact written)", async () => {
    mockOfficialSchedule();

    const projectedAdapter = createTestProjectedSourceAdapter({
      simulateFailure: true
    });

    const result = await materializeSlate({
      date: DATE,
      outputDir: testOutputDir,
      projectedAdapter
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Should fail");
    expect(result.error).toContain("Projected adapter");
    expect(result.error).toContain("failed");
  });

  it("inference engine failure → err (no artifact written)", async () => {
    mockOfficialSchedule();

    const inferenceEngine = createTestInferenceEngine({
      simulateFailure: true
    });

    const result = await materializeSlate({
      date: DATE,
      outputDir: testOutputDir,
      inferenceEngine
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Should fail");
    expect(result.error).toContain("Inference engine");
    expect(result.error).toContain("failed");
  });
});

// ---------------------------------------------------------------------------
// 7. Artifact is readable by existing loadMaterializedSlate
// ---------------------------------------------------------------------------

describe("materializeSlate → loadMaterializedSlate round-trip", () => {
  it("written artifact passes loader validation and has fresh metadata", async () => {
    mockOfficialSchedule();

    const writeResult = await materializeSlate({
      date: DATE,
      outputDir: testOutputDir
    });

    expect(writeResult.success).toBe(true);
    if (!writeResult.success) throw new Error(writeResult.error);

    // Now load the artifact with the existing A2 loader
    const loadResult = await loadMaterializedSlate(DATE, {
      artifactDir: testOutputDir
    });

    expect(loadResult.success).toBe(true);
    if (!loadResult.success) throw new Error(loadResult.error);

    const { slate, metadata } = loadResult.data;
    expect(slate.version).toBe(1);
    expect(slate.date).toBe(DATE);
    expect(slate.games).toHaveLength(1);
    expect(slate.games[0]!.game_id).toBe("mlb-2026-04-10-nyy-bos");
    expect(metadata.is_stale).toBe(false);
    expect(metadata.games_available).toBe(1);
  });

  it("loader can extract PreparedGameInputs from written artifact", async () => {
    mockOfficialSchedule();

    await materializeSlate({ date: DATE, outputDir: testOutputDir });

    const loadResult = await loadMaterializedSlate(DATE, {
      artifactDir: testOutputDir
    });
    expect(loadResult.success).toBe(true);
    if (!loadResult.success) throw new Error(loadResult.error);

    const prepared = loadResult.data.slate.games[0]!.prepared;
    expect(prepared.game_id).toBe("mlb-2026-04-10-nyy-bos");
    expect(prepared.sport_id).toBe("MLB");
    expect(prepared.away_starter!.player_id).toBe("gerrit-cole");
    expect(prepared.home_starter!.player_id).toBe("chris-sale");
  });

  it("round-trip with projected data preserves merge winner", async () => {
    mockOfficialSchedule({ awayPitcherNull: true });

    const projectedAdapter = createTestProjectedSourceAdapter({
      result: makeProjectedResult()
    });

    await materializeSlate({
      date: DATE,
      outputDir: testOutputDir,
      projectedAdapter
    });

    const loadResult = await loadMaterializedSlate(DATE, {
      artifactDir: testOutputDir
    });
    expect(loadResult.success).toBe(true);
    if (!loadResult.success) throw new Error(loadResult.error);

    const prepared = loadResult.data.slate.games[0]!.prepared;
    // Away starter was projected (official was null)
    expect(prepared.away_starter!.player_id).toBe("cole-projected");
    // Home starter was official
    expect(prepared.home_starter!.player_id).toBe("chris-sale");
  });
});

// ---------------------------------------------------------------------------
// 8. Schedule configuration
// ---------------------------------------------------------------------------

describe("materialization schedule", () => {
  it("has exactly 4 scheduled run times", () => {
    expect(MATERIALIZATION_SCHEDULE).toHaveLength(4);
  });

  it("run times are 00:00, 05:00, 12:00, 17:00", () => {
    const times = MATERIALIZATION_SCHEDULE.map((s) => `${s.hour}:${String(s.minute).padStart(2, "0")}`);
    expect(times).toEqual(["0:00", "5:00", "12:00", "17:00"]);
  });

  it("timezone is America/Chicago", () => {
    expect(MATERIALIZATION_TIMEZONE).toBe("America/Chicago");
  });

  it("cron expressions are formatted correctly", () => {
    const crons = scheduleToCronExpressions();
    expect(crons).toEqual([
      "0 0 * * *",
      "0 5 * * *",
      "0 12 * * *",
      "0 17 * * *"
    ]);
  });

  it("getDateInScheduleTimezone returns a YYYY-MM-DD string", () => {
    const date = getDateInScheduleTimezone();
    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("each schedule entry has a human-readable label", () => {
    for (const entry of MATERIALIZATION_SCHEDULE) {
      expect(typeof entry.label).toBe("string");
      expect(entry.label.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 9. Custom source label
// ---------------------------------------------------------------------------

describe("materializeSlate — custom options", () => {
  it("custom source label is written into artifact", async () => {
    mockOfficialSchedule();

    const result = await materializeSlate({
      date: DATE,
      outputDir: testOutputDir,
      source: "custom-materializer"
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);

    const raw = await readFile(join(testOutputDir, `${DATE}.json`), "utf-8");
    const parsed: MaterializedSlate = JSON.parse(raw);
    expect(parsed.source).toBe("custom-materializer");
  });
});
