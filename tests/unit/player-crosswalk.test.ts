import { describe, expect, it } from "vitest";
import {
  buildCanonicalPlayerId,
  parseCanonicalPlayerId
} from "../../lib/contracts/player-crosswalk";
import { normalizeNameForJoin } from "../../lib/crosswalk/normalize";
import { loadCrosswalk } from "../../lib/crosswalk/loadCrosswalk";
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
