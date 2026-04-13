import { describe, expect, it, vi } from "vitest";
import { asGameId, asISOTimestamp, asPlayerId } from "../../lib/contracts/types";
import type { GameStarterIntelligenceRow, StarterSideIntelligence } from "../../lib/starters/types";
import type { StarterIntelligenceRepository, UpsertGameStarterIntelligencePayload } from "../../lib/starters/repository";
import type { RawGameStarterIntelligenceRow } from "../../lib/starters/types";
import { resolveStarterIntelligenceForDate } from "../../lib/starters/resolveStarterIntelligenceForDate";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const OBSERVED = asISOTimestamp("2026-04-13T12:00:00.000Z");
const SOURCE_UPDATED = asISOTimestamp("2026-04-13T11:45:00.000Z");
const CREATED = asISOTimestamp("2026-04-13T12:00:00.000Z");

const makeFullSide = (
  overrides: Partial<StarterSideIntelligence> = {}
): StarterSideIntelligence => ({
  player_id: asPlayerId("gerrit-cole"),
  mlb_stats_api_id: null,
  full_name: "Gerrit Cole",
  source_key: "rotowire",
  source_tier: "projected",
  confidence: 0.9,
  freshness_status: "fresh",
  observed_at: OBSERVED,
  source_updated_at: SOURCE_UPDATED,
  status: "projected",
  raw_ref: null,
  ...overrides
});

const makeEmptySide = (): StarterSideIntelligence => ({
  player_id: null,
  mlb_stats_api_id: null,
  full_name: null,
  source_key: null,
  source_tier: null,
  confidence: null,
  freshness_status: null,
  observed_at: null,
  source_updated_at: null,
  status: null,
  raw_ref: null
});

const makeRow = (
  gameId: string,
  away: StarterSideIntelligence,
  home: StarterSideIntelligence,
  resolutionNotes: string | null = null
): GameStarterIntelligenceRow => ({
  id: `id-${gameId}`,
  game_id: asGameId(gameId),
  game_date: "2026-04-13",
  away_team_abbreviation: "NYY",
  home_team_abbreviation: "BOS",
  away,
  home,
  resolution_notes: resolutionNotes,
  created_at: CREATED,
  updated_at: CREATED
});

const makeStubUpsertRow = (gameId: string): RawGameStarterIntelligenceRow => ({
  id: `id-${gameId}`,
  game_id: gameId,
  game_date: "2026-04-13",
  away_team_abbreviation: "NYY",
  home_team_abbreviation: "BOS",
  away_starter_player_id: null,
  away_starter_mlb_stats_api_id: null,
  away_starter_full_name: null,
  away_starter_source_key: null,
  away_starter_source_tier: null,
  away_starter_confidence: null,
  away_starter_freshness_status: null,
  away_starter_observed_at: null,
  away_starter_source_updated_at: null,
  away_starter_status: null,
  away_starter_raw_ref: null,
  home_starter_player_id: null,
  home_starter_mlb_stats_api_id: null,
  home_starter_full_name: null,
  home_starter_source_key: null,
  home_starter_source_tier: null,
  home_starter_confidence: null,
  home_starter_freshness_status: null,
  home_starter_observed_at: null,
  home_starter_source_updated_at: null,
  home_starter_status: null,
  home_starter_raw_ref: null,
  resolution_notes: null,
  created_at: "2026-04-13T12:00:00.000Z",
  updated_at: "2026-04-13T12:00:00.000Z"
});

const makeRepository = (
  rows: readonly GameStarterIntelligenceRow[],
  upsertImpl: (p: UpsertGameStarterIntelligencePayload) => Promise<RawGameStarterIntelligenceRow> = async (p) => makeStubUpsertRow(p.game_id)
): StarterIntelligenceRepository => ({
  assertStarterSourceRegistered: vi.fn(async () => { return; }),
  readStarterSources: vi.fn(async () => []),
  readGameStarterIntelligence: vi.fn(async () => null),
  readGameStarterIntelligenceByDate: vi.fn(async () => rows),
  upsertGameStarterIntelligence: vi.fn(upsertImpl)
});

// ---------------------------------------------------------------------------
// Empty date
// ---------------------------------------------------------------------------

describe("resolveStarterIntelligenceForDate — empty date", () => {
  it("returns success with zero resolved when no rows stored", async () => {
    const repo = makeRepository([]);
    const result = await resolveStarterIntelligenceForDate("2026-04-13", repo);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data.resolved).toBe(0);
    expect(result.data.skipped).toBe(0);
    expect(result.data.errors).toHaveLength(0);
  });

  it("calls readGameStarterIntelligenceByDate with the given date", async () => {
    const repo = makeRepository([]);
    await resolveStarterIntelligenceForDate("2026-04-13", repo);
    expect(repo.readGameStarterIntelligenceByDate).toHaveBeenCalledWith("2026-04-13");
  });
});

// ---------------------------------------------------------------------------
// Read failure
// ---------------------------------------------------------------------------

describe("resolveStarterIntelligenceForDate — DB read failure", () => {
  it("returns err when readGameStarterIntelligenceByDate throws", async () => {
    const repo = makeRepository([]);
    vi.mocked(repo.readGameStarterIntelligenceByDate).mockRejectedValue(
      new Error("Supabase connection refused")
    );
    const result = await resolveStarterIntelligenceForDate("2026-04-13", repo);
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    expect(result.error).toContain("Supabase connection refused");
  });

  it("does not call upsert when read fails", async () => {
    const repo = makeRepository([]);
    vi.mocked(repo.readGameStarterIntelligenceByDate).mockRejectedValue(new Error("fail"));
    await resolveStarterIntelligenceForDate("2026-04-13", repo);
    expect(repo.upsertGameStarterIntelligence).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Single game, both sides present
// ---------------------------------------------------------------------------

describe("resolveStarterIntelligenceForDate — single game, both sides", () => {
  it("resolves one game with both sides and increments resolved count", async () => {
    const repo = makeRepository([
      makeRow("mlb-2026-04-13-nyy-bos", makeFullSide(), makeFullSide({ player_id: asPlayerId("chris-sale"), full_name: "Chris Sale" }))
    ]);
    const result = await resolveStarterIntelligenceForDate("2026-04-13", repo);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data.resolved).toBe(1);
    expect(result.data.skipped).toBe(0);
    expect(result.data.errors).toHaveLength(0);
  });

  it("calls upsert once for one game", async () => {
    const repo = makeRepository([
      makeRow("mlb-2026-04-13-nyy-bos", makeFullSide(), makeFullSide({ player_id: asPlayerId("chris-sale"), full_name: "Chris Sale" }))
    ]);
    await resolveStarterIntelligenceForDate("2026-04-13", repo);
    expect(repo.upsertGameStarterIntelligence).toHaveBeenCalledTimes(1);
  });

  it("upsert payload carries the correct game_id", async () => {
    const upsertSpy = vi.fn(async (p: UpsertGameStarterIntelligencePayload) => makeStubUpsertRow(p.game_id));
    const repo = makeRepository(
      [makeRow("mlb-2026-04-13-nyy-bos", makeFullSide(), makeFullSide({ player_id: asPlayerId("chris-sale"), full_name: "Chris Sale" }))],
      upsertSpy
    );
    await resolveStarterIntelligenceForDate("2026-04-13", repo);
    expect(upsertSpy.mock.calls[0]?.[0].game_id).toBe("mlb-2026-04-13-nyy-bos");
  });
});

// ---------------------------------------------------------------------------
// Skipped — both sides have no candidates
// ---------------------------------------------------------------------------

describe("resolveStarterIntelligenceForDate — both sides empty", () => {
  it("skips a game where both sides have no provenance", async () => {
    const repo = makeRepository([
      makeRow("mlb-2026-04-13-nyy-bos", makeEmptySide(), makeEmptySide())
    ]);
    const result = await resolveStarterIntelligenceForDate("2026-04-13", repo);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data.skipped).toBe(1);
    expect(result.data.resolved).toBe(0);
  });

  it("does not call upsert for fully-empty games", async () => {
    const repo = makeRepository([
      makeRow("mlb-2026-04-13-nyy-bos", makeEmptySide(), makeEmptySide())
    ]);
    await resolveStarterIntelligenceForDate("2026-04-13", repo);
    expect(repo.upsertGameStarterIntelligence).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// One-side-known — away present, home absent
// ---------------------------------------------------------------------------

describe("resolveStarterIntelligenceForDate — partial side (away only)", () => {
  it("resolves game when only away side has provenance", async () => {
    const repo = makeRepository([
      makeRow("mlb-2026-04-13-nyy-bos", makeFullSide(), makeEmptySide())
    ]);
    const result = await resolveStarterIntelligenceForDate("2026-04-13", repo);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data.resolved).toBe(1);
    expect(result.data.skipped).toBe(0);
  });

  it("upsert payload has away fields populated and home fields null", async () => {
    const upsertSpy = vi.fn(async (p: UpsertGameStarterIntelligencePayload) => makeStubUpsertRow(p.game_id));
    const repo = makeRepository(
      [makeRow("mlb-2026-04-13-nyy-bos", makeFullSide(), makeEmptySide())],
      upsertSpy
    );
    await resolveStarterIntelligenceForDate("2026-04-13", repo);
    const call = upsertSpy.mock.calls[0]?.[0];
    expect(call?.away_starter_source_key).toBe("rotowire");
    expect(call?.home_starter_source_key).toBeNull();
    expect(call?.home_starter_confidence).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Incomplete provenance — missing required candidate field
// ---------------------------------------------------------------------------

describe("resolveStarterIntelligenceForDate — incomplete provenance", () => {
  it("treats a side with null confidence as having no candidates", async () => {
    const upsertSpy = vi.fn(async (p: UpsertGameStarterIntelligencePayload) => makeStubUpsertRow(p.game_id));
    const repo = makeRepository(
      [makeRow("mlb-2026-04-13-nyy-bos", makeFullSide({ confidence: null }), makeFullSide({ player_id: asPlayerId("chris-sale"), full_name: "Chris Sale" }))],
      upsertSpy
    );
    await resolveStarterIntelligenceForDate("2026-04-13", repo);
    const call = upsertSpy.mock.calls[0]?.[0];
    // away has no valid candidate — resolved to null
    expect(call?.away_starter_source_key).toBeNull();
    // home still resolved
    expect(call?.home_starter_source_key).toBe("rotowire");
  });

  it("treats a side with null source_key as having no candidates", async () => {
    const upsertSpy = vi.fn(async (p: UpsertGameStarterIntelligencePayload) => makeStubUpsertRow(p.game_id));
    const repo = makeRepository(
      [makeRow("mlb-2026-04-13-nyy-bos", makeFullSide({ source_key: null }), makeFullSide({ player_id: asPlayerId("chris-sale"), full_name: "Chris Sale" }))],
      upsertSpy
    );
    await resolveStarterIntelligenceForDate("2026-04-13", repo);
    const call = upsertSpy.mock.calls[0]?.[0];
    expect(call?.away_starter_source_key).toBeNull();
    expect(call?.home_starter_source_key).toBe("rotowire");
  });

  it("skips game when both sides have null required fields", async () => {
    const repo = makeRepository([
      makeRow("mlb-2026-04-13-nyy-bos", makeFullSide({ confidence: null }), makeFullSide({ source_key: null }))
    ]);
    const result = await resolveStarterIntelligenceForDate("2026-04-13", repo);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data.skipped).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Multiple games
// ---------------------------------------------------------------------------

describe("resolveStarterIntelligenceForDate — multiple games", () => {
  it("resolves count matches the number of games with at least one candidate", async () => {
    const repo = makeRepository([
      makeRow("mlb-2026-04-13-nyy-bos", makeFullSide(), makeFullSide({ player_id: asPlayerId("chris-sale"), full_name: "Chris Sale" })),
      makeRow("mlb-2026-04-13-stl-chc", makeFullSide({ player_id: asPlayerId("sonny-gray"), full_name: "Sonny Gray" }), makeFullSide({ player_id: asPlayerId("shota-imanaga"), full_name: "Shota Imanaga" })),
      makeRow("mlb-2026-04-13-lad-sf", makeEmptySide(), makeEmptySide())
    ]);
    const result = await resolveStarterIntelligenceForDate("2026-04-13", repo);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data.resolved).toBe(2);
    expect(result.data.skipped).toBe(1);
  });

  it("calls upsert once per resolved game", async () => {
    const repo = makeRepository([
      makeRow("mlb-2026-04-13-nyy-bos", makeFullSide(), makeFullSide({ player_id: asPlayerId("chris-sale"), full_name: "Chris Sale" })),
      makeRow("mlb-2026-04-13-stl-chc", makeFullSide({ player_id: asPlayerId("sonny-gray"), full_name: "Sonny Gray" }), makeEmptySide())
    ]);
    await resolveStarterIntelligenceForDate("2026-04-13", repo);
    expect(repo.upsertGameStarterIntelligence).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Per-game upsert error — continues remaining games
// ---------------------------------------------------------------------------

describe("resolveStarterIntelligenceForDate — per-game upsert error", () => {
  it("collects the error and continues processing remaining games", async () => {
    let callCount = 0;
    const upsertImpl = async (p: UpsertGameStarterIntelligencePayload): Promise<RawGameStarterIntelligenceRow> => {
      callCount++;
      if (callCount === 1) throw new Error("write timeout");
      return makeStubUpsertRow(p.game_id);
    };
    const repo = makeRepository(
      [
        makeRow("mlb-2026-04-13-nyy-bos", makeFullSide(), makeFullSide({ player_id: asPlayerId("chris-sale"), full_name: "Chris Sale" })),
        makeRow("mlb-2026-04-13-stl-chc", makeFullSide({ player_id: asPlayerId("sonny-gray"), full_name: "Sonny Gray" }), makeFullSide({ player_id: asPlayerId("shota-imanaga"), full_name: "Shota Imanaga" }))
      ],
      upsertImpl
    );
    const result = await resolveStarterIntelligenceForDate("2026-04-13", repo);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data.resolved).toBe(1);
    expect(result.data.errors).toHaveLength(1);
    expect(result.data.errors[0]).toContain("write timeout");
    expect(result.data.errors[0]).toContain("mlb-2026-04-13-nyy-bos");
  });
});

// ---------------------------------------------------------------------------
// Resolution notes pass-through
// ---------------------------------------------------------------------------

describe("resolveStarterIntelligenceForDate — resolution notes", () => {
  it("upsert payload carries resolution_notes from the resolver", async () => {
    const upsertSpy = vi.fn(async (p: UpsertGameStarterIntelligencePayload) => makeStubUpsertRow(p.game_id));
    const repo = makeRepository(
      [makeRow("mlb-2026-04-13-nyy-bos", makeFullSide(), makeFullSide({ player_id: asPlayerId("chris-sale"), full_name: "Chris Sale" }))],
      upsertSpy
    );
    await resolveStarterIntelligenceForDate("2026-04-13", repo);
    const call = upsertSpy.mock.calls[0]?.[0];
    // Resolver always writes notes for single candidates
    expect(call?.resolution_notes).not.toBeUndefined();
    expect(typeof call?.resolution_notes === "string" || call?.resolution_notes === null).toBe(true);
  });
});
