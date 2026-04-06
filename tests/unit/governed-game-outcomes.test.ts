import { afterEach, describe, expect, it, vi } from "vitest";

const clearSupabaseEnv = (): void => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
};

afterEach(() => {
  vi.resetModules();
  vi.unmock("@supabase/supabase-js");
  vi.unmock("@lib/supabase/client");
  clearSupabaseEnv();
});

describe("governed game outcomes contract", () => {
  it("locks the governed enums and select list", async () => {
    const contract = await import("@lib/contracts/governed-game-outcomes");

    expect(contract.GOVERNED_REVIEW_STATUSES).toEqual(["APPROVED", "REJECTED"]);
    expect(contract.GOVERNED_REVIEW_TIERS).toEqual(["TIER_1", "TIER_2"]);
    expect(contract.CANDIDATE_SIDES).toEqual(["HOME", "AWAY"]);
    expect(contract.GOVERNED_GAME_OUTCOME_COLUMNS).toEqual([
      "game_id",
      "sport_id",
      "away_team_id",
      "home_team_id",
      "candidate_side",
      "predicted_home_win_probability",
      "review_tier",
      "review_status",
      "review_decision_reason",
      "run_id",
      "generated_at_utc",
      "is_stale",
      "stale_reason"
    ]);
  });
});

describe("governed supabase client", () => {
  it("fails closed when public read env vars are missing", async () => {
    const { getSupabaseReadClient } = await import("@lib/supabase/client");

    expect(() => getSupabaseReadClient()).toThrow(
      "Governed Supabase read client requires NEXT_PUBLIC_SUPABASE_URL."
    );
  });

  it("creates the read client with the public env vars only", async () => {
    const createClient = vi.fn(() => ({ mocked: true }));
    vi.doMock("@supabase/supabase-js", () => ({
      createClient
    }));

    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "public-anon-key";

    const { getSupabaseReadClient } = await import("@lib/supabase/client");

    expect(getSupabaseReadClient()).toEqual({ mocked: true });
    expect(createClient).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "public-anon-key",
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        }
      }
    );
  });
});

describe("readGovernedGameOutcomes", () => {
  it("builds the default MLB approved non-stale query in deterministic order", async () => {
    const eq = vi.fn();
    const order = vi.fn();
    const query = {
      select: vi.fn(() => query),
      eq: eq.mockImplementation(() => query),
      order: order.mockImplementation(() => query),
      then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
        Promise.resolve(
          resolve({
            data: [
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
            ],
            error: null
          })
        )
    };

    const fakeClient = {
      from: vi.fn(() => query)
    };

    vi.doMock("@lib/supabase/client", () => ({
      getSupabaseReadClient: () => fakeClient
    }));

    const { GOVERNED_GAME_OUTCOME_SELECT } = await import(
      "@lib/contracts/governed-game-outcomes"
    );
    const { readGovernedGameOutcomes } = await import(
      "@lib/supabase/readGovernedGameOutcomes"
    );

    const rows = await readGovernedGameOutcomes();

    expect(fakeClient.from).toHaveBeenCalledWith("governed_game_outcomes");
    expect(query.select).toHaveBeenCalledWith(GOVERNED_GAME_OUTCOME_SELECT);
    expect(eq).toHaveBeenNthCalledWith(1, "sport_id", "MLB");
    expect(eq).toHaveBeenNthCalledWith(2, "is_stale", false);
    expect(eq).toHaveBeenNthCalledWith(3, "review_status", "APPROVED");
    expect(order).toHaveBeenNthCalledWith(1, "generated_at_utc", { ascending: false });
    expect(order).toHaveBeenNthCalledWith(2, "game_id", { ascending: true });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.game_id).toBe("GAME005");
  });
});
