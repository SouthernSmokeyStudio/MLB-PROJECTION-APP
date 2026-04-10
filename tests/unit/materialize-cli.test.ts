/**
 * materialize-cli.test.ts
 *
 * Proves the CLI entry point (scripts/materialize.ts) correctly wires
 * buildMaterializerConfig output into materializeSlate input:
 *
 * 1. Normal scheduled path passes a non-null projectedAdapter
 * 2. Normal scheduled path passes a non-null inferenceEngine
 * 3. --official-only → materializeSlate sees no adapter/engine keys
 * 4. Config error → process.exit(1), materializeSlate never called
 * 5. Materialization error → process.exit(1)
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Saved originals
// ---------------------------------------------------------------------------

const savedArgv = [...process.argv];
const savedEnv = { ...process.env };
const savedExit = process.exit;

// ---------------------------------------------------------------------------
// Mocks — rebuilt per test via vi.doMock after vi.resetModules
// ---------------------------------------------------------------------------

let mockMaterializeSlate: ReturnType<typeof vi.fn>;
let mockBuildConfig: ReturnType<typeof vi.fn>;
let exitSpy: ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.resetModules();

  mockMaterializeSlate = vi.fn();
  mockBuildConfig = vi.fn();
  exitSpy = vi.fn();

  // Mock the three modules the CLI script imports.
  // Paths resolve relative to THIS file → same absolute modules the script uses.
  vi.doMock("../../lib/materializer/materializeSlate", () => ({
    materializeSlate: mockMaterializeSlate
  }));

  vi.doMock("../../lib/materializer/buildMaterializerConfig", () => ({
    buildMaterializerConfig: mockBuildConfig
  }));

  vi.doMock("../../lib/materializer/schedule", () => ({
    getDateInScheduleTimezone: () => "2026-04-10",
    MATERIALIZATION_SCHEDULE: [
      { hour: 0, minute: 0, label: "midnight" }
    ],
    MATERIALIZATION_TIMEZONE: "America/Chicago"
  }));

  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});

  // Intercept process.exit so the script doesn't kill the test runner.
  // NOTE: code after process.exit continues (it's a no-op mock), which
  // can cause a secondary throw when destructuring config.data on an
  // error result.  The .catch() handler swallows it and calls exit again.
  // This is expected; we only assert exit was called with the right code.
  process.exit = exitSpy as unknown as typeof process.exit;
});

afterEach(() => {
  process.argv = savedArgv;
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  Object.assign(process.env, savedEnv);
  process.exit = savedExit;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Import the self-executing script and wait for async main() to settle. */
const runCli = async (): Promise<void> => {
  await import("../../scripts/materialize");
  // All mocked async fns resolve instantly; one macro-tick lets the
  // promise chain inside main() settle.
  await new Promise((r) => setTimeout(r, 50));
};

// Reusable fake adapters / engines (frozen so tests can't mutate them)
const fakeAdapter = Object.freeze({
  source: "rotowire" as const,
  fetchProjectedData: vi.fn()
});

const fakeEngine = Object.freeze({
  engine: "test-inference" as const,
  inferLineups: vi.fn()
});

const successSlateResult = {
  success: true as const,
  data: {
    artifactPath: "/tmp/slate-2026-04-10.json",
    date: "2026-04-10",
    generatedAt: "2026-04-10T12:00:00Z",
    gamesWritten: 8,
    projectedGamesAvailable: 6,
    inferredGamesAvailable: 0
  }
};

// ---------------------------------------------------------------------------
// 1. Full merge path — adapter & engine wiring
// ---------------------------------------------------------------------------

describe("CLI wiring — full merge path", () => {
  const setupFullMerge = () => {
    mockBuildConfig.mockReturnValue({
      success: true,
      data: {
        projectedAdapter: fakeAdapter,
        inferenceEngine: fakeEngine,
        officialOnly: false
      }
    });
    mockMaterializeSlate.mockResolvedValue(successSlateResult);
  };

  it("passes non-null projectedAdapter to materializeSlate", async () => {
    process.argv = ["node", "materialize.ts"];
    setupFullMerge();

    await runCli();

    expect(mockMaterializeSlate).toHaveBeenCalledOnce();
    expect(mockMaterializeSlate.mock.calls[0]![0].projectedAdapter).toBe(
      fakeAdapter
    );
  });

  it("passes non-null inferenceEngine to materializeSlate", async () => {
    process.argv = ["node", "materialize.ts"];
    setupFullMerge();

    await runCli();

    expect(mockMaterializeSlate).toHaveBeenCalledOnce();
    expect(mockMaterializeSlate.mock.calls[0]![0].inferenceEngine).toBe(
      fakeEngine
    );
  });

  it("passes the resolved date to materializeSlate", async () => {
    process.argv = ["node", "materialize.ts", "2026-06-15"];
    setupFullMerge();

    await runCli();

    expect(mockMaterializeSlate).toHaveBeenCalledOnce();
    expect(mockMaterializeSlate.mock.calls[0]![0].date).toBe("2026-06-15");
  });

  it("defaults to schedule timezone date when no date arg given", async () => {
    process.argv = ["node", "materialize.ts"];
    setupFullMerge();

    await runCli();

    expect(mockMaterializeSlate).toHaveBeenCalledOnce();
    // getDateInScheduleTimezone is mocked to return "2026-04-10"
    expect(mockMaterializeSlate.mock.calls[0]![0].date).toBe("2026-04-10");
  });

  it("forwards env vars to buildMaterializerConfig", async () => {
    process.argv = ["node", "materialize.ts"];
    process.env.ROTOWIRE_ENDPOINT_URL = "https://test.rotowire.example.com";
    process.env.ROTOWIRE_TIMEOUT_MS = "8000";
    setupFullMerge();

    await runCli();

    expect(mockBuildConfig).toHaveBeenCalledOnce();
    const [env, flags] = mockBuildConfig.mock.calls[0]!;
    expect(env.ROTOWIRE_ENDPOINT_URL).toBe(
      "https://test.rotowire.example.com"
    );
    expect(env.ROTOWIRE_TIMEOUT_MS).toBe("8000");
    expect(flags.officialOnly).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. --official-only path
// ---------------------------------------------------------------------------

describe("CLI wiring — --official-only path", () => {
  const setupOfficialOnly = () => {
    mockBuildConfig.mockReturnValue({
      success: true,
      data: {
        projectedAdapter: null,
        inferenceEngine: null,
        officialOnly: true
      }
    });
    mockMaterializeSlate.mockResolvedValue(successSlateResult);
  };

  it("passes officialOnly: true flag to buildMaterializerConfig", async () => {
    process.argv = ["node", "materialize.ts", "--official-only"];
    setupOfficialOnly();

    await runCli();

    expect(mockBuildConfig).toHaveBeenCalledOnce();
    expect(mockBuildConfig.mock.calls[0]![1].officialOnly).toBe(true);
  });

  it("does NOT pass projectedAdapter key when config returns null", async () => {
    process.argv = ["node", "materialize.ts", "--official-only"];
    setupOfficialOnly();

    await runCli();

    expect(mockMaterializeSlate).toHaveBeenCalledOnce();
    const opts = mockMaterializeSlate.mock.calls[0]![0];
    expect("projectedAdapter" in opts).toBe(false);
  });

  it("does NOT pass inferenceEngine key when config returns null", async () => {
    process.argv = ["node", "materialize.ts", "--official-only"];
    setupOfficialOnly();

    await runCli();

    expect(mockMaterializeSlate).toHaveBeenCalledOnce();
    const opts = mockMaterializeSlate.mock.calls[0]![0];
    expect("inferenceEngine" in opts).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Error paths — fail-closed
// ---------------------------------------------------------------------------

describe("CLI wiring — error paths", () => {
  it("exits 1 when buildMaterializerConfig fails", async () => {
    process.argv = ["node", "materialize.ts"];
    mockBuildConfig.mockReturnValue({
      success: false,
      error:
        "ROTOWIRE_ENDPOINT_URL is not set. Set the env var or pass --official-only to skip."
    });

    await runCli();

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockMaterializeSlate).not.toHaveBeenCalled();
  });

  it("logs CONFIG ERROR to stderr on config failure", async () => {
    process.argv = ["node", "materialize.ts"];
    mockBuildConfig.mockReturnValue({
      success: false,
      error: "ROTOWIRE_ENDPOINT_URL is not set."
    });

    await runCli();

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("CONFIG ERROR")
    );
  });

  it("exits 1 when materializeSlate returns an error result", async () => {
    process.argv = ["node", "materialize.ts"];
    mockBuildConfig.mockReturnValue({
      success: true,
      data: {
        projectedAdapter: fakeAdapter,
        inferenceEngine: fakeEngine,
        officialOnly: false
      }
    });
    mockMaterializeSlate.mockResolvedValue({
      success: false,
      error: "Schedule fetch failed"
    });

    await runCli();

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("does NOT silently produce a successful run on missing config", async () => {
    process.argv = ["node", "materialize.ts"];
    mockBuildConfig.mockReturnValue({
      success: false,
      error:
        "ROTOWIRE_ENDPOINT_URL is not set. Set the env var or pass --official-only to skip."
    });

    await runCli();

    // Must exit with error, NOT call materializeSlate with null adapters
    expect(mockMaterializeSlate).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
