import { describe, expect, it, vi } from "vitest";
import type { ProjectedGameData, ProjectedSourceResult, ProjectedStarter } from "../../lib/contracts/projected-source";
import { asGameId, asISOTimestamp, asPlayerId, asTeamId } from "../../lib/contracts/types";
import {
  normalizeProjectedStarter,
  parseTeamsFromGameId
} from "../../lib/starters/normalize";
import { ingestRotowireProjectedStarters } from "../../lib/starters/ingestRotowireProjectedStarters";
import type { StarterIntelligenceRepository, UpsertGameStarterIntelligencePayload } from "../../lib/starters/repository";
import type { RawGameStarterIntelligenceRow } from "../../lib/starters/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXED_OBSERVED_AT = "2026-04-13T12:00:00.000Z";
const FIXED_FETCHED_AT = asISOTimestamp("2026-04-13T11:45:00.000Z");

const makeStarter = (
  playerId: string,
  teamId: string,
  confidence: "high" | "medium" | "low"
): ProjectedStarter => ({
  player_id: asPlayerId(playerId),
  full_name: playerId.replace(/-/g, " "),
  team_id: asTeamId(teamId),
  handedness: "R",
  starting_status: "expected",
  confidence
});

const makeGame = (
  gameId: string,
  awayStarter: ProjectedStarter | null = null,
  homeStarter: ProjectedStarter | null = null
): ProjectedGameData => ({
  game_id: asGameId(gameId),
  away_starter: awayStarter,
  home_starter: homeStarter,
  away_lineup: null,
  home_lineup: null
});

const makeResult = (games: readonly ProjectedGameData[]): ProjectedSourceResult => ({
  provider_meta: {
    provider: "rotowire",
    fetched_at: FIXED_FETCHED_AT,
    source_url: null
  },
  date: "2026-04-13",
  generated_at: asISOTimestamp("2026-04-13T11:45:00.000Z"),
  games
});

const makeStubRow = (gameId: string): RawGameStarterIntelligenceRow => ({
  id: "stub-id",
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
  upsertImpl: (payload: UpsertGameStarterIntelligencePayload) => Promise<RawGameStarterIntelligenceRow> = async (p) => makeStubRow(p.game_id)
): StarterIntelligenceRepository => ({
  readStarterSources: vi.fn(),
  readGameStarterIntelligence: vi.fn(),
  readGameStarterIntelligenceByDate: vi.fn(),
  upsertGameStarterIntelligence: vi.fn(upsertImpl)
});

// ---------------------------------------------------------------------------
// parseTeamsFromGameId
// ---------------------------------------------------------------------------

describe("parseTeamsFromGameId", () => {
  it("extracts away and home teams from a standard game_id", () => {
    const result = parseTeamsFromGameId("mlb-2026-04-13-nyy-bos");
    expect(result).toEqual({ away: "NYY", home: "BOS", date: "2026-04-13" });
  });

  it("uppercases both team abbreviations", () => {
    const result = parseTeamsFromGameId("mlb-2026-04-13-stl-chc");
    expect(result?.away).toBe("STL");
    expect(result?.home).toBe("CHC");
  });

  it("includes the game date in the returned object", () => {
    const result = parseTeamsFromGameId("mlb-2026-05-01-lad-sf");
    expect(result?.date).toBe("2026-05-01");
  });

  it("returns null when fewer than 6 dash-separated parts", () => {
    expect(parseTeamsFromGameId("mlb-2026-04-13-nyy")).toBeNull();
    expect(parseTeamsFromGameId("mlb-2026-04")).toBeNull();
    expect(parseTeamsFromGameId("")).toBeNull();
  });

  it("returns null when prefix is not mlb", () => {
    expect(parseTeamsFromGameId("nba-2026-04-13-nyy-bos")).toBeNull();
    expect(parseTeamsFromGameId("2026-04-13-nyy-bos-extra")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// normalizeProjectedStarter
// ---------------------------------------------------------------------------

describe("normalizeProjectedStarter", () => {
  const providerMeta = {
    provider: "rotowire",
    fetched_at: FIXED_FETCHED_AT,
    source_url: null
  } as const;

  it("returns null when starter is null (absent side is never fabricated)", () => {
    expect(normalizeProjectedStarter(null, providerMeta, FIXED_OBSERVED_AT)).toBeNull();
  });

  it("maps high confidence to 0.9", () => {
    const s = normalizeProjectedStarter(makeStarter("gerrit-cole", "nyy", "high"), providerMeta, FIXED_OBSERVED_AT);
    expect(s?.confidence).toBe(0.9);
  });

  it("maps medium confidence to 0.6", () => {
    const s = normalizeProjectedStarter(makeStarter("chris-sale", "bos", "medium"), providerMeta, FIXED_OBSERVED_AT);
    expect(s?.confidence).toBe(0.6);
  });

  it("maps low confidence to 0.3", () => {
    const s = normalizeProjectedStarter(makeStarter("unknown-arm", "stl", "low"), providerMeta, FIXED_OBSERVED_AT);
    expect(s?.confidence).toBe(0.3);
  });

  it("sets source_key to rotowire", () => {
    const s = normalizeProjectedStarter(makeStarter("gerrit-cole", "nyy", "high"), providerMeta, FIXED_OBSERVED_AT);
    expect(s?.source_key).toBe("rotowire");
  });

  it("sets source_tier to projected", () => {
    const s = normalizeProjectedStarter(makeStarter("gerrit-cole", "nyy", "high"), providerMeta, FIXED_OBSERVED_AT);
    expect(s?.source_tier).toBe("projected");
  });

  it("sets status to projected", () => {
    const s = normalizeProjectedStarter(makeStarter("gerrit-cole", "nyy", "high"), providerMeta, FIXED_OBSERVED_AT);
    expect(s?.status).toBe("projected");
  });

  it("sets freshness_status to fresh", () => {
    const s = normalizeProjectedStarter(makeStarter("gerrit-cole", "nyy", "high"), providerMeta, FIXED_OBSERVED_AT);
    expect(s?.freshness_status).toBe("fresh");
  });

  it("sets source_updated_at from provider_meta.fetched_at", () => {
    const s = normalizeProjectedStarter(makeStarter("gerrit-cole", "nyy", "high"), providerMeta, FIXED_OBSERVED_AT);
    expect(s?.source_updated_at).toBe(FIXED_FETCHED_AT);
  });

  it("sets observed_at from the provided observedAt string", () => {
    const s = normalizeProjectedStarter(makeStarter("gerrit-cole", "nyy", "high"), providerMeta, FIXED_OBSERVED_AT);
    expect(s?.observed_at).toBe(FIXED_OBSERVED_AT);
  });

  it("sets mlb_stats_api_id to null (not available at adapter boundary)", () => {
    const s = normalizeProjectedStarter(makeStarter("gerrit-cole", "nyy", "high"), providerMeta, FIXED_OBSERVED_AT);
    expect(s?.mlb_stats_api_id).toBeNull();
  });

  it("sets raw_ref to null (provider fields do not cross adapter boundary)", () => {
    const s = normalizeProjectedStarter(makeStarter("gerrit-cole", "nyy", "high"), providerMeta, FIXED_OBSERVED_AT);
    expect(s?.raw_ref).toBeNull();
  });

  it("preserves player_id from the projected starter", () => {
    const starter = makeStarter("gerrit-cole", "nyy", "high");
    const s = normalizeProjectedStarter(starter, providerMeta, FIXED_OBSERVED_AT);
    expect(s?.player_id).toBe(starter.player_id);
  });

  it("preserves full_name from the projected starter", () => {
    const starter = makeStarter("gerrit-cole", "nyy", "high");
    const s = normalizeProjectedStarter(starter, providerMeta, FIXED_OBSERVED_AT);
    expect(s?.full_name).toBe("gerrit cole");
  });
});

// ---------------------------------------------------------------------------
// ingestRotowireProjectedStarters
// ---------------------------------------------------------------------------

describe("ingestRotowireProjectedStarters", () => {
  const awayStarter = makeStarter("gerrit-cole", "nyy", "high");
  const homeStarter = makeStarter("chris-sale", "bos", "medium");

  it("returns zero ingested count for empty game list", async () => {
    const repo = makeRepository();
    const result = await ingestRotowireProjectedStarters(makeResult([]), repo, { observedAt: FIXED_OBSERVED_AT });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data.ingested).toBe(0);
    expect(result.data.errors).toHaveLength(0);
  });

  it("upserts once per game", async () => {
    const repo = makeRepository();
    const games = [
      makeGame("mlb-2026-04-13-nyy-bos", awayStarter, homeStarter),
      makeGame("mlb-2026-04-13-stl-chc", awayStarter, homeStarter)
    ];
    await ingestRotowireProjectedStarters(makeResult(games), repo, { observedAt: FIXED_OBSERVED_AT });
    expect(repo.upsertGameStarterIntelligence).toHaveBeenCalledTimes(2);
  });

  it("returns ingested count matching the game count", async () => {
    const repo = makeRepository();
    const games = [
      makeGame("mlb-2026-04-13-nyy-bos", awayStarter, homeStarter),
      makeGame("mlb-2026-04-13-stl-chc", awayStarter, homeStarter)
    ];
    const result = await ingestRotowireProjectedStarters(makeResult(games), repo, { observedAt: FIXED_OBSERVED_AT });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data.ingested).toBe(2);
    expect(result.data.errors).toHaveLength(0);
  });

  it("passes correct game_id and team abbreviations in the upsert payload", async () => {
    const upsertSpy = vi.fn(async (p: UpsertGameStarterIntelligencePayload) => makeStubRow(p.game_id));
    const repo = makeRepository(upsertSpy);
    await ingestRotowireProjectedStarters(
      makeResult([makeGame("mlb-2026-04-13-nyy-bos", awayStarter, homeStarter)]),
      repo,
      { observedAt: FIXED_OBSERVED_AT }
    );
    const call = upsertSpy.mock.calls[0]?.[0];
    expect(call?.game_id).toBe("mlb-2026-04-13-nyy-bos");
    expect(call?.game_date).toBe("2026-04-13");
    expect(call?.away_team_abbreviation).toBe("NYY");
    expect(call?.home_team_abbreviation).toBe("BOS");
  });

  it("writes source_key rotowire and source_tier projected on both sides", async () => {
    const upsertSpy = vi.fn(async (p: UpsertGameStarterIntelligencePayload) => makeStubRow(p.game_id));
    const repo = makeRepository(upsertSpy);
    await ingestRotowireProjectedStarters(
      makeResult([makeGame("mlb-2026-04-13-nyy-bos", awayStarter, homeStarter)]),
      repo,
      { observedAt: FIXED_OBSERVED_AT }
    );
    const call = upsertSpy.mock.calls[0]?.[0];
    expect(call?.away_starter_source_key).toBe("rotowire");
    expect(call?.away_starter_source_tier).toBe("projected");
    expect(call?.home_starter_source_key).toBe("rotowire");
    expect(call?.home_starter_source_tier).toBe("projected");
  });

  it("writes null side fields when a starter is absent on that side", async () => {
    const upsertSpy = vi.fn(async (p: UpsertGameStarterIntelligencePayload) => makeStubRow(p.game_id));
    const repo = makeRepository(upsertSpy);
    // away starter known, home starter absent
    await ingestRotowireProjectedStarters(
      makeResult([makeGame("mlb-2026-04-13-nyy-bos", awayStarter, null)]),
      repo,
      { observedAt: FIXED_OBSERVED_AT }
    );
    const call = upsertSpy.mock.calls[0]?.[0];
    expect(call?.away_starter_source_key).toBe("rotowire");
    expect(call?.home_starter_source_key).toBeNull();
    expect(call?.home_starter_confidence).toBeNull();
    expect(call?.home_starter_player_id).toBeNull();
  });

  it("writes null for both sides when both starters are absent", async () => {
    const upsertSpy = vi.fn(async (p: UpsertGameStarterIntelligencePayload) => makeStubRow(p.game_id));
    const repo = makeRepository(upsertSpy);
    await ingestRotowireProjectedStarters(
      makeResult([makeGame("mlb-2026-04-13-nyy-bos", null, null)]),
      repo,
      { observedAt: FIXED_OBSERVED_AT }
    );
    expect(upsertSpy).toHaveBeenCalledTimes(1);
    const call = upsertSpy.mock.calls[0]?.[0];
    expect(call?.away_starter_source_key).toBeNull();
    expect(call?.home_starter_source_key).toBeNull();
  });

  it("collects a DB write error and continues ingesting remaining games", async () => {
    let callCount = 0;
    const upsertImpl = async (p: UpsertGameStarterIntelligencePayload): Promise<RawGameStarterIntelligenceRow> => {
      callCount++;
      if (callCount === 1) throw new Error("Supabase timeout");
      return makeStubRow(p.game_id);
    };
    const repo = makeRepository(upsertImpl);
    const games = [
      makeGame("mlb-2026-04-13-nyy-bos", awayStarter, homeStarter),
      makeGame("mlb-2026-04-13-stl-chc", awayStarter, homeStarter)
    ];
    const result = await ingestRotowireProjectedStarters(makeResult(games), repo, { observedAt: FIXED_OBSERVED_AT });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data.ingested).toBe(1);
    expect(result.data.errors).toHaveLength(1);
    expect(result.data.errors[0]).toContain("Supabase timeout");
  });

  it("skips a game with an unparseable game_id and records the error", async () => {
    const upsertSpy = vi.fn(async (p: UpsertGameStarterIntelligencePayload) => makeStubRow(p.game_id));
    const repo = makeRepository(upsertSpy);
    const games = [
      { ...makeGame("bad-id"), game_id: asGameId("bad-id") },
      makeGame("mlb-2026-04-13-stl-chc", awayStarter, homeStarter)
    ];
    const result = await ingestRotowireProjectedStarters(makeResult(games), repo, { observedAt: FIXED_OBSERVED_AT });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data.ingested).toBe(1);
    expect(result.data.errors).toHaveLength(1);
    expect(result.data.errors[0]).toContain("bad-id");
    expect(upsertSpy).toHaveBeenCalledTimes(1);
  });

  it("repeated ingest of the same game_id calls upsert again (idempotency enforced at DB level)", async () => {
    const upsertSpy = vi.fn(async (p: UpsertGameStarterIntelligencePayload) => makeStubRow(p.game_id));
    const repo = makeRepository(upsertSpy);
    const game = makeGame("mlb-2026-04-13-nyy-bos", awayStarter, homeStarter);
    const resultA = await ingestRotowireProjectedStarters(makeResult([game]), repo, { observedAt: FIXED_OBSERVED_AT });
    const resultB = await ingestRotowireProjectedStarters(makeResult([game]), repo, { observedAt: FIXED_OBSERVED_AT });
    expect(resultA.success).toBe(true);
    expect(resultB.success).toBe(true);
    // Both calls proceed; DB-level unique constraint on game_id handles deduplication
    expect(upsertSpy).toHaveBeenCalledTimes(2);
  });
});
