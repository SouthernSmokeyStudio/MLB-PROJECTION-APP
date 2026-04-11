/**
 * merge-wiring.test.ts
 *
 * Proves A6 — Merge/Wiring Integration into the Materialized Input Path:
 *
 * 1. Official-only path behaves as before (no projected/inferred)
 * 2. Projected beats inferred when official absent
 * 3. Official beats projected when both exist
 * 4. Null/missing candidates fail closed
 * 5. No silent blending occurs after wiring
 * 6. Normalization correctly converts each tier's native types
 * 7. applyMergedStartersToCanonical patches/preserves correctly
 * 8. resolveGameSources end-to-end orchestration
 */

import { describe, expect, it } from "vitest";
import type { CanonicalGame, ProbablePitcher, LineupEntry } from "../../lib/contracts/canonical";
import type { ProjectedGameData, ProjectedStarter, ProjectedLineupEntry } from "../../lib/contracts/projected-source";
import type { InferredGameData, InferredStarter, InferredLineupEntry, InferenceReasoning } from "../../lib/contracts/inferred-source";
import { asGameId, asISOTimestamp, asPlayerId, asTeamId } from "../../lib/contracts/types";
import { SPORT_ID } from "../../lib/contracts/types";
import {
  officialStarterToCandidate,
  officialLineupToCandidate,
  projectedStarterToCandidate,
  projectedLineupToCandidate,
  inferredStarterToCandidate,
  inferredLineupToCandidate,
  buildMergeGameInput
} from "../../lib/merge/normalizeToMergeInput";
import {
  resolveGameSources,
  applyMergedStartersToCanonical
} from "../../lib/merge/resolveGameSources";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeCanonicalGame = (overrides?: {
  awayPitcher?: ProbablePitcher | null;
  homePitcher?: ProbablePitcher | null;
  awayLineup?: readonly LineupEntry[] | null;
  homeLineup?: readonly LineupEntry[] | null;
}): CanonicalGame => ({
  game_id: asGameId("mlb-2026-04-10-nyy-bos"),
  sport_id: SPORT_ID,
  scheduled_start: asISOTimestamp("2026-04-10T18:05:00Z"),
  status: "scheduled",
  away: {
    team: {
      team_id: asTeamId("nyy"),
      sport_id: SPORT_ID,
      abbreviation: "NYY",
      full_name: "New York Yankees",
      league: "AL",
      division: "East"
    },
    probable_pitcher: overrides?.awayPitcher !== undefined
      ? overrides.awayPitcher
      : {
          player_id: asPlayerId("gerrit-cole"),
          mlb_stats_api_id: "543037",
          starting_status: "confirmed",
          handedness: "R"
        },
    lineup: overrides?.awayLineup !== undefined ? overrides.awayLineup : null,
    lineup_confirmed: false
  },
  home: {
    team: {
      team_id: asTeamId("bos"),
      sport_id: SPORT_ID,
      abbreviation: "BOS",
      full_name: "Boston Red Sox",
      league: "AL",
      division: "East"
    },
    probable_pitcher: overrides?.homePitcher !== undefined
      ? overrides.homePitcher
      : {
          player_id: asPlayerId("chris-sale"),
          mlb_stats_api_id: "519242",
          starting_status: "probable",
          handedness: "L"
        },
    lineup: overrides?.homeLineup !== undefined ? overrides.homeLineup : null,
    lineup_confirmed: false
  },
  venue: null,
  weather: null,
  sources: [],
  freshness: {
    is_stale: false,
    stale_reason: null,
    last_synced: asISOTimestamp("2026-04-10T12:00:00Z")
  },
  raw_payload_refs: []
});

const makeReasoning = (): InferenceReasoning => ({
  strategy: "rotation-pattern",
  confidence: "medium",
  reason: "test",
  based_on_games: 10
});

const makeProjectedGameData = (overrides?: {
  awayStarter?: ProjectedStarter | null;
  homeStarter?: ProjectedStarter | null;
  awayLineup?: readonly ProjectedLineupEntry[] | null;
  homeLineup?: readonly ProjectedLineupEntry[] | null;
}): ProjectedGameData => ({
  game_id: asGameId("mlb-2026-04-10-nyy-bos"),
  away_starter: overrides?.awayStarter !== undefined ? overrides.awayStarter : {
    player_id: asPlayerId("cole-projected"),
    full_name: "Cole Projected",
    team_id: asTeamId("nyy"),
    handedness: "R",
    starting_status: "expected",
    confidence: "high"
  },
  home_starter: overrides?.homeStarter !== undefined ? overrides.homeStarter : {
    player_id: asPlayerId("sale-projected"),
    full_name: "Sale Projected",
    team_id: asTeamId("bos"),
    handedness: "L",
    starting_status: "expected",
    confidence: "medium"
  },
  away_lineup: overrides?.awayLineup !== undefined ? overrides.awayLineup : null,
  home_lineup: overrides?.homeLineup !== undefined ? overrides.homeLineup : null
});

const makeInferredGameData = (overrides?: {
  awayStarter?: InferredStarter | null;
  homeStarter?: InferredStarter | null;
  awayLineup?: readonly InferredLineupEntry[] | null;
  homeLineup?: readonly InferredLineupEntry[] | null;
}): InferredGameData => ({
  game_id: asGameId("mlb-2026-04-10-nyy-bos"),
  away_starter: overrides?.awayStarter !== undefined ? overrides.awayStarter : {
    player_id: asPlayerId("cole-inferred"),
    team_id: asTeamId("nyy"),
    handedness: "R",
    starting_status: "expected",
    inference: makeReasoning()
  },
  home_starter: overrides?.homeStarter !== undefined ? overrides.homeStarter : {
    player_id: asPlayerId("sale-inferred"),
    team_id: asTeamId("bos"),
    handedness: "L",
    starting_status: "expected",
    inference: makeReasoning()
  },
  away_lineup: overrides?.awayLineup !== undefined ? overrides.awayLineup : null,
  home_lineup: overrides?.homeLineup !== undefined ? overrides.homeLineup : null
});

// ---------------------------------------------------------------------------
// 1. Normalizer correctness
// ---------------------------------------------------------------------------

describe("normalizeToMergeInput — tier normalizers", () => {
  it("officialStarterToCandidate converts ProbablePitcher to official-tier candidate", () => {
    const pitcher: ProbablePitcher = {
      player_id: asPlayerId("gerrit-cole"),
      mlb_stats_api_id: "543037",
      starting_status: "confirmed",
      handedness: "R"
    };

    const candidate = officialStarterToCandidate(pitcher, asTeamId("nyy"));

    expect(candidate).not.toBeNull();
    expect(candidate!.tier).toBe("official");
    expect(candidate!.player_id).toBe("gerrit-cole");
    expect(candidate!.team_id).toBe("nyy");
    expect(candidate!.handedness).toBe("R");
    expect(candidate!.starting_status).toBe("confirmed");
    // mlb_stats_api_id is NOT on merge candidate — provider-specific field stays outside
    expect(candidate).not.toHaveProperty("mlb_stats_api_id");
  });

  it("officialStarterToCandidate returns null for null pitcher", () => {
    expect(officialStarterToCandidate(null, asTeamId("nyy"))).toBeNull();
  });

  it("officialLineupToCandidate converts LineupEntry[] to official-tier candidate", () => {
    const lineup: LineupEntry[] = [
      { player_id: asPlayerId("judge"), batting_order: 1, starting_status: "confirmed", position: "RF" },
      { player_id: asPlayerId("soto"), batting_order: 2, starting_status: "confirmed", position: "LF" }
    ];

    const candidate = officialLineupToCandidate(lineup, asTeamId("nyy"));

    expect(candidate).not.toBeNull();
    expect(candidate!.tier).toBe("official");
    expect(candidate!.entries).toHaveLength(2);
    expect(candidate!.entries[0]!.player_id).toBe("judge");
    expect(candidate!.entries[0]!.team_id).toBe("nyy");
  });

  it("officialLineupToCandidate returns null for null or empty lineup", () => {
    expect(officialLineupToCandidate(null, asTeamId("nyy"))).toBeNull();
    expect(officialLineupToCandidate([], asTeamId("nyy"))).toBeNull();
  });

  it("projectedStarterToCandidate tags tier as projected", () => {
    const starter: ProjectedStarter = {
      player_id: asPlayerId("cole-proj"),
      full_name: "Cole Proj",
      team_id: asTeamId("nyy"),
      handedness: "R",
      starting_status: "expected",
      confidence: "high"
    };

    const candidate = projectedStarterToCandidate(starter);

    expect(candidate!.tier).toBe("projected");
    expect(candidate!.projection_confidence).toBe("high");
    // inference_confidence should NOT be present
    expect(candidate!.inference_confidence).toBeUndefined();
  });

  it("inferredStarterToCandidate tags tier as inferred", () => {
    const starter: InferredStarter = {
      player_id: asPlayerId("cole-inf"),
      team_id: asTeamId("nyy"),
      handedness: "R",
      starting_status: "expected",
      inference: makeReasoning()
    };

    const candidate = inferredStarterToCandidate(starter);

    expect(candidate!.tier).toBe("inferred");
    expect(candidate!.inference_confidence).toBe("medium");
    // projection_confidence should NOT be present
    expect(candidate!.projection_confidence).toBeUndefined();
    // inference reasoning should NOT leak into candidate
    expect(candidate).not.toHaveProperty("inference");
  });

  it("projectedLineupToCandidate and inferredLineupToCandidate normalize correctly", () => {
    const projectedLineup: ProjectedLineupEntry[] = [
      { player_id: asPlayerId("p1"), team_id: asTeamId("nyy"), batting_order: 1, position: "RF", starting_status: "expected" }
    ];
    const inferredLineup: InferredLineupEntry[] = [
      { player_id: asPlayerId("i1"), team_id: asTeamId("nyy"), batting_order: 1, position: "RF", starting_status: "expected", inference: makeReasoning() }
    ];

    const projCandidate = projectedLineupToCandidate(projectedLineup);
    const infCandidate = inferredLineupToCandidate(inferredLineup);

    expect(projCandidate!.tier).toBe("projected");
    expect(infCandidate!.tier).toBe("inferred");
    // Inference metadata does NOT leak into lineup entry candidates
    expect(infCandidate!.entries[0]).not.toHaveProperty("inference");
  });
});

// ---------------------------------------------------------------------------
// 2. buildMergeGameInput assembly
// ---------------------------------------------------------------------------

describe("buildMergeGameInput — full game assembly", () => {
  it("assembles all three tiers into MergeGameInput", () => {
    const game = makeCanonicalGame();
    const projected = makeProjectedGameData();
    const inferred = makeInferredGameData();

    const mergeInput = buildMergeGameInput(game.game_id, {
      official: {
        away_starter: game.away.probable_pitcher,
        home_starter: game.home.probable_pitcher,
        away_lineup: game.away.lineup,
        home_lineup: game.home.lineup,
        away_team_id: game.away.team.team_id,
        home_team_id: game.home.team.team_id
      },
      projected,
      inferred
    });

    expect(mergeInput.game_id).toBe("mlb-2026-04-10-nyy-bos");
    // Official starters should be present
    expect(mergeInput.away.starter.official).not.toBeNull();
    expect(mergeInput.home.starter.official).not.toBeNull();
    // Projected starters should be present
    expect(mergeInput.away.starter.projected).not.toBeNull();
    expect(mergeInput.home.starter.projected).not.toBeNull();
    // Inferred starters should be present
    expect(mergeInput.away.starter.inferred).not.toBeNull();
    expect(mergeInput.home.starter.inferred).not.toBeNull();
    // Lineups: official null (no lineup on canonical), projected null, inferred null
    expect(mergeInput.away.lineup.official).toBeNull();
    expect(mergeInput.away.lineup.projected).toBeNull();
    expect(mergeInput.away.lineup.inferred).toBeNull();
  });

  it("absent tiers contribute null candidates", () => {
    const game = makeCanonicalGame();

    const mergeInput = buildMergeGameInput(game.game_id, {
      official: {
        away_starter: game.away.probable_pitcher,
        home_starter: game.home.probable_pitcher,
        away_lineup: null,
        home_lineup: null,
        away_team_id: game.away.team.team_id,
        home_team_id: game.home.team.team_id
      }
      // projected and inferred omitted
    });

    expect(mergeInput.away.starter.official).not.toBeNull();
    expect(mergeInput.away.starter.projected).toBeNull();
    expect(mergeInput.away.starter.inferred).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Official-only path behaves as before
// ---------------------------------------------------------------------------

describe("resolveGameSources — official-only path", () => {
  it("returns official winner when no projected/inferred provided", () => {
    const game = makeCanonicalGame();
    const merged = resolveGameSources(game);

    expect(merged.away.starter).not.toBeNull();
    expect(merged.away.starter!.source_tier).toBe("official");
    expect(merged.away.starter!.player_id).toBe("gerrit-cole");
    expect(merged.home.starter!.source_tier).toBe("official");
    expect(merged.home.starter!.player_id).toBe("chris-sale");
  });

  it("applyMergedStartersToCanonical returns original game unchanged (same ref)", () => {
    const game = makeCanonicalGame();
    const merged = resolveGameSources(game);
    const patched = applyMergedStartersToCanonical(game, merged);

    // Same object reference — zero change
    expect(patched).toBe(game);
    expect(patched.away.probable_pitcher).toBe(game.away.probable_pitcher);
    expect(patched.home.probable_pitcher).toBe(game.home.probable_pitcher);
  });

  it("null projected and inferred are equivalent to omitted", () => {
    const game = makeCanonicalGame();
    const mergedA = resolveGameSources(game);
    const mergedB = resolveGameSources(game, null, null);

    expect(mergedA).toEqual(mergedB);
  });
});

// ---------------------------------------------------------------------------
// 4. Official beats projected when both exist
// ---------------------------------------------------------------------------

describe("resolveGameSources — official beats projected", () => {
  it("official starter wins over projected starter", () => {
    const game = makeCanonicalGame();
    const projected = makeProjectedGameData();

    const merged = resolveGameSources(game, projected);

    expect(merged.away.starter!.source_tier).toBe("official");
    expect(merged.away.starter!.player_id).toBe("gerrit-cole");
    expect(merged.away.starter!.merge_explanation.overridden_tiers).toContain("projected");
  });

  it("applyMergedStartersToCanonical returns original when official wins", () => {
    const game = makeCanonicalGame();
    const projected = makeProjectedGameData();
    const merged = resolveGameSources(game, projected);
    const patched = applyMergedStartersToCanonical(game, merged);

    // Official won → no change to canonical
    expect(patched).toBe(game);
  });
});

// ---------------------------------------------------------------------------
// 5. Projected beats inferred when official absent
// ---------------------------------------------------------------------------

describe("resolveGameSources — projected beats inferred", () => {
  it("projected starter wins when official is null", () => {
    const game = makeCanonicalGame({ awayPitcher: null, homePitcher: null });
    const projected = makeProjectedGameData();
    const inferred = makeInferredGameData();

    const merged = resolveGameSources(game, projected, inferred);

    expect(merged.away.starter!.source_tier).toBe("projected");
    expect(merged.away.starter!.player_id).toBe("cole-projected");
    expect(merged.home.starter!.source_tier).toBe("projected");
    expect(merged.home.starter!.player_id).toBe("sale-projected");
  });

  it("applyMergedStartersToCanonical patches probable_pitcher from projected winner", () => {
    const game = makeCanonicalGame({ awayPitcher: null, homePitcher: null });
    const projected = makeProjectedGameData();
    const merged = resolveGameSources(game, projected);
    const patched = applyMergedStartersToCanonical(game, merged);

    // Should be a new object (projected winner patched in)
    expect(patched).not.toBe(game);
    expect(patched.away.probable_pitcher).not.toBeNull();
    expect(patched.away.probable_pitcher!.player_id).toBe("cole-projected");
    expect(patched.away.probable_pitcher!.handedness).toBe("R");
    expect(patched.away.probable_pitcher!.starting_status).toBe("expected");
    // Synthetic pitcher has null mlb_stats_api_id (provider-specific field not available)
    expect(patched.away.probable_pitcher!.mlb_stats_api_id).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. Inferred fills when official and projected absent
// ---------------------------------------------------------------------------

describe("resolveGameSources — inferred fills gaps", () => {
  it("inferred starter wins when official and projected absent", () => {
    const game = makeCanonicalGame({ awayPitcher: null });
    const inferred = makeInferredGameData();

    const merged = resolveGameSources(game, null, inferred);

    expect(merged.away.starter!.source_tier).toBe("inferred");
    expect(merged.away.starter!.player_id).toBe("cole-inferred");
    // Home still has official
    expect(merged.home.starter!.source_tier).toBe("official");
  });

  it("applyMergedStartersToCanonical patches only the inferred side", () => {
    const game = makeCanonicalGame({ awayPitcher: null });
    const inferred = makeInferredGameData();
    const merged = resolveGameSources(game, null, inferred);
    const patched = applyMergedStartersToCanonical(game, merged);

    expect(patched.away.probable_pitcher!.player_id).toBe("cole-inferred");
    // Home side unchanged
    expect(patched.home.probable_pitcher).toBe(game.home.probable_pitcher);
  });
});

// ---------------------------------------------------------------------------
// 7. Null/missing candidates fail closed
// ---------------------------------------------------------------------------

describe("resolveGameSources — fail closed on missing data", () => {
  it("all-null starters produce null merged output", () => {
    const game = makeCanonicalGame({ awayPitcher: null, homePitcher: null });
    const merged = resolveGameSources(game);

    expect(merged.away.starter).toBeNull();
    expect(merged.home.starter).toBeNull();
    expect(merged.away.starter_explanation.winner_tier).toBeNull();
    expect(merged.home.starter_explanation.winner_tier).toBeNull();
  });

  it("applyMergedStartersToCanonical preserves null when no tier has data", () => {
    const game = makeCanonicalGame({ awayPitcher: null, homePitcher: null });
    const merged = resolveGameSources(game);
    const patched = applyMergedStartersToCanonical(game, merged);

    // Same ref — both were already null
    expect(patched).toBe(game);
    expect(patched.away.probable_pitcher).toBeNull();
    expect(patched.home.probable_pitcher).toBeNull();
  });

  it("null lineups across all tiers produce null lineup output", () => {
    const game = makeCanonicalGame();
    const merged = resolveGameSources(game);

    expect(merged.away.lineup).toBeNull();
    expect(merged.home.lineup).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 8. No silent blending after wiring
// ---------------------------------------------------------------------------

describe("resolveGameSources — no silent blending", () => {
  it("starter and lineup can come from different tiers independently", () => {
    const game = makeCanonicalGame(); // has official starters, no lineups
    const projected = makeProjectedGameData({
      awayStarter: null,
      homeStarter: null,
      awayLineup: [
        { player_id: asPlayerId("proj-1"), team_id: asTeamId("nyy"), batting_order: 1, position: "RF", starting_status: "expected" }
      ],
      homeLineup: null
    });

    const merged = resolveGameSources(game, projected);

    // Starter from official, lineup from projected — independent slots
    expect(merged.away.starter!.source_tier).toBe("official");
    expect(merged.away.lineup!.source_tier).toBe("projected");
  });

  it("winning lineup entries all come from the same tier", () => {
    const projected = makeProjectedGameData({
      awayLineup: [
        { player_id: asPlayerId("proj-1"), team_id: asTeamId("nyy"), batting_order: 1, position: "RF", starting_status: "expected" },
        { player_id: asPlayerId("proj-2"), team_id: asTeamId("nyy"), batting_order: 2, position: "SS", starting_status: "expected" }
      ]
    });
    const inferred = makeInferredGameData({
      awayLineup: [
        { player_id: asPlayerId("inf-1"), team_id: asTeamId("nyy"), batting_order: 1, position: "RF", starting_status: "expected", inference: makeReasoning() },
        { player_id: asPlayerId("inf-2"), team_id: asTeamId("nyy"), batting_order: 2, position: "SS", starting_status: "expected", inference: makeReasoning() },
        { player_id: asPlayerId("inf-3"), team_id: asTeamId("nyy"), batting_order: 3, position: "1B", starting_status: "expected", inference: makeReasoning() }
      ]
    });

    const game = makeCanonicalGame(); // no official lineup
    const merged = resolveGameSources(game, projected, inferred);

    // Projected wins — 2 entries, not 3 (no blending with inferred)
    expect(merged.away.lineup!.source_tier).toBe("projected");
    expect(merged.away.lineup!.entries).toHaveLength(2);
    for (const entry of merged.away.lineup!.entries) {
      expect(entry.player_id).toContain("proj-");
    }
  });

  it("provider-specific metadata does not appear on merged candidates", () => {
    const game = makeCanonicalGame();
    const projected = makeProjectedGameData();
    const inferred = makeInferredGameData();

    const merged = resolveGameSources(game, projected, inferred);

    // Merged starter should not have inference/projected leakage
    const starter = merged.away.starter!;
    expect(starter).not.toHaveProperty("inference");
    expect(starter).not.toHaveProperty("confidence");
    expect(starter).not.toHaveProperty("mlb_stats_api_id");
  });
});

// ---------------------------------------------------------------------------
// 9. applyMergedStartersToCanonical — synthetic ProbablePitcher shape
// ---------------------------------------------------------------------------

describe("applyMergedStartersToCanonical — synthetic pitcher shape", () => {
  it("synthetic pitcher conforms to ProbablePitcher interface", () => {
    const game = makeCanonicalGame({ awayPitcher: null });
    const projected = makeProjectedGameData();
    const merged = resolveGameSources(game, projected);
    const patched = applyMergedStartersToCanonical(game, merged);

    const pitcher = patched.away.probable_pitcher;
    expect(pitcher).not.toBeNull();

    // Check all ProbablePitcher fields are present
    const keys = Object.keys(pitcher!).sort();
    expect(keys).toEqual(["handedness", "mlb_stats_api_id", "player_id", "starting_status"]);
  });

  it("only patches the side where merge winner differs from official", () => {
    // Away has official, home has none → projected fills home only
    const game = makeCanonicalGame({ homePitcher: null });
    const projected = makeProjectedGameData();
    const merged = resolveGameSources(game, projected);
    const patched = applyMergedStartersToCanonical(game, merged);

    // Away unchanged (official won)
    expect(patched.away.probable_pitcher).toBe(game.away.probable_pitcher);
    // Home patched from projected
    expect(patched.home.probable_pitcher!.player_id).toBe("sale-projected");
  });
});

// ---------------------------------------------------------------------------
// 10. Mixed scenarios
// ---------------------------------------------------------------------------

describe("resolveGameSources — mixed scenarios", () => {
  it("away: official, home: inferred — sides resolved independently", () => {
    const game = makeCanonicalGame({ homePitcher: null });
    const inferred = makeInferredGameData({ awayStarter: null });

    const merged = resolveGameSources(game, null, inferred);

    expect(merged.away.starter!.source_tier).toBe("official");
    expect(merged.away.starter!.player_id).toBe("gerrit-cole");
    expect(merged.home.starter!.source_tier).toBe("inferred");
    expect(merged.home.starter!.player_id).toBe("sale-inferred");
  });

  it("away: projected, home: none — asymmetric resolution", () => {
    const game = makeCanonicalGame({ awayPitcher: null, homePitcher: null });
    const projected = makeProjectedGameData({ homeStarter: null });

    const merged = resolveGameSources(game, projected);

    expect(merged.away.starter!.source_tier).toBe("projected");
    expect(merged.home.starter).toBeNull();
  });
});
