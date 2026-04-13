import { describe, expect, it } from "vitest";
import {
  resolveGameStarters,
  type StarterCandidate,
  type StarterResolutionInput
} from "../../lib/starters/resolve";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const OBSERVED = "2026-04-13T12:00:00.000Z";
const SOURCE_UPDATED = "2026-04-13T11:45:00.000Z";

const makeCandidate = (
  overrides: Partial<StarterCandidate> & Pick<StarterCandidate, "source_key" | "source_tier" | "confidence">
): StarterCandidate => ({
  player_id: "gerrit-cole",
  full_name: "Gerrit Cole",
  mlb_stats_api_id: null,
  freshness_status: "fresh",
  observed_at: OBSERVED,
  source_updated_at: SOURCE_UPDATED,
  status: "projected",
  raw_ref: null,
  ...overrides
});

const makeInput = (
  away: readonly StarterCandidate[],
  home: readonly StarterCandidate[]
): StarterResolutionInput => ({
  game_id: "mlb-2026-04-13-nyy-bos",
  game_date: "2026-04-13",
  away_candidates: away,
  home_candidates: home
});

// ---------------------------------------------------------------------------
// Empty candidates
// ---------------------------------------------------------------------------

describe("resolveGameStarters — empty candidates", () => {
  it("returns null away when no away candidates", () => {
    const result = resolveGameStarters(makeInput([], []));
    expect(result.away).toBeNull();
  });

  it("returns null home when no home candidates", () => {
    const result = resolveGameStarters(makeInput([], []));
    expect(result.home).toBeNull();
  });

  it("returns null resolution_notes when both sides have no candidates", () => {
    const result = resolveGameStarters(makeInput([], []));
    expect(result.resolution_notes).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Single candidate
// ---------------------------------------------------------------------------

describe("resolveGameStarters — single candidate", () => {
  it("resolves a single away candidate", () => {
    const c = makeCandidate({ source_key: "rotowire", source_tier: "projected", confidence: 0.9 });
    const result = resolveGameStarters(makeInput([c], []));
    expect(result.away).not.toBeNull();
    expect(result.away?.source_key).toBe("rotowire");
    expect(result.away?.confidence).toBe(0.9);
    expect(result.away?.player_id).toBe("gerrit-cole");
  });

  it("resolves a single home candidate", () => {
    const c = makeCandidate({ source_key: "rotowire", source_tier: "projected", confidence: 0.6, player_id: "chris-sale", full_name: "Chris Sale" });
    const result = resolveGameStarters(makeInput([], [c]));
    expect(result.home).not.toBeNull();
    expect(result.home?.full_name).toBe("Chris Sale");
  });

  it("records the source in resolution_notes", () => {
    const c = makeCandidate({ source_key: "rotowire", source_tier: "projected", confidence: 0.9 });
    const result = resolveGameStarters(makeInput([c], []));
    expect(result.resolution_notes).toContain("rotowire");
    expect(result.resolution_notes).toContain("projected");
  });
});

// ---------------------------------------------------------------------------
// One-side-known truth preserved
// ---------------------------------------------------------------------------

describe("resolveGameStarters — one-side-known", () => {
  it("preserves away when home is empty", () => {
    const c = makeCandidate({ source_key: "rotowire", source_tier: "projected", confidence: 0.9 });
    const result = resolveGameStarters(makeInput([c], []));
    expect(result.away).not.toBeNull();
    expect(result.home).toBeNull();
  });

  it("preserves home when away is empty", () => {
    const c = makeCandidate({ source_key: "rotowire", source_tier: "projected", confidence: 0.6, player_id: "chris-sale", full_name: "Chris Sale" });
    const result = resolveGameStarters(makeInput([], [c]));
    expect(result.away).toBeNull();
    expect(result.home).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Multiple candidates — different tiers
// ---------------------------------------------------------------------------

describe("resolveGameStarters — multiple candidates, different tiers", () => {
  it("higher-tier candidate wins over lower-tier candidate", () => {
    const projected = makeCandidate({ source_key: "rotowire", source_tier: "projected", confidence: 0.9 });
    const inferred = makeCandidate({ source_key: "model", source_tier: "inferred", confidence: 0.95, full_name: "Different Arm" });
    const result = resolveGameStarters(makeInput([projected, inferred], []));
    expect(result.away?.source_key).toBe("rotowire");
    expect(result.away?.source_tier).toBe("projected");
  });

  it("official tier beats projected regardless of confidence", () => {
    const projected = makeCandidate({ source_key: "rotowire", source_tier: "projected", confidence: 0.98 });
    const official = makeCandidate({ source_key: "mlb-api", source_tier: "official", confidence: 0.5 });
    const result = resolveGameStarters(makeInput([projected, official], []));
    expect(result.away?.source_tier).toBe("official");
    expect(result.away?.source_key).toBe("mlb-api");
  });

  it("notes include lower-tier candidate count", () => {
    const projected = makeCandidate({ source_key: "rotowire", source_tier: "projected", confidence: 0.9 });
    const inferred = makeCandidate({ source_key: "model", source_tier: "inferred", confidence: 0.95 });
    const result = resolveGameStarters(makeInput([projected, inferred], []));
    expect(result.resolution_notes).toContain("over 1 lower-tier candidate(s)");
  });
});

// ---------------------------------------------------------------------------
// Multiple candidates — same tier, convergent (same player)
// ---------------------------------------------------------------------------

describe("resolveGameStarters — same tier, convergent", () => {
  it("takes the higher-confidence candidate when same player from two sources", () => {
    const a = makeCandidate({ source_key: "rotowire", source_tier: "projected", confidence: 0.9 });
    const b = makeCandidate({ source_key: "fangraphs", source_tier: "projected", confidence: 0.6 });
    const result = resolveGameStarters(makeInput([a, b], []));
    expect(result.away?.source_key).toBe("rotowire");
    expect(result.away?.confidence).toBe(0.9);
  });

  it("tiebreaks deterministically by source_key when confidence is equal", () => {
    const a = makeCandidate({ source_key: "rotowire", source_tier: "projected", confidence: 0.9 });
    const b = makeCandidate({ source_key: "fangraphs", source_tier: "projected", confidence: 0.9 });
    const result = resolveGameStarters(makeInput([a, b], []));
    // "fangraphs" < "rotowire" alphabetically — fangraphs wins tiebreak
    expect(result.away?.source_key).toBe("fangraphs");
  });

  it("records convergent resolution in notes", () => {
    const a = makeCandidate({ source_key: "rotowire", source_tier: "projected", confidence: 0.9 });
    const b = makeCandidate({ source_key: "fangraphs", source_tier: "projected", confidence: 0.6 });
    const result = resolveGameStarters(makeInput([a, b], []));
    expect(result.resolution_notes).toContain("convergent");
    expect(result.resolution_notes).toContain("count=2");
  });

  it("treats all-null names as convergent (no name to conflict)", () => {
    const a = makeCandidate({ source_key: "rotowire", source_tier: "projected", confidence: 0.9, full_name: null });
    const b = makeCandidate({ source_key: "fangraphs", source_tier: "projected", confidence: 0.6, full_name: null });
    const result = resolveGameStarters(makeInput([a, b], []));
    // No conflict — convergent path taken; higher confidence wins
    expect(result.away).not.toBeNull();
    expect(result.away?.source_key).toBe("rotowire");
  });
});

// ---------------------------------------------------------------------------
// Multiple candidates — same tier, name conflict, confidence delta > threshold
// ---------------------------------------------------------------------------

describe("resolveGameStarters — name conflict, confidence delta > threshold", () => {
  it("higher-confidence candidate wins when delta exceeds threshold", () => {
    const a = makeCandidate({
      source_key: "rotowire", source_tier: "projected", confidence: 0.9,
      player_id: "gerrit-cole", full_name: "Gerrit Cole"
    });
    const b = makeCandidate({
      source_key: "fangraphs", source_tier: "projected", confidence: 0.3,
      player_id: "unknown-arm", full_name: "Unknown Arm"
    });
    const result = resolveGameStarters(makeInput([a, b], []));
    expect(result.away?.full_name).toBe("Gerrit Cole");
    expect(result.away?.source_key).toBe("rotowire");
  });

  it("records delta in notes when confidence resolves the conflict", () => {
    const a = makeCandidate({ source_key: "rotowire", source_tier: "projected", confidence: 0.9, full_name: "Gerrit Cole" });
    const b = makeCandidate({ source_key: "fangraphs", source_tier: "projected", confidence: 0.3, full_name: "Unknown Arm" });
    const result = resolveGameStarters(makeInput([a, b], []));
    expect(result.resolution_notes).toContain("delta=0.60");
    expect(result.resolution_notes).toContain("> threshold");
  });
});

// ---------------------------------------------------------------------------
// Multiple candidates — same tier, name conflict, confidence delta ≤ threshold
// ---------------------------------------------------------------------------

describe("resolveGameStarters — name conflict, AMBIGUOUS (delta ≤ threshold)", () => {
  it("returns null away when ambiguous", () => {
    const a = makeCandidate({
      source_key: "rotowire", source_tier: "projected", confidence: 0.9,
      player_id: "gerrit-cole", full_name: "Gerrit Cole"
    });
    const b = makeCandidate({
      source_key: "fangraphs", source_tier: "projected", confidence: 0.85,
      player_id: "unknown-arm", full_name: "Unknown Arm"
    });
    const result = resolveGameStarters(makeInput([a, b], []));
    expect(result.away).toBeNull();
  });

  it("records AMBIGUOUS in resolution_notes", () => {
    const a = makeCandidate({ source_key: "rotowire", source_tier: "projected", confidence: 0.9, full_name: "Gerrit Cole" });
    const b = makeCandidate({ source_key: "fangraphs", source_tier: "projected", confidence: 0.85, full_name: "Unknown Arm" });
    const result = resolveGameStarters(makeInput([a, b], []));
    expect(result.resolution_notes).toContain("AMBIGUOUS");
    expect(result.resolution_notes).toContain("no winner chosen");
  });

  it("records all conflicting candidates in notes", () => {
    const a = makeCandidate({ source_key: "rotowire", source_tier: "projected", confidence: 0.9, full_name: "Gerrit Cole" });
    const b = makeCandidate({ source_key: "fangraphs", source_tier: "projected", confidence: 0.85, full_name: "Unknown Arm" });
    const result = resolveGameStarters(makeInput([a, b], []));
    expect(result.resolution_notes).toContain("Gerrit Cole");
    expect(result.resolution_notes).toContain("Unknown Arm");
  });

  it("records delta and threshold in notes", () => {
    const a = makeCandidate({ source_key: "rotowire", source_tier: "projected", confidence: 0.9, full_name: "Gerrit Cole" });
    const b = makeCandidate({ source_key: "fangraphs", source_tier: "projected", confidence: 0.85, full_name: "Unknown Arm" });
    const result = resolveGameStarters(makeInput([a, b], []));
    expect(result.resolution_notes).toContain("delta=0.05");
    expect(result.resolution_notes).toContain("<= 0.15");
  });

  it("returns null when confidence is exactly equal with conflicting names", () => {
    const a = makeCandidate({ source_key: "rotowire", source_tier: "projected", confidence: 0.9, full_name: "Gerrit Cole" });
    const b = makeCandidate({ source_key: "fangraphs", source_tier: "projected", confidence: 0.9, full_name: "Unknown Arm" });
    const result = resolveGameStarters(makeInput([a, b], []));
    expect(result.away).toBeNull();
    expect(result.resolution_notes).toContain("AMBIGUOUS");
  });
});

// ---------------------------------------------------------------------------
// Independent side resolution
// ---------------------------------------------------------------------------

describe("resolveGameStarters — independent sides", () => {
  it("away ambiguous does not affect home resolution", () => {
    const awayA = makeCandidate({ source_key: "rotowire", source_tier: "projected", confidence: 0.9, full_name: "Gerrit Cole" });
    const awayB = makeCandidate({ source_key: "fangraphs", source_tier: "projected", confidence: 0.85, full_name: "Unknown Arm" });
    const home = makeCandidate({ source_key: "rotowire", source_tier: "projected", confidence: 0.6, player_id: "chris-sale", full_name: "Chris Sale" });
    const result = resolveGameStarters(makeInput([awayA, awayB], [home]));
    expect(result.away).toBeNull();
    expect(result.home).not.toBeNull();
    expect(result.home?.full_name).toBe("Chris Sale");
  });

  it("home ambiguous does not affect away resolution", () => {
    const away = makeCandidate({ source_key: "rotowire", source_tier: "projected", confidence: 0.9 });
    const homeA = makeCandidate({ source_key: "rotowire", source_tier: "projected", confidence: 0.9, player_id: "chris-sale", full_name: "Chris Sale" });
    const homeB = makeCandidate({ source_key: "fangraphs", source_tier: "projected", confidence: 0.85, player_id: "other-pitcher", full_name: "Other Pitcher" });
    const result = resolveGameStarters(makeInput([away], [homeA, homeB]));
    expect(result.away).not.toBeNull();
    expect(result.home).toBeNull();
  });

  it("both sides ambiguous returns both null with both recorded in notes", () => {
    const awayA = makeCandidate({ source_key: "rotowire", source_tier: "projected", confidence: 0.9, full_name: "Gerrit Cole" });
    const awayB = makeCandidate({ source_key: "fangraphs", source_tier: "projected", confidence: 0.85, full_name: "Unknown Arm" });
    const homeA = makeCandidate({ source_key: "rotowire", source_tier: "projected", confidence: 0.9, player_id: "chris-sale", full_name: "Chris Sale" });
    const homeB = makeCandidate({ source_key: "fangraphs", source_tier: "projected", confidence: 0.85, player_id: "other-pitcher", full_name: "Other Pitcher" });
    const result = resolveGameStarters(makeInput([awayA, awayB], [homeA, homeB]));
    expect(result.away).toBeNull();
    expect(result.home).toBeNull();
    // Notes contains AMBIGUOUS mention for both sides
    const notes = result.resolution_notes ?? "";
    expect(notes.match(/AMBIGUOUS/g)?.length).toBe(2);
  });

  it("both sides resolved includes both decisions in notes separated by pipe", () => {
    const away = makeCandidate({ source_key: "rotowire", source_tier: "projected", confidence: 0.9 });
    const home = makeCandidate({ source_key: "rotowire", source_tier: "projected", confidence: 0.6, player_id: "chris-sale", full_name: "Chris Sale" });
    const result = resolveGameStarters(makeInput([away], [home]));
    expect(result.resolution_notes).toContain(" | ");
  });
});

// ---------------------------------------------------------------------------
// Fieldmapping fidelity
// ---------------------------------------------------------------------------

describe("resolveGameStarters — field mapping", () => {
  it("preserves player_id as branded value", () => {
    const c = makeCandidate({ source_key: "rotowire", source_tier: "projected", confidence: 0.9, player_id: "gerrit-cole" });
    const result = resolveGameStarters(makeInput([c], []));
    expect(result.away?.player_id).toBe("gerrit-cole");
  });

  it("preserves null player_id without fabricating one", () => {
    const c = makeCandidate({ source_key: "rotowire", source_tier: "projected", confidence: 0.9, player_id: null });
    const result = resolveGameStarters(makeInput([c], []));
    expect(result.away?.player_id).toBeNull();
  });

  it("preserves mlb_stats_api_id null", () => {
    const c = makeCandidate({ source_key: "rotowire", source_tier: "projected", confidence: 0.9, mlb_stats_api_id: null });
    const result = resolveGameStarters(makeInput([c], []));
    expect(result.away?.mlb_stats_api_id).toBeNull();
  });

  it("preserves source_updated_at null", () => {
    const c = makeCandidate({ source_key: "rotowire", source_tier: "projected", confidence: 0.9, source_updated_at: null });
    const result = resolveGameStarters(makeInput([c], []));
    expect(result.away?.source_updated_at).toBeNull();
  });

  it("preserves observed_at string as ISOTimestamp", () => {
    const c = makeCandidate({ source_key: "rotowire", source_tier: "projected", confidence: 0.9, observed_at: OBSERVED });
    const result = resolveGameStarters(makeInput([c], []));
    expect(result.away?.observed_at).toBe(OBSERVED);
  });

  it("preserves raw_ref when present", () => {
    const c = makeCandidate({ source_key: "rotowire", source_tier: "projected", confidence: 0.9, raw_ref: { foo: "bar" } });
    const result = resolveGameStarters(makeInput([c], []));
    expect(result.away?.raw_ref).toEqual({ foo: "bar" });
  });
});
