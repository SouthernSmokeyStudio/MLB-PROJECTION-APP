/**
 * projections-persist-auth.test.ts
 *
 * Proves that POST /api/projections/persist requires a valid CRON_SECRET
 * bearer token. Prior state: no auth guard — anyone could trigger a live
 * MLB fetch + database write.
 */

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock all heavy dependencies so the route module loads without network calls.
// The auth check fires before any of these are reached, but they must be
// mockable for the module to import cleanly.
// ---------------------------------------------------------------------------

vi.mock("@lib/services", () => ({
  loadLiveSlate: vi.fn()
}));

vi.mock("@lib/materializer", () => ({
  buildMaterializerConfig: vi.fn(() => ({ success: false }))
}));

vi.mock("@lib/materializer/schedule", () => ({
  getDateInScheduleTimezone: vi.fn(() => "2026-04-21")
}));

vi.mock("@lib/supabase/writeClient", () => ({
  getSupabaseWriteClient: vi.fn(() => ({
    from: vi.fn()
  }))
}));

vi.mock("@lib/starters/repository", () => ({
  createStarterIntelligenceRepository: vi.fn(() => ({
    readGameStarterIntelligenceByDate: vi.fn().mockResolvedValue([])
  }))
}));

vi.mock("@lib/starters/mapToProjectedGameData", () => ({
  mapStarterIntelligenceToProjectedGamesMap: vi.fn(() => new Map())
}));

vi.mock("@lib/services/persistPlayerProjections", () => ({
  persistPlayerProjections: vi.fn()
}));

vi.mock("@lib/projections/assembleGameProjection", () => ({
  assembleGameProjection: vi.fn()
}));

import { POST } from "@/app/api/projections/persist/route";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/projections/persist — auth gate", () => {
  const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.CRON_SECRET = "test-cron-secret-abc123";
  });

  afterEach(() => {
    if (ORIGINAL_CRON_SECRET === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
    }
  });

  it("returns 401 when no authorization header is provided", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/projections/persist", {
        method: "POST",
        body: JSON.stringify({ date: "2026-04-21" })
      })
    );
    expect(response.status).toBe(401);
    const body = await response.json() as Record<string, unknown>;
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 401 when authorization header uses wrong secret", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/projections/persist", {
        method: "POST",
        headers: { authorization: "Bearer wrong-secret" },
        body: JSON.stringify({ date: "2026-04-21" })
      })
    );
    expect(response.status).toBe(401);
  });

  it("returns 401 when authorization header uses correct format but wrong value", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/projections/persist", {
        method: "POST",
        headers: { authorization: "Bearer test-cron-secret-abc12" }, // one char short
        body: JSON.stringify({ date: "2026-04-21" })
      })
    );
    expect(response.status).toBe(401);
  });

  it("does not return 401 when correct CRON_SECRET bearer token is provided", async () => {
    // The handler will proceed past auth and reach loadLiveSlate which is mocked
    // to return nothing — the test just proves auth does NOT block a valid request.
    const { loadLiveSlate } = await import("@lib/services");
    vi.mocked(loadLiveSlate).mockResolvedValue({
      success: false,
      error: "No games found"
    });

    const response = await POST(
      new NextRequest("http://localhost/api/projections/persist", {
        method: "POST",
        headers: { authorization: "Bearer test-cron-secret-abc123" },
        body: JSON.stringify({ date: "2026-04-21" })
      })
    );
    // 401 is the only value we're proving against — any other status (502, 422, 200)
    // means the auth gate was passed correctly.
    expect(response.status).not.toBe(401);
  });
});
