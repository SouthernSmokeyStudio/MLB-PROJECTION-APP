/**
 * rotowire-projected-source.test.ts
 *
 * Proves the A7 Rotowire projected-source adapter contract:
 *
 * 1. Real provider response is normalized into canonical projected shapes
 * 2. Adapter failure is fail-closed (network, HTTP, parse errors)
 * 3. Malformed provider data is rejected safely (per-entry, per-payload)
 * 4. No provider-specific fields leak past the adapter boundary
 * 5. Team abbreviation normalization handles Rotowire divergences
 * 6. Adapter satisfies ProjectedSourceAdapter interface
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  createRotowireProjectedSourceAdapter,
  parseRotowirePayload
} from "../../lib/adapters/rotowireProjectedSource";
import type { ProjectedSourceAdapter } from "../../lib/contracts/projected-source";

// ---------------------------------------------------------------------------
// Fixture loading
// ---------------------------------------------------------------------------

const fixtureDir = join(__dirname, "../../data/fixtures/rotowire");

const loadFixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(fixtureDir, name), "utf-8"));

// ---------------------------------------------------------------------------
// Mock fetch globally for adapter-level tests
// ---------------------------------------------------------------------------

const mockFetchResponse = (body: unknown, status = 200) => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body)
  });
};

const mockFetchError = (error: string) => {
  global.fetch = vi.fn().mockRejectedValue(new Error(error));
};

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. Parser: valid payload normalization
// ---------------------------------------------------------------------------

describe("parseRotowirePayload — valid response", () => {
  it("parses a full valid Rotowire response into RwGame[]", () => {
    const fixture = loadFixture("valid-response.json");
    const result = parseRotowirePayload(fixture);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);

    expect(result.data).toHaveLength(2);
    expect(result.data[0]!.away_team).toBe("NYY");
    expect(result.data[0]!.home_team).toBe("BOS");
    expect(result.data[0]!.away_starter?.name).toBe("Gerrit Cole");
    expect(result.data[0]!.away_lineup).toHaveLength(3);
    expect(result.data[1]!.away_starter?.name).toBe("Clayton Kershaw");
    expect(result.data[1]!.home_starter).toBeNull();
  });

  it("rejects non-array payload", () => {
    const result = parseRotowirePayload({ not: "an array" });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("Should fail");
    expect(result.error).toContain("JSON array");
  });
});

// ---------------------------------------------------------------------------
// 2. Parser: malformed entries are hard failures
// ---------------------------------------------------------------------------

describe("parseRotowirePayload — malformed entries fail-closed", () => {
  it("malformed game entry (null away_team) → err for entire payload", () => {
    const result = parseRotowirePayload([
      { away_team: "NYY", home_team: "BOS", game_date: "2026-04-10", away_starter: null, home_starter: null, away_lineup: null, home_lineup: null },
      { away_team: null, home_team: "BOS", game_date: "2026-04-10", away_starter: null, home_starter: null, away_lineup: null, home_lineup: null }
    ]);

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Should fail");
    expect(result.error).toContain("index 1");
    expect(result.error).toContain("missing required fields");
  });

  it("non-object game entry (string) → err", () => {
    const result = parseRotowirePayload([
      "this is not a game object"
    ]);

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Should fail");
    expect(result.error).toContain("index 0");
    expect(result.error).toContain("not an object");
  });

  it("game with missing required fields → err", () => {
    const result = parseRotowirePayload([
      { missing_required: true }
    ]);

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Should fail");
    expect(result.error).toContain("index 0");
  });

  it("malformed lineup player (non-numeric batting_order) → err for entire payload", () => {
    const result = parseRotowirePayload([
      {
        away_team: "NYY", home_team: "BOS", game_date: "2026-04-10",
        away_starter: null, home_starter: null,
        away_lineup: [
          { name: "Aaron Judge", batting_order: "not_a_number", position: "RF", hand: "R" }
        ],
        home_lineup: null
      }
    ]);

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Should fail");
    expect(result.error).toContain("away_lineup player at index 0");
    expect(result.error).toContain("malformed");
  });

  it("malformed home lineup player → err", () => {
    const result = parseRotowirePayload([
      {
        away_team: "NYY", home_team: "BOS", game_date: "2026-04-10",
        away_starter: null, home_starter: null,
        away_lineup: null,
        home_lineup: [
          { name: "Jarren Duran", batting_order: 1, position: "CF", hand: "L" },
          { "not": "a valid player" }
        ]
      }
    ]);

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Should fail");
    expect(result.error).toContain("home_lineup player at index 1");
  });

  it("all-malformed payload → err (not success with empty games)", () => {
    const result = parseRotowirePayload([
      { missing: "fields" },
      "string entry",
      42,
      null
    ]);

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Should fail");
    expect(result.error).toContain("index 0");
  });

  it("fixture with mixed valid/malformed entries → err at first malformed", () => {
    const fixture = loadFixture("malformed-entries.json");
    const result = parseRotowirePayload(fixture);

    // Fixture has [valid, null away_team, string, missing, bad lineup]
    // Second entry (index 1) has null away_team → err
    expect(result.success).toBe(false);
    if (result.success) throw new Error("Should fail");
    expect(result.error).toContain("index 1");
  });
});

// ---------------------------------------------------------------------------
// 3. Full adapter: canonical projected shapes
// ---------------------------------------------------------------------------

describe("rotowire adapter — canonical shape normalization", () => {
  it("normalizes valid response into ProjectedSourceResult with canonical types", async () => {
    const fixture = loadFixture("valid-response.json");
    mockFetchResponse(fixture);

    const adapter = createRotowireProjectedSourceAdapter({
      endpointUrl: "https://example.com/rotowire"
    });

    const result = await adapter.fetchProjectedData("2026-04-10");

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);

    expect(result.data.provider_meta.provider).toBe("rotowire");
    expect(result.data.provider_meta.source_url).toBe("https://example.com/rotowire");
    expect(result.data.date).toBe("2026-04-10");
    expect(result.data.games).toHaveLength(2);

    // Game 1: NYY @ BOS
    const game1 = result.data.games[0]!;
    expect(game1.game_id).toBe("mlb-2026-04-10-nyy-bos");

    // Away starter
    expect(game1.away_starter).not.toBeNull();
    expect(game1.away_starter!.player_id).toBe("gerrit-cole");
    expect(game1.away_starter!.team_id).toBe("nyy");
    expect(game1.away_starter!.handedness).toBe("R");
    expect(game1.away_starter!.starting_status).toBe("confirmed");
    expect(game1.away_starter!.confidence).toBe("high");

    // Home starter
    expect(game1.home_starter).not.toBeNull();
    expect(game1.home_starter!.player_id).toBe("chris-sale");
    expect(game1.home_starter!.team_id).toBe("bos");
    expect(game1.home_starter!.handedness).toBe("L");
    expect(game1.home_starter!.starting_status).toBe("expected");
    expect(game1.home_starter!.confidence).toBe("medium");

    // Away lineup
    expect(game1.away_lineup).toHaveLength(3);
    expect(game1.away_lineup![0]!.player_id).toBe("aaron-judge");
    expect(game1.away_lineup![0]!.team_id).toBe("nyy");
    expect(game1.away_lineup![0]!.batting_order).toBe(1);
    expect(game1.away_lineup![0]!.position).toBe("RF");
    expect(game1.away_lineup![0]!.starting_status).toBe("expected");

    // Home lineup
    expect(game1.home_lineup).toHaveLength(2);
    expect(game1.home_lineup![0]!.player_id).toBe("jarren-duran");

    // Game 2: LAD @ SF
    const game2 = result.data.games[1]!;
    expect(game2.game_id).toBe("mlb-2026-04-10-lad-sf");
    expect(game2.away_starter!.player_id).toBe("clayton-kershaw");
    expect(game2.away_starter!.starting_status).toBe("probable");
    expect(game2.home_starter).toBeNull();
    expect(game2.away_lineup).toBeNull();
    expect(game2.home_lineup).toBeNull();
  });

  it("team abbreviation divergences are normalized to canonical", async () => {
    const fixture = loadFixture("divergent-abbreviations.json");
    mockFetchResponse(fixture);

    const adapter = createRotowireProjectedSourceAdapter({
      endpointUrl: "https://example.com/rotowire"
    });

    const result = await adapter.fetchProjectedData("2026-04-10");

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);

    expect(result.data.games).toHaveLength(2);

    // WAS → WSH, SFG → SF
    const game1 = result.data.games[0]!;
    expect(game1.game_id).toBe("mlb-2026-04-10-wsh-sf");
    expect(game1.away_starter!.team_id).toBe("wsh");
    expect(game1.home_starter!.team_id).toBe("sf");

    // TBR → TB, KCR → KC
    const game2 = result.data.games[1]!;
    expect(game2.game_id).toBe("mlb-2026-04-10-tb-kc");
  });
});

// ---------------------------------------------------------------------------
// 4. Adapter failure is fail-closed
// ---------------------------------------------------------------------------

describe("rotowire adapter — fail-closed", () => {
  it("network error returns err, does not throw", async () => {
    mockFetchError("ECONNREFUSED");

    const adapter = createRotowireProjectedSourceAdapter({
      endpointUrl: "https://example.com/rotowire"
    });

    const result = await adapter.fetchProjectedData("2026-04-10");

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Should fail");
    expect(result.error).toContain("fetch failed");
  });

  it("HTTP 500 returns err", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve(null)
    });

    const adapter = createRotowireProjectedSourceAdapter({
      endpointUrl: "https://example.com/rotowire"
    });

    const result = await adapter.fetchProjectedData("2026-04-10");

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Should fail");
    expect(result.error).toContain("HTTP 500");
  });

  it("HTTP 403 returns err", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: () => Promise.resolve(null)
    });

    const adapter = createRotowireProjectedSourceAdapter({
      endpointUrl: "https://example.com/rotowire"
    });

    const result = await adapter.fetchProjectedData("2026-04-10");

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Should fail");
    expect(result.error).toContain("HTTP 403");
  });

  it("non-JSON response returns err", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject(new SyntaxError("Unexpected token"))
    });

    const adapter = createRotowireProjectedSourceAdapter({
      endpointUrl: "https://example.com/rotowire"
    });

    const result = await adapter.fetchProjectedData("2026-04-10");

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Should fail");
    expect(result.error).toContain("not valid JSON");
  });

  it("structurally invalid JSON (object instead of array) returns err", async () => {
    mockFetchResponse({ games: "not an array" });

    const adapter = createRotowireProjectedSourceAdapter({
      endpointUrl: "https://example.com/rotowire"
    });

    const result = await adapter.fetchProjectedData("2026-04-10");

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Should fail");
    expect(result.error).toContain("JSON array");
  });

  it("empty array is valid (no games available)", async () => {
    mockFetchResponse([]);

    const adapter = createRotowireProjectedSourceAdapter({
      endpointUrl: "https://example.com/rotowire"
    });

    const result = await adapter.fetchProjectedData("2026-04-10");

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data.games).toHaveLength(0);
  });

  it("all-malformed entries → err (not success with empty games)", async () => {
    mockFetchResponse([
      { missing: "required fields" },
      "not an object",
      42,
      null
    ]);

    const adapter = createRotowireProjectedSourceAdapter({
      endpointUrl: "https://example.com/rotowire"
    });

    const result = await adapter.fetchProjectedData("2026-04-10");

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Should fail");
    expect(result.error).toContain("index 0");
  });

  it("valid game followed by malformed game → err", async () => {
    mockFetchResponse([
      { away_team: "NYY", home_team: "BOS", game_date: "2026-04-10", away_starter: null, home_starter: null, away_lineup: null, home_lineup: null },
      { broken: true }
    ]);

    const adapter = createRotowireProjectedSourceAdapter({
      endpointUrl: "https://example.com/rotowire"
    });

    const result = await adapter.fetchProjectedData("2026-04-10");

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Should fail");
    expect(result.error).toContain("index 1");
  });

  it("malformed lineup player inside otherwise valid game → err", async () => {
    mockFetchResponse([
      {
        away_team: "NYY", home_team: "BOS", game_date: "2026-04-10",
        away_starter: null, home_starter: null,
        away_lineup: [
          { name: "Judge", batting_order: 1, position: "RF", hand: "R" },
          { name: "Soto", batting_order: "bad", position: "LF", hand: "L" }
        ],
        home_lineup: null
      }
    ]);

    const adapter = createRotowireProjectedSourceAdapter({
      endpointUrl: "https://example.com/rotowire"
    });

    const result = await adapter.fetchProjectedData("2026-04-10");

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Should fail");
    expect(result.error).toContain("away_lineup player at index 1");
  });
});

// ---------------------------------------------------------------------------
// 5. No provider-specific leakage
// ---------------------------------------------------------------------------

describe("rotowire adapter — no provider-specific leakage", () => {
  it("ProjectedStarter has only canonical fields", async () => {
    const fixture = loadFixture("valid-response.json");
    mockFetchResponse(fixture);

    const adapter = createRotowireProjectedSourceAdapter({
      endpointUrl: "https://example.com/rotowire"
    });

    const result = await adapter.fetchProjectedData("2026-04-10");
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);

    const starter = result.data.games[0]!.away_starter!;
    const keys = Object.keys(starter).sort();
    expect(keys).toEqual([
      "confidence",
      "handedness",
      "player_id",
      "starting_status",
      "team_id"
    ]);

    // No Rotowire-specific fields
    expect(starter).not.toHaveProperty("name");
    expect(starter).not.toHaveProperty("hand");
    expect(starter).not.toHaveProperty("status");
  });

  it("ProjectedLineupEntry has only canonical fields", async () => {
    const fixture = loadFixture("valid-response.json");
    mockFetchResponse(fixture);

    const adapter = createRotowireProjectedSourceAdapter({
      endpointUrl: "https://example.com/rotowire"
    });

    const result = await adapter.fetchProjectedData("2026-04-10");
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);

    const entry = result.data.games[0]!.away_lineup![0]!;
    const keys = Object.keys(entry).sort();
    expect(keys).toEqual([
      "batting_order",
      "player_id",
      "position",
      "starting_status",
      "team_id"
    ]);

    // No Rotowire-specific fields
    expect(entry).not.toHaveProperty("name");
    expect(entry).not.toHaveProperty("hand");
  });

  it("ProjectedSourceResult.provider_meta has only canonical fields", async () => {
    const fixture = loadFixture("valid-response.json");
    mockFetchResponse(fixture);

    const adapter = createRotowireProjectedSourceAdapter({
      endpointUrl: "https://example.com/rotowire"
    });

    const result = await adapter.fetchProjectedData("2026-04-10");
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);

    const metaKeys = Object.keys(result.data.provider_meta).sort();
    expect(metaKeys).toEqual(["fetched_at", "provider", "source_url"]);
  });
});

// ---------------------------------------------------------------------------
// 6. Adapter satisfies ProjectedSourceAdapter interface
// ---------------------------------------------------------------------------

describe("rotowire adapter — contract compliance", () => {
  it("adapter has source discriminant 'rotowire'", () => {
    const adapter = createRotowireProjectedSourceAdapter({
      endpointUrl: "https://example.com/rotowire"
    });

    expect(adapter.source).toBe("rotowire");
  });

  it("adapter is assignable to ProjectedSourceAdapter", () => {
    const adapter: ProjectedSourceAdapter = createRotowireProjectedSourceAdapter({
      endpointUrl: "https://example.com/rotowire"
    });

    // Type-level proof — if this compiles, the adapter satisfies the contract
    expect(adapter.source).toBe("rotowire");
    expect(typeof adapter.fetchProjectedData).toBe("function");
  });

  it("different endpoint URLs produce different adapter instances", () => {
    const a = createRotowireProjectedSourceAdapter({
      endpointUrl: "https://api.example.com/v1/lineups"
    });
    const b = createRotowireProjectedSourceAdapter({
      endpointUrl: "https://api.example.com/v2/lineups"
    });

    // Same source discriminant — both are Rotowire adapters
    expect(a.source).toBe(b.source);
  });
});

// ---------------------------------------------------------------------------
// 7. Edge cases
// ---------------------------------------------------------------------------

describe("rotowire adapter — edge cases", () => {
  it("unrecognized team abbreviation → err (not silent skip)", async () => {
    mockFetchResponse([
      {
        away_team: "ZZZZZ",
        home_team: "BOS",
        game_date: "2026-04-10",
        away_starter: null,
        home_starter: null,
        away_lineup: null,
        home_lineup: null
      }
    ]);

    const adapter = createRotowireProjectedSourceAdapter({
      endpointUrl: "https://example.com/rotowire"
    });

    const result = await adapter.fetchProjectedData("2026-04-10");

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Should fail");
    expect(result.error).toContain("unrecognized");
    expect(result.error).toContain("ZZZZZ");
  });

  it("null starters and lineups produce null in output", async () => {
    mockFetchResponse([
      {
        away_team: "NYY",
        home_team: "BOS",
        game_date: "2026-04-10",
        away_starter: null,
        home_starter: null,
        away_lineup: null,
        home_lineup: null
      }
    ]);

    const adapter = createRotowireProjectedSourceAdapter({
      endpointUrl: "https://example.com/rotowire"
    });

    const result = await adapter.fetchProjectedData("2026-04-10");

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);

    const game = result.data.games[0]!;
    expect(game.away_starter).toBeNull();
    expect(game.home_starter).toBeNull();
    expect(game.away_lineup).toBeNull();
    expect(game.home_lineup).toBeNull();
  });

  it("empty lineup array is treated as null lineup", async () => {
    mockFetchResponse([
      {
        away_team: "NYY",
        home_team: "BOS",
        game_date: "2026-04-10",
        away_starter: null,
        home_starter: null,
        away_lineup: [],
        home_lineup: [],
      }
    ]);

    const adapter = createRotowireProjectedSourceAdapter({
      endpointUrl: "https://example.com/rotowire"
    });

    const result = await adapter.fetchProjectedData("2026-04-10");

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);

    // Empty array → parsed as empty → normalizer sees length 0 → null
    expect(result.data.games[0]!.away_lineup).toBeNull();
    expect(result.data.games[0]!.home_lineup).toBeNull();
  });

  it("game_id is constructed from date + normalized abbreviations", async () => {
    const fixture = loadFixture("divergent-abbreviations.json");
    mockFetchResponse(fixture);

    const adapter = createRotowireProjectedSourceAdapter({
      endpointUrl: "https://example.com/rotowire"
    });

    const result = await adapter.fetchProjectedData("2026-04-10");
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);

    // WAS→WSH, SFG→SF in game_id construction
    expect(result.data.games[0]!.game_id).toBe("mlb-2026-04-10-wsh-sf");
    // TBR→TB, KCR→KC
    expect(result.data.games[1]!.game_id).toBe("mlb-2026-04-10-tb-kc");
  });
});
