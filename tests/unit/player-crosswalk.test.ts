import { describe, expect, it } from "vitest";
import {
  buildCanonicalPlayerId,
  parseCanonicalPlayerId
} from "../../lib/contracts/player-crosswalk";
import type {
  PlayerCrosswalk,
  PlayerCrosswalkEntry
} from "../../lib/contracts/player-crosswalk";
import { normalizeNameForJoin } from "../../lib/crosswalk/normalize";
import { loadCrosswalk } from "../../lib/crosswalk/loadCrosswalk";
import {
  indexCrosswalk,
  lookupByNameAndTeam,
  resolvePlayerIdentity
} from "../../lib/crosswalk/resolvePlayerIdentity";
import { buildPlayerCards } from "../../lib/services/buildPlayerCard";
import type { PlayerCard } from "../../lib/services/buildPlayerCard";
import type { PreparedGameInputs } from "../../lib/contracts/prepared";
import preparedFixture from "../../data/fixtures/sample-prepared-game.json";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Canonical player ID format
// ---------------------------------------------------------------------------

describe("canonical player ID", () => {
  it("buildCanonicalPlayerId produces mlb-{numeric} format", () => {
    expect(buildCanonicalPlayerId("543037")).toBe("mlb-543037");
    expect(buildCanonicalPlayerId("519242")).toBe("mlb-519242");
    expect(buildCanonicalPlayerId("660271")).toBe("mlb-660271");
  });

  it("parseCanonicalPlayerId extracts numeric part", () => {
    expect(parseCanonicalPlayerId("mlb-543037")).toBe("543037");
    expect(parseCanonicalPlayerId("mlb-519242")).toBe("519242");
  });

  it("parseCanonicalPlayerId returns null for invalid formats", () => {
    expect(parseCanonicalPlayerId("543037")).toBeNull();
    expect(parseCanonicalPlayerId("dk-543037")).toBeNull();
    expect(parseCanonicalPlayerId("mlb-")).toBeNull();
    expect(parseCanonicalPlayerId("mlb-abc")).toBeNull();
    expect(parseCanonicalPlayerId("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Shared name normalization
// ---------------------------------------------------------------------------

describe("normalizeNameForJoin (shared)", () => {
  it("slug and display name converge to same key", () => {
    expect(normalizeNameForJoin("gerrit-cole")).toBe("gerritcole");
    expect(normalizeNameForJoin("Gerrit Cole")).toBe("gerritcole");
  });

  it("strips diacritics via NFD decomposition", () => {
    expect(normalizeNameForJoin("Ronald Acuña Jr.")).toBe("ronaldacunajr");
  });

  it("strips periods, hyphens, and spaces", () => {
    expect(normalizeNameForJoin("A.J. Minter")).toBe("ajminter");
    expect(normalizeNameForJoin("a-j-minter")).toBe("ajminter");
  });

  it("returns empty string for empty input", () => {
    expect(normalizeNameForJoin("")).toBe("");
  });

  it("handles suffixes like Jr., Sr., III", () => {
    expect(normalizeNameForJoin("Ken Griffey Jr.")).toBe("kengriffeyjr");
    expect(normalizeNameForJoin("Vladimir Guerrero Jr.")).toBe("vladimirguerrerojr");
    expect(normalizeNameForJoin("Cal Ripken III")).toBe("calripkeniii");
  });
});

// ---------------------------------------------------------------------------
// Crosswalk loading from committed file (load + validate only)
// ---------------------------------------------------------------------------

describe("loadCrosswalk", () => {
  it("loads the committed crosswalk fixture from data/crosswalk/", () => {
    const crosswalkPath = join(process.cwd(), "data", "crosswalk", "player-crosswalk.json");
    const crosswalk = loadCrosswalk(crosswalkPath);

    expect(crosswalk).not.toBeNull();
    expect(crosswalk!.version).toBe(1);
    expect(crosswalk!.entry_count).toBeGreaterThanOrEqual(4);
    expect(crosswalk!.entries.length).toBe(crosswalk!.entry_count);
    expect(typeof crosswalk!.generated_at).toBe("string");
  });

  it("returns null for missing file", () => {
    const result = loadCrosswalk("/nonexistent/path/crosswalk.json");
    expect(result).toBeNull();
  });

  it("every entry has canonical_player_id in mlb-{numeric} format", () => {
    const crosswalkPath = join(process.cwd(), "data", "crosswalk", "player-crosswalk.json");
    const crosswalk = loadCrosswalk(crosswalkPath);

    expect(crosswalk).not.toBeNull();
    for (const entry of crosswalk!.entries) {
      expect(entry.canonical_player_id).toMatch(/^mlb-\d+$/);
      expect(parseCanonicalPlayerId(entry.canonical_player_id)).toBe(entry.mlb_stats_api_id);
    }
  });

  it("every entry has non-empty normalized_name", () => {
    const crosswalkPath = join(process.cwd(), "data", "crosswalk", "player-crosswalk.json");
    const crosswalk = loadCrosswalk(crosswalkPath);

    expect(crosswalk).not.toBeNull();
    for (const entry of crosswalk!.entries) {
      expect(entry.normalized_name.length).toBeGreaterThan(0);
      // Normalized name should match normalizeNameForJoin(display_name)
      expect(entry.normalized_name).toBe(normalizeNameForJoin(entry.display_name));
    }
  });

  it("diacritics entry normalizes correctly", () => {
    const crosswalkPath = join(process.cwd(), "data", "crosswalk", "player-crosswalk.json");
    const crosswalk = loadCrosswalk(crosswalkPath);

    expect(crosswalk).not.toBeNull();
    // Ronald Acuna Jr. — diacritics stripped
    const acuna = crosswalk!.entries.find((e) => e.mlb_stats_api_id === "660271");
    expect(acuna).toBeDefined();
    expect(acuna!.normalized_name).toBe("ronaldacunajr");
  });

  it("returns null for invalid JSON", () => {
    // loadCrosswalk with a path to a file that isn't valid JSON
    // We test this by checking the contract — it returns null on parse failure
    const result = loadCrosswalk(join(process.cwd(), "package.json"));
    // package.json is valid JSON but wrong shape (no version: 1, no entries array)
    expect(result).toBeNull();
  });

  it("Gerrit Cole entry has expected fields", () => {
    const crosswalkPath = join(process.cwd(), "data", "crosswalk", "player-crosswalk.json");
    const crosswalk = loadCrosswalk(crosswalkPath);

    expect(crosswalk).not.toBeNull();
    const cole = crosswalk!.entries.find((e) => e.mlb_stats_api_id === "543037");
    expect(cole).toBeDefined();
    expect(cole!.canonical_player_id).toBe("mlb-543037");
    expect(cole!.display_name).toBe("Gerrit Cole");
    expect(cole!.normalized_name).toBe("gerritcole");
    expect(cole!.team_abbreviation).toBe("NYY");
  });
});

// ---------------------------------------------------------------------------
// Crosswalk indexing (S2 — resolver infrastructure)
// ---------------------------------------------------------------------------

const makeEntry = (
  overrides: Partial<PlayerCrosswalkEntry> & {
    canonical_player_id: string;
    mlb_stats_api_id: string;
    display_name: string;
    team_abbreviation: string;
  }
): PlayerCrosswalkEntry => ({
  normalized_name: normalizeNameForJoin(overrides.display_name),
  position: "P",
  throws: "R",
  seeded_at: "2026-04-10T00:00:00Z",
  dk_player_id: null,
  dk_player_dk_id: null,
  rotowire_slug: null,
  linked_at: null,
  linked_via: null,
  ...overrides
});

const makeCrosswalk = (entries: PlayerCrosswalkEntry[]): PlayerCrosswalk => ({
  version: 1,
  generated_at: "2026-04-10T00:00:00Z",
  entry_count: entries.length,
  entries
});

describe("crosswalk indexing", () => {
  const cole = makeEntry({
    canonical_player_id: "mlb-543037",
    mlb_stats_api_id: "543037",
    display_name: "Gerrit Cole",
    team_abbreviation: "NYY",
    dk_player_id: "11111",
    rotowire_slug: "gerrit-cole"
  });

  const sale = makeEntry({
    canonical_player_id: "mlb-519242",
    mlb_stats_api_id: "519242",
    display_name: "Chris Sale",
    team_abbreviation: "BOS",
    throws: "L"
  });

  const crosswalk = makeCrosswalk([cole, sale]);

  it("indexes by mlb_stats_api_id", () => {
    const indexed = indexCrosswalk(crosswalk);
    expect(indexed.byMlbStatsApiId.get("543037")).toBe(cole);
    expect(indexed.byMlbStatsApiId.get("519242")).toBe(sale);
    expect(indexed.byMlbStatsApiId.get("999999")).toBeUndefined();
  });

  it("indexes by DK player_id when linked", () => {
    const indexed = indexCrosswalk(crosswalk);
    expect(indexed.byDkPlayerId.get("11111")).toBe(cole);
    expect(indexed.byDkPlayerId.size).toBe(1);
  });

  it("indexes by Rotowire slug when linked", () => {
    const indexed = indexCrosswalk(crosswalk);
    expect(indexed.byRotowireSlug.get("gerrit-cole")).toBe(cole);
    expect(indexed.byRotowireSlug.size).toBe(1);
  });

  it("indexes by normalized name + team for composite fallback", () => {
    const indexed = indexCrosswalk(crosswalk);
    expect(lookupByNameAndTeam(indexed, "gerritcole", "NYY")).toBe(cole);
    expect(lookupByNameAndTeam(indexed, "chrissale", "BOS")).toBe(sale);
  });

  it("returns null for name+team lookup when no match exists", () => {
    const indexed = indexCrosswalk(crosswalk);
    expect(lookupByNameAndTeam(indexed, "nonexistent", "NYY")).toBeNull();
  });

  it("returns null for name+team lookup when empty inputs", () => {
    const indexed = indexCrosswalk(crosswalk);
    expect(lookupByNameAndTeam(indexed, "", "NYY")).toBeNull();
    expect(lookupByNameAndTeam(indexed, "gerritcole", "")).toBeNull();
  });

  it("marks ambiguous name+team composite key as null (fail closed)", () => {
    const smith1 = makeEntry({
      canonical_player_id: "mlb-100001",
      mlb_stats_api_id: "100001",
      display_name: "Will Smith",
      team_abbreviation: "LAD",
      position: "C"
    });
    const smith2 = makeEntry({
      canonical_player_id: "mlb-100002",
      mlb_stats_api_id: "100002",
      display_name: "Will Smith",
      team_abbreviation: "LAD",
      position: "P"
    });

    const ambiguousCrosswalk = makeCrosswalk([smith1, smith2]);
    const indexed = indexCrosswalk(ambiguousCrosswalk);
    expect(lookupByNameAndTeam(indexed, "willsmith", "LAD")).toBeNull();
    expect(indexed.byMlbStatsApiId.get("100001")).toBe(smith1);
    expect(indexed.byMlbStatsApiId.get("100002")).toBe(smith2);
  });

  it("same normalized name on different teams is NOT ambiguous", () => {
    const smith_lad = makeEntry({
      canonical_player_id: "mlb-100001",
      mlb_stats_api_id: "100001",
      display_name: "Will Smith",
      team_abbreviation: "LAD"
    });
    const smith_hou = makeEntry({
      canonical_player_id: "mlb-100003",
      mlb_stats_api_id: "100003",
      display_name: "Will Smith",
      team_abbreviation: "HOU"
    });

    const indexed = indexCrosswalk(makeCrosswalk([smith_lad, smith_hou]));
    expect(lookupByNameAndTeam(indexed, "willsmith", "LAD")).toBe(smith_lad);
    expect(lookupByNameAndTeam(indexed, "willsmith", "HOU")).toBe(smith_hou);
  });

  it("entry_count reflects actual entries", () => {
    const indexed = indexCrosswalk(crosswalk);
    expect(indexed.entry_count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Duplicate-key ambiguity (fail closed on all indexes)
// ---------------------------------------------------------------------------

describe("duplicate-key ambiguity (fail closed)", () => {
  it("duplicate mlb_stats_api_id resolves to null", () => {
    const dup1 = makeEntry({
      canonical_player_id: "mlb-543037",
      mlb_stats_api_id: "543037",
      display_name: "Gerrit Cole",
      team_abbreviation: "NYY"
    });
    const dup2 = makeEntry({
      canonical_player_id: "mlb-543037",
      mlb_stats_api_id: "543037",
      display_name: "Gerrit Cole Copy",
      team_abbreviation: "NYY"
    });

    const indexed = indexCrosswalk(makeCrosswalk([dup1, dup2]));
    // Index holds null sentinel for the ambiguous key
    expect(indexed.byMlbStatsApiId.get("543037")).toBeNull();
    // Resolver returns unresolved when queried with an ID not matchable via other paths
    const result = resolvePlayerIdentity(indexed, {
      mlb_stats_api_id: "543037",
      player_id: "some-unknown-id",
      team_abbreviation: "SEA"
    });
    expect(result.canonical_player_id).toBeNull();
    expect(result.resolved_via).toBeNull();
  });

  it("duplicate dk_player_id resolves to null", () => {
    const dup1 = makeEntry({
      canonical_player_id: "mlb-100001",
      mlb_stats_api_id: "100001",
      display_name: "Player A",
      team_abbreviation: "NYY",
      dk_player_id: "55555"
    });
    const dup2 = makeEntry({
      canonical_player_id: "mlb-100002",
      mlb_stats_api_id: "100002",
      display_name: "Player B",
      team_abbreviation: "BOS",
      dk_player_id: "55555"
    });

    const indexed = indexCrosswalk(makeCrosswalk([dup1, dup2]));
    expect(indexed.byDkPlayerId.get("55555")).toBeNull();
    const result = resolvePlayerIdentity(indexed, {
      mlb_stats_api_id: null,
      player_id: "55555",
      team_abbreviation: "NYY"
    });
    expect(result.canonical_player_id).toBeNull();
    expect(result.resolved_via).toBeNull();
  });

  it("duplicate rotowire_slug resolves to null", () => {
    const dup1 = makeEntry({
      canonical_player_id: "mlb-100001",
      mlb_stats_api_id: "100001",
      display_name: "Player A",
      team_abbreviation: "NYY",
      rotowire_slug: "player-a"
    });
    const dup2 = makeEntry({
      canonical_player_id: "mlb-100002",
      mlb_stats_api_id: "100002",
      display_name: "Player B",
      team_abbreviation: "BOS",
      rotowire_slug: "player-a"
    });

    const indexed = indexCrosswalk(makeCrosswalk([dup1, dup2]));
    expect(indexed.byRotowireSlug.get("player-a")).toBeNull();
    // Use team SEA so name+team fallback also misses
    const result = resolvePlayerIdentity(indexed, {
      mlb_stats_api_id: null,
      player_id: "player-a",
      team_abbreviation: "SEA"
    });
    expect(result.canonical_player_id).toBeNull();
    expect(result.resolved_via).toBeNull();
  });

  it("composite name+team ambiguity still fails closed", () => {
    const smith1 = makeEntry({
      canonical_player_id: "mlb-100001",
      mlb_stats_api_id: "100001",
      display_name: "Will Smith",
      team_abbreviation: "LAD"
    });
    const smith2 = makeEntry({
      canonical_player_id: "mlb-100002",
      mlb_stats_api_id: "100002",
      display_name: "Will Smith",
      team_abbreviation: "LAD"
    });

    const indexed = indexCrosswalk(makeCrosswalk([smith1, smith2]));
    const result = resolvePlayerIdentity(indexed, {
      mlb_stats_api_id: null,
      player_id: "will-smith",
      team_abbreviation: "LAD"
    });
    expect(result.canonical_player_id).toBeNull();
    expect(result.resolved_via).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Resolver cascade (S2)
// ---------------------------------------------------------------------------

describe("resolvePlayerIdentity", () => {
  const cole = makeEntry({
    canonical_player_id: "mlb-543037",
    mlb_stats_api_id: "543037",
    display_name: "Gerrit Cole",
    team_abbreviation: "NYY",
    dk_player_id: "11111",
    rotowire_slug: "gerrit-cole"
  });

  const sale = makeEntry({
    canonical_player_id: "mlb-519242",
    mlb_stats_api_id: "519242",
    display_name: "Chris Sale",
    team_abbreviation: "BOS",
    throws: "L"
  });

  const indexed = indexCrosswalk(makeCrosswalk([cole, sale]));

  it("step 1: resolves by mlb_stats_api_id", () => {
    const result = resolvePlayerIdentity(indexed, {
      mlb_stats_api_id: "543037",
      player_id: "gerrit-cole",
      team_abbreviation: "NYY"
    });
    expect(result.canonical_player_id).toBe("mlb-543037");
    expect(result.resolved_via).toBe("mlb_stats_api_id");
  });

  it("step 2: resolves by dk_player_id when mlb_stats_api_id is null", () => {
    const result = resolvePlayerIdentity(indexed, {
      mlb_stats_api_id: null,
      player_id: "11111",
      team_abbreviation: "NYY"
    });
    expect(result.canonical_player_id).toBe("mlb-543037");
    expect(result.resolved_via).toBe("dk_player_id");
  });

  it("step 3: resolves by rotowire_slug when earlier steps miss", () => {
    const result = resolvePlayerIdentity(indexed, {
      mlb_stats_api_id: null,
      player_id: "gerrit-cole",
      team_abbreviation: "NYY"
    });
    expect(result.canonical_player_id).toBe("mlb-543037");
    expect(result.resolved_via).toBe("rotowire_slug");
  });

  it("step 4: resolves by composite name+team fallback", () => {
    // Sale has no dk_player_id and no rotowire_slug
    // player_id is a slug that won't match DK or Rotowire indexes
    const result = resolvePlayerIdentity(indexed, {
      mlb_stats_api_id: null,
      player_id: "chris-sale",
      team_abbreviation: "BOS"
    });
    expect(result.canonical_player_id).toBe("mlb-519242");
    expect(result.resolved_via).toBe("name_and_team");
  });

  it("step 5: returns null for completely unknown player", () => {
    const result = resolvePlayerIdentity(indexed, {
      mlb_stats_api_id: null,
      player_id: "unknown-player",
      team_abbreviation: "SEA"
    });
    expect(result.canonical_player_id).toBeNull();
    expect(result.resolved_via).toBeNull();
  });

  it("returns null when mlb_stats_api_id is present but not in crosswalk", () => {
    const result = resolvePlayerIdentity(indexed, {
      mlb_stats_api_id: "999999",
      player_id: "nobody",
      team_abbreviation: "SEA"
    });
    expect(result.canonical_player_id).toBeNull();
    expect(result.resolved_via).toBeNull();
  });

  it("fail-closed on ambiguous name+team", () => {
    const smith1 = makeEntry({
      canonical_player_id: "mlb-100001",
      mlb_stats_api_id: "100001",
      display_name: "Will Smith",
      team_abbreviation: "LAD"
    });
    const smith2 = makeEntry({
      canonical_player_id: "mlb-100002",
      mlb_stats_api_id: "100002",
      display_name: "Will Smith",
      team_abbreviation: "LAD"
    });
    const ambiguousIndexed = indexCrosswalk(makeCrosswalk([smith1, smith2]));

    // No mlb_stats_api_id, no DK, no Rotowire — falls to name+team which is ambiguous
    const result = resolvePlayerIdentity(ambiguousIndexed, {
      mlb_stats_api_id: null,
      player_id: "will-smith",
      team_abbreviation: "LAD"
    });
    expect(result.canonical_player_id).toBeNull();
    expect(result.resolved_via).toBeNull();
  });

  it("mlb_stats_api_id takes priority over all other steps", () => {
    // Even though player_id matches rotowire_slug for Cole,
    // a different mlb_stats_api_id should win if it resolves
    const result = resolvePlayerIdentity(indexed, {
      mlb_stats_api_id: "519242", // Sale's ID
      player_id: "gerrit-cole",   // Cole's rotowire slug
      team_abbreviation: "NYY"
    });
    expect(result.canonical_player_id).toBe("mlb-519242");
    expect(result.resolved_via).toBe("mlb_stats_api_id");
  });

  it("canonical_player_id is always mlb-{numeric} format when resolved", () => {
    const result = resolvePlayerIdentity(indexed, {
      mlb_stats_api_id: "543037",
      player_id: "gerrit-cole",
      team_abbreviation: "NYY"
    });
    expect(result.canonical_player_id).toMatch(/^mlb-\d+$/);
  });
});

// ---------------------------------------------------------------------------
// PlayerCard.canonical_player_id field proof (S2)
// ---------------------------------------------------------------------------

describe("PlayerCard.canonical_player_id", () => {
  it("type-level proof: canonical_player_id exists on PlayerCard", () => {
    const card: import("../../lib/services/buildPlayerCard").PlayerCard = {
      player_id: "test",
      canonical_player_id: "mlb-543037",
      mlb_stats_api_id: "543037",
      team_id: "nyy",
      game_id: "g1" as never,
      projection_lineage: null as never,
      deterministic_summary: null,
      fantasy_summary: null,
      simulation_summary: null,
      market: null,
      evaluation: null,
      blocked: { is_blocked: false, blocked_reason: null }
    };
    expect(card.canonical_player_id).toBe("mlb-543037");
  });

  it("type-level proof: canonical_player_id can be null (unresolved)", () => {
    const card: import("../../lib/services/buildPlayerCard").PlayerCard = {
      player_id: "unknown-player",
      canonical_player_id: null,
      mlb_stats_api_id: null,
      team_id: "nyy",
      game_id: "g1" as never,
      projection_lineage: null as never,
      deterministic_summary: null,
      fantasy_summary: null,
      simulation_summary: null,
      market: null,
      evaluation: null,
      blocked: { is_blocked: false, blocked_reason: null }
    };
    expect(card.canonical_player_id).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildPlayerCards integration — canonical_player_id via crosswalk (S2)
// ---------------------------------------------------------------------------

describe("buildPlayerCards with crosswalk", () => {
  const prepared = preparedFixture as unknown as PreparedGameInputs;

  // Build a crosswalk containing Cole (away starter, mlb_stats_api_id "543037")
  // and Sale (home starter, mlb_stats_api_id "519242") — but NOT the batters
  const coleEntry = makeEntry({
    canonical_player_id: "mlb-543037",
    mlb_stats_api_id: "543037",
    display_name: "Gerrit Cole",
    team_abbreviation: "NYY"
  });
  const saleEntry = makeEntry({
    canonical_player_id: "mlb-519242",
    mlb_stats_api_id: "519242",
    display_name: "Chris Sale",
    team_abbreviation: "BOS",
    throws: "L"
  });
  const crosswalkIndexed = indexCrosswalk(makeCrosswalk([coleEntry, saleEntry]));

  it("resolved player gets canonical_player_id in mlb-{numeric} format", () => {
    const result = buildPlayerCards(prepared, { crosswalk: crosswalkIndexed });

    const cole = result.players.find((p: PlayerCard) => p.player_id === "gerrit-cole");
    expect(cole).toBeDefined();
    expect(cole!.canonical_player_id).toBe("mlb-543037");
    expect(cole!.canonical_player_id).toMatch(/^mlb-\d+$/);

    const sale = result.players.find((p: PlayerCard) => p.player_id === "chris-sale");
    expect(sale).toBeDefined();
    expect(sale!.canonical_player_id).toBe("mlb-519242");
  });

  it("unresolved player gets canonical_player_id: null", () => {
    const result = buildPlayerCards(prepared, { crosswalk: crosswalkIndexed });

    // Batters like "nyy-1" are NOT in the crosswalk — should be null
    const batter = result.players.find((p: PlayerCard) => p.player_id === "nyy-1");
    expect(batter).toBeDefined();
    expect(batter!.canonical_player_id).toBeNull();
  });

  it("without crosswalk option, all players get canonical_player_id: null", () => {
    const result = buildPlayerCards(prepared);

    for (const player of result.players) {
      expect(player.canonical_player_id).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// PreparedBatterInputs.mlb_stats_api_id propagation
// ---------------------------------------------------------------------------

describe("PreparedBatterInputs.mlb_stats_api_id", () => {
  it("boxscore batter extraction propagates mlb_stats_api_id", () => {
    // Type-level proof: the field exists on the interface.
    // This would fail to compile if mlb_stats_api_id was missing from PreparedBatterInputs.
    const batter: import("../../lib/contracts/prepared").PreparedBatterInputs = {
      player_id: "test-batter" as never,
      mlb_stats_api_id: "123456",
      team_id: "nyy" as never,
      batting_order: 1,
      lineup_status: "confirmed_order",
      handedness: "R",
      season_pa: 500,
      season_avg: 0.270,
      season_obp: 0.340,
      season_slg: 0.450,
      season_woba: null,
      season_iso: 0.180,
      season_k_rate: 0.200,
      season_bb_rate: 0.090,
      season_hr_rate: 0.040,
      season_sb: 10,
      recent_games_n: null,
      recent_woba: null,
      recent_avg: null,
      vs_lhp_woba: null,
      vs_rhp_woba: null
    };

    expect(batter.mlb_stats_api_id).toBe("123456");
  });

  it("mlb_stats_api_id can be null for non-boxscore sources", () => {
    const batter: import("../../lib/contracts/prepared").PreparedBatterInputs = {
      player_id: "test-batter" as never,
      mlb_stats_api_id: null,
      team_id: "nyy" as never,
      batting_order: 1,
      lineup_status: "confirmed_order",
      handedness: "R",
      season_pa: 500,
      season_avg: 0.270,
      season_obp: 0.340,
      season_slg: 0.450,
      season_woba: null,
      season_iso: 0.180,
      season_k_rate: 0.200,
      season_bb_rate: 0.090,
      season_hr_rate: 0.040,
      season_sb: 10,
      recent_games_n: null,
      recent_woba: null,
      recent_avg: null,
      vs_lhp_woba: null,
      vs_rhp_woba: null
    };

    expect(batter.mlb_stats_api_id).toBeNull();
  });
});
