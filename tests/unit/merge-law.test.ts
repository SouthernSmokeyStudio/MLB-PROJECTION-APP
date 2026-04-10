/**
 * merge-law.test.ts
 *
 * Proves the A5 merge / override contract:
 * 1. Official beats projected
 * 2. Projected beats inferred
 * 3. Inferred beats none
 * 4. Tie cases are deterministic (higher tier always wins)
 * 5. Missing/null fail-closed (no data = null output)
 * 6. No silent source blending within a slot
 * 7. Provenance metadata is accurate
 * 8. Starter and lineup slots are resolved independently
 */

import { describe, expect, it } from "vitest";
import type {
  MergeGameInput,
  MergeLineupCandidate,
  MergeSideInput,
  MergeStarterCandidate,
  SourceTier
} from "../../lib/contracts/merge-law";
import { SOURCE_TIER } from "../../lib/contracts/merge-law";
import { mergeGameSources } from "../../lib/merge/mergeGameSources";
import type { PlayerPosition } from "../../lib/contracts/types";
import { asGameId, asPlayerId, asTeamId } from "../../lib/contracts/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeStarter = (
  tier: SourceTier,
  playerId: string,
  teamId: string = "nyy"
): MergeStarterCandidate => ({
  tier,
  player_id: asPlayerId(playerId),
  team_id: asTeamId(teamId),
  handedness: "R",
  starting_status: tier === "official" ? "confirmed" : "expected"
});

const makeLineup = (
  tier: SourceTier,
  teamId: string = "nyy",
  count: number = 2
): MergeLineupCandidate => ({
  tier,
  entries: Array.from({ length: count }, (_, i) => ({
    player_id: asPlayerId(`${teamId}-${tier}-${i + 1}`),
    team_id: asTeamId(teamId),
    batting_order: i + 1,
    position: (["RF", "SS", "1B", "CF", "LF", "3B", "2B", "C", "DH"] as const)[i % 9] as PlayerPosition,
    starting_status: tier === "official" ? "confirmed" as const : "expected" as const
  }))
});

const emptySide = (): MergeSideInput => ({
  starter: { official: null, projected: null, inferred: null },
  lineup: { official: null, projected: null, inferred: null }
});

const makeGameInput = (
  away: MergeSideInput = emptySide(),
  home: MergeSideInput = emptySide()
): MergeGameInput => ({
  game_id: asGameId("mlb-2026-04-10-nyy-bos"),
  away,
  home
});

// ---------------------------------------------------------------------------
// 1. Official beats projected
// ---------------------------------------------------------------------------

describe("merge law — official beats projected", () => {
  it("official starter wins over projected starter", () => {
    const away: MergeSideInput = {
      starter: {
        official: makeStarter("official", "cole-official"),
        projected: makeStarter("projected", "cole-projected"),
        inferred: null
      },
      lineup: { official: null, projected: null, inferred: null }
    };

    const result = mergeGameSources(makeGameInput(away));
    const merged = result.away.starter;

    expect(merged).not.toBeNull();
    expect(merged!.player_id).toBe("cole-official");
    expect(merged!.source_tier).toBe("official");
    expect(merged!.merge_explanation.winner_tier).toBe("official");
    expect(merged!.merge_explanation.overridden_tiers).toEqual(["projected"]);
  });

  it("official lineup wins over projected lineup", () => {
    const away: MergeSideInput = {
      starter: { official: null, projected: null, inferred: null },
      lineup: {
        official: makeLineup("official", "nyy"),
        projected: makeLineup("projected", "nyy"),
        inferred: null
      }
    };

    const result = mergeGameSources(makeGameInput(away));
    const merged = result.away.lineup;

    expect(merged).not.toBeNull();
    expect(merged!.source_tier).toBe("official");
    expect(merged!.entries[0]!.player_id).toContain("official");
    expect(merged!.merge_explanation.overridden_tiers).toEqual(["projected"]);
  });

  it("official beats projected even when all three tiers present", () => {
    const away: MergeSideInput = {
      starter: {
        official: makeStarter("official", "cole-official"),
        projected: makeStarter("projected", "cole-projected"),
        inferred: makeStarter("inferred", "cole-inferred")
      },
      lineup: { official: null, projected: null, inferred: null }
    };

    const result = mergeGameSources(makeGameInput(away));
    const merged = result.away.starter;

    expect(merged!.source_tier).toBe("official");
    expect(merged!.merge_explanation.overridden_tiers).toEqual(["projected", "inferred"]);
    expect(merged!.merge_explanation.absent_tiers).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. Projected beats inferred
// ---------------------------------------------------------------------------

describe("merge law — projected beats inferred", () => {
  it("projected starter wins over inferred starter", () => {
    const home: MergeSideInput = {
      starter: {
        official: null,
        projected: makeStarter("projected", "sale-projected", "bos"),
        inferred: makeStarter("inferred", "sale-inferred", "bos")
      },
      lineup: { official: null, projected: null, inferred: null }
    };

    const result = mergeGameSources(makeGameInput(emptySide(), home));
    const merged = result.home.starter;

    expect(merged!.player_id).toBe("sale-projected");
    expect(merged!.source_tier).toBe("projected");
    expect(merged!.merge_explanation.overridden_tiers).toEqual(["inferred"]);
    expect(merged!.merge_explanation.absent_tiers).toEqual(["official"]);
  });

  it("projected lineup wins over inferred lineup", () => {
    const home: MergeSideInput = {
      starter: { official: null, projected: null, inferred: null },
      lineup: {
        official: null,
        projected: makeLineup("projected", "bos"),
        inferred: makeLineup("inferred", "bos")
      }
    };

    const result = mergeGameSources(makeGameInput(emptySide(), home));
    const merged = result.home.lineup;

    expect(merged!.source_tier).toBe("projected");
    expect(merged!.entries[0]!.player_id).toContain("projected");
  });
});

// ---------------------------------------------------------------------------
// 3. Inferred beats none
// ---------------------------------------------------------------------------

describe("merge law — inferred beats none", () => {
  it("inferred starter is used when official and projected are absent", () => {
    const away: MergeSideInput = {
      starter: {
        official: null,
        projected: null,
        inferred: makeStarter("inferred", "cole-inferred")
      },
      lineup: { official: null, projected: null, inferred: null }
    };

    const result = mergeGameSources(makeGameInput(away));
    const merged = result.away.starter;

    expect(merged!.player_id).toBe("cole-inferred");
    expect(merged!.source_tier).toBe("inferred");
    expect(merged!.merge_explanation.overridden_tiers).toEqual([]);
    expect(merged!.merge_explanation.absent_tiers).toEqual(["official", "projected"]);
    expect(merged!.merge_explanation.reason).toContain("only available source");
  });

  it("inferred lineup is used when official and projected are absent", () => {
    const away: MergeSideInput = {
      starter: { official: null, projected: null, inferred: null },
      lineup: {
        official: null,
        projected: null,
        inferred: makeLineup("inferred", "nyy", 3)
      }
    };

    const result = mergeGameSources(makeGameInput(away));
    const merged = result.away.lineup;

    expect(merged!.source_tier).toBe("inferred");
    expect(merged!.entries).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// 4. Deterministic — same inputs → same outputs
// ---------------------------------------------------------------------------

describe("merge law — deterministic behavior", () => {
  it("same inputs produce identical outputs every time", () => {
    const input = makeGameInput(
      {
        starter: {
          official: makeStarter("official", "cole"),
          projected: makeStarter("projected", "cole-proj"),
          inferred: null
        },
        lineup: {
          official: null,
          projected: makeLineup("projected", "nyy"),
          inferred: makeLineup("inferred", "nyy")
        }
      },
      {
        starter: {
          official: null,
          projected: null,
          inferred: makeStarter("inferred", "sale-inf", "bos")
        },
        lineup: { official: null, projected: null, inferred: null }
      }
    );

    const resultA = mergeGameSources(input);
    const resultB = mergeGameSources(input);

    expect(resultA).toEqual(resultB);
  });

  it("tier numeric order is strictly 1 < 2 < 3", () => {
    expect(SOURCE_TIER.official).toBe(1);
    expect(SOURCE_TIER.projected).toBe(2);
    expect(SOURCE_TIER.inferred).toBe(3);
    expect(SOURCE_TIER.official).toBeLessThan(SOURCE_TIER.projected);
    expect(SOURCE_TIER.projected).toBeLessThan(SOURCE_TIER.inferred);
  });
});

// ---------------------------------------------------------------------------
// 5. Missing/null fail-closed
// ---------------------------------------------------------------------------

describe("merge law — fail-closed on missing data", () => {
  it("all-null starter produces null output with none explanation", () => {
    const result = mergeGameSources(makeGameInput());

    expect(result.away.starter).toBeNull();
    expect(result.away.starter_explanation.winner_tier).toBeNull();
    expect(result.away.starter_explanation.absent_tiers).toEqual([
      "official", "projected", "inferred"
    ]);
    expect(result.away.starter_explanation.reason).toContain("No tier had data");
  });

  it("all-null lineup produces null output with none explanation", () => {
    const result = mergeGameSources(makeGameInput());

    expect(result.away.lineup).toBeNull();
    expect(result.away.lineup_explanation.winner_tier).toBeNull();
  });

  it("both sides can independently be null", () => {
    const result = mergeGameSources(makeGameInput());

    expect(result.away.starter).toBeNull();
    expect(result.away.lineup).toBeNull();
    expect(result.home.starter).toBeNull();
    expect(result.home.lineup).toBeNull();
  });

  it("one side has data, other is empty — no cross-contamination", () => {
    const away: MergeSideInput = {
      starter: {
        official: makeStarter("official", "cole"),
        projected: null,
        inferred: null
      },
      lineup: { official: null, projected: null, inferred: null }
    };

    const result = mergeGameSources(makeGameInput(away, emptySide()));

    expect(result.away.starter).not.toBeNull();
    expect(result.home.starter).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. No silent source blending
// ---------------------------------------------------------------------------

describe("merge law — no silent source blending", () => {
  it("starter and lineup can come from different tiers (independent slots)", () => {
    const away: MergeSideInput = {
      starter: {
        official: makeStarter("official", "cole"),
        projected: null,
        inferred: null
      },
      lineup: {
        official: null,
        projected: null,
        inferred: makeLineup("inferred", "nyy")
      }
    };

    const result = mergeGameSources(makeGameInput(away));

    expect(result.away.starter!.source_tier).toBe("official");
    expect(result.away.lineup!.source_tier).toBe("inferred");
  });

  it("within a lineup slot, ALL entries come from the same tier", () => {
    const away: MergeSideInput = {
      starter: { official: null, projected: null, inferred: null },
      lineup: {
        official: null,
        projected: makeLineup("projected", "nyy", 5),
        inferred: makeLineup("inferred", "nyy", 9)
      }
    };

    const result = mergeGameSources(makeGameInput(away));
    const lineup = result.away.lineup!;

    // Projected wins — all 5 entries from projected, NOT a blend of 5+9
    expect(lineup.entries).toHaveLength(5);
    expect(lineup.source_tier).toBe("projected");
    for (const entry of lineup.entries) {
      expect(entry.player_id).toContain("projected");
    }
  });

  it("winning lineup does not include any entries from lower tiers", () => {
    const away: MergeSideInput = {
      starter: { official: null, projected: null, inferred: null },
      lineup: {
        official: makeLineup("official", "nyy", 9),
        projected: makeLineup("projected", "nyy", 9),
        inferred: makeLineup("inferred", "nyy", 9)
      }
    };

    const result = mergeGameSources(makeGameInput(away));
    const lineup = result.away.lineup!;

    expect(lineup.source_tier).toBe("official");
    for (const entry of lineup.entries) {
      expect(entry.player_id).toContain("official");
      expect(entry.player_id).not.toContain("projected");
      expect(entry.player_id).not.toContain("inferred");
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Provenance metadata is accurate
// ---------------------------------------------------------------------------

describe("merge law — provenance metadata", () => {
  it("explanation lists all overridden tiers correctly", () => {
    const away: MergeSideInput = {
      starter: {
        official: makeStarter("official", "cole"),
        projected: makeStarter("projected", "cole-proj"),
        inferred: makeStarter("inferred", "cole-inf")
      },
      lineup: { official: null, projected: null, inferred: null }
    };

    const result = mergeGameSources(makeGameInput(away));
    const expl = result.away.starter_explanation;

    expect(expl.winner_tier).toBe("official");
    expect(expl.overridden_tiers).toEqual(["projected", "inferred"]);
    expect(expl.absent_tiers).toEqual([]);
  });

  it("explanation lists absent tiers correctly", () => {
    const away: MergeSideInput = {
      starter: {
        official: null,
        projected: makeStarter("projected", "cole-proj"),
        inferred: null
      },
      lineup: { official: null, projected: null, inferred: null }
    };

    const result = mergeGameSources(makeGameInput(away));
    const expl = result.away.starter_explanation;

    expect(expl.winner_tier).toBe("projected");
    expect(expl.overridden_tiers).toEqual([]);
    expect(expl.absent_tiers).toEqual(["official", "inferred"]);
  });

  it("explanation reason describes the override", () => {
    const away: MergeSideInput = {
      starter: {
        official: makeStarter("official", "cole"),
        projected: makeStarter("projected", "cole-proj"),
        inferred: null
      },
      lineup: { official: null, projected: null, inferred: null }
    };

    const result = mergeGameSources(makeGameInput(away));
    const expl = result.away.starter_explanation;

    expect(expl.reason).toContain("official");
    expect(expl.reason).toContain("overrides");
    expect(expl.reason).toContain("projected");
  });

  it("game_id is preserved in output", () => {
    const result = mergeGameSources(makeGameInput());
    expect(result.game_id).toBe("mlb-2026-04-10-nyy-bos");
  });
});

// ---------------------------------------------------------------------------
// 8. Independent slot resolution
// ---------------------------------------------------------------------------

describe("merge law — independent slot resolution per side", () => {
  it("away starter and home starter are resolved independently", () => {
    const input = makeGameInput(
      {
        starter: {
          official: makeStarter("official", "cole"),
          projected: null,
          inferred: null
        },
        lineup: { official: null, projected: null, inferred: null }
      },
      {
        starter: {
          official: null,
          projected: null,
          inferred: makeStarter("inferred", "sale-inf", "bos")
        },
        lineup: { official: null, projected: null, inferred: null }
      }
    );

    const result = mergeGameSources(input);

    expect(result.away.starter!.source_tier).toBe("official");
    expect(result.home.starter!.source_tier).toBe("inferred");
  });

  it("away lineup null does not affect home lineup resolution", () => {
    const input = makeGameInput(
      emptySide(),
      {
        starter: { official: null, projected: null, inferred: null },
        lineup: {
          official: null,
          projected: makeLineup("projected", "bos", 4),
          inferred: null
        }
      }
    );

    const result = mergeGameSources(input);

    expect(result.away.lineup).toBeNull();
    expect(result.home.lineup).not.toBeNull();
    expect(result.home.lineup!.entries).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// 9. SOURCE_TIER contract
// ---------------------------------------------------------------------------

describe("SOURCE_TIER constant", () => {
  it("contains exactly three tiers", () => {
    expect(Object.keys(SOURCE_TIER)).toHaveLength(3);
  });

  it("tiers are official, projected, inferred", () => {
    expect(SOURCE_TIER).toHaveProperty("official");
    expect(SOURCE_TIER).toHaveProperty("projected");
    expect(SOURCE_TIER).toHaveProperty("inferred");
  });
});
