import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.unmock("@lib/supabase/readGovernedGameOutcomes");
});

describe("GET /api/games/governed", () => {
  it("returns the governed games payload on success", async () => {
    vi.doMock("@lib/supabase/readGovernedGameOutcomes", () => ({
      readGovernedGameOutcomes: vi.fn(async () => [
        {
          game_id: "GAME005",
          sport_id: "MLB",
          away_team_id: "A05",
          home_team_id: "H05",
          candidate_side: "HOME",
          predicted_home_win_probability: 0.88,
          review_tier: "TIER_1",
          review_status: "APPROVED",
          review_decision_reason: "Accepted after analyst review.",
          run_id: "run-2026-04-04-a",
          generated_at_utc: "2026-04-04T12:00:00Z",
          is_stale: false,
          stale_reason: null
        }
      ])
    }));

    const { GET } = await import("@/app/api/games/governed/route");
    const response = await GET();
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      source: "supabase-governed",
      sport_id: "MLB",
      review_status: "APPROVED",
      include_stale: false,
      count: 1,
      games: [
        {
          game_id: "GAME005",
          sport_id: "MLB",
          away_team_id: "A05",
          home_team_id: "H05",
          candidate_side: "HOME",
          predicted_home_win_probability: 0.88,
          review_tier: "TIER_1",
          review_status: "APPROVED",
          review_decision_reason: "Accepted after analyst review.",
          run_id: "run-2026-04-04-a",
          generated_at_utc: "2026-04-04T12:00:00Z",
          is_stale: false,
          stale_reason: null
        }
      ]
    });
  });

  it("returns a clean error response on failure", async () => {
    vi.doMock("@lib/supabase/readGovernedGameOutcomes", () => ({
      readGovernedGameOutcomes: vi.fn(async () => {
        throw new Error("broken read");
      })
    }));

    const { GET } = await import("@/app/api/games/governed/route");
    const response = await GET();
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(500);
    expect(payload).toEqual({
      source: "supabase-governed",
      error: "broken read"
    });
  });
});
