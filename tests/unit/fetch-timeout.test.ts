import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_FETCH_TIMEOUT_MS, fetchWithTimeout } from "../../lib/adapters/fetchWithTimeout";
import {
  fetchMlbStatsApiSchedule,
  fetchMlbStatsApiBoxscore,
  fetchMlbStatsApiLinescore,
  fetchMlbStatsApiPitcherSeasonStats
} from "../../lib/adapters/mlbStatsApi";
import {
  fetchUpcomingDraftKingsClassicDraftGroups,
  fetchDraftKingsClassicSalarySlate
} from "../../lib/adapters/draftKings";
import {
  fetchDraftKingsSportsbookMlbMoneylineSlate
} from "../../lib/adapters/draftKingsSportsbook";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// fetchWithTimeout core behavior
// ---------------------------------------------------------------------------

describe("fetchWithTimeout core", () => {
  it("returns response on successful fetch", async () => {
    const mockResponse = new Response(JSON.stringify({ ok: true }), { status: 200 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

    const result = await fetchWithTimeout("https://example.com/api", {
      method: "GET"
    });

    expect(result.response).toBe(mockResponse);
    expect(result.error).toBeNull();
  });

  it("returns error string on timeout instead of hanging indefinitely", async () => {
    // Simulate a fetch that never resolves by using a very short timeout
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        // Listen for the abort signal to reject like a real fetch would
        if (init?.signal) {
          init.signal.addEventListener("abort", () => {
            const abortError = new DOMException("The operation was aborted", "TimeoutError");
            reject(abortError);
          });
        }
      });
    }));

    const result = await fetchWithTimeout("https://example.com/slow", {
      method: "GET",
      timeoutMs: 50 // 50ms timeout — will fire before the fetch "completes"
    });

    expect(result.response).toBeNull();
    expect(result.error).toContain("timed out");
    expect(result.error).toContain("50ms");
  });

  it("returns error string on network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    const result = await fetchWithTimeout("https://example.com/down", {
      method: "GET"
    });

    expect(result.response).toBeNull();
    expect(result.error).toContain("Failed to fetch");
  });

  it("returns error string on abort", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(
      new DOMException("The operation was aborted", "AbortError")
    ));

    const result = await fetchWithTimeout("https://example.com/aborted", {
      method: "GET"
    });

    expect(result.response).toBeNull();
    expect(result.error).toContain("aborted");
  });

  it("exports a sensible default timeout constant", () => {
    expect(DEFAULT_FETCH_TIMEOUT_MS).toBe(15_000);
  });
});

// ---------------------------------------------------------------------------
// MLB Stats API — timeout surfaces as controlled Result error, not hang
// ---------------------------------------------------------------------------
// These tests mock fetch to reject immediately with a TimeoutError — the same
// error type that AbortSignal.timeout produces when it fires. This verifies
// that the error flows through fetchWithTimeout's catch path and produces a
// controlled Result error in each adapter function.
// ---------------------------------------------------------------------------

describe("MLB Stats API timeout behavior", () => {
  const stubTimeoutFetch = () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(
      new DOMException("The operation was aborted", "TimeoutError")
    ));
  };

  it("schedule fetch timeout returns Result error, not hang", async () => {
    stubTimeoutFetch();

    const result = await fetchMlbStatsApiSchedule("2026-04-06");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("MLB Stats API schedule");
      expect(result.error).toContain("timed out");
    }
  });

  it("boxscore fetch timeout returns Result error, not hang", async () => {
    stubTimeoutFetch();

    const result = await fetchMlbStatsApiBoxscore(718765);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("MLB Stats API boxscore");
      expect(result.error).toContain("timed out");
    }
  });

  it("linescore fetch timeout returns Result error, not hang", async () => {
    stubTimeoutFetch();

    const result = await fetchMlbStatsApiLinescore(718765);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("MLB Stats API linescore");
      expect(result.error).toContain("timed out");
    }
  });

  it("pitcher season stats fetch timeout returns Result error, not hang", async () => {
    stubTimeoutFetch();

    const result = await fetchMlbStatsApiPitcherSeasonStats(543037, "2026");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("MLB Stats API pitcher season stats");
      expect(result.error).toContain("timed out");
    }
  });
});

// ---------------------------------------------------------------------------
// DraftKings Classic — timeout surfaces as controlled Result error
// (existing route behavior: DK failure → graceful degradation at 200)
// ---------------------------------------------------------------------------

describe("DraftKings Classic timeout behavior", () => {
  const stubTimeoutFetch = () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(
      new DOMException("The operation was aborted", "TimeoutError")
    ));
  };

  it("draft group fetch timeout returns Result error, not hang", async () => {
    stubTimeoutFetch();

    const result = await fetchUpcomingDraftKingsClassicDraftGroups();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("DraftKings Classic draft group");
      expect(result.error).toContain("timed out");
    }
  });

  it("salary slate fetch timeout returns Result error, not hang", async () => {
    stubTimeoutFetch();

    const result = await fetchDraftKingsClassicSalarySlate("12345");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("DraftKings Classic salary");
      expect(result.error).toContain("timed out");
    }
  });
});

// ---------------------------------------------------------------------------
// DraftKings Sportsbook — timeout surfaces as controlled Result error
// (existing route behavior: DK failure → graceful degradation at 200)
// ---------------------------------------------------------------------------

describe("DraftKings Sportsbook timeout behavior", () => {
  it("moneyline fetch timeout returns Result error, not hang", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(
      new DOMException("The operation was aborted", "TimeoutError")
    ));

    const result = await fetchDraftKingsSportsbookMlbMoneylineSlate();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("DraftKings Sportsbook MLB moneyline");
      expect(result.error).toContain("timed out");
    }
  });
});
