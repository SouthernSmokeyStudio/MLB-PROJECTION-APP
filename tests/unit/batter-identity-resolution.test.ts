/**
 * Batter identity-resolution proof.
 *
 * Proves that findBoxscorePlayerNumericId resolves the correct MLB numeric ID
 * when the boxscore carries a diacritic-bearing fullName and the projected-
 * source slug is ASCII-only (the common Rotowire pattern).
 *
 * Representative traced case: Yordan Álvarez (MLB: "Yordan Álvarez", numeric
 * id 670541) vs projected-source player_id "yordan-alvarez".  Prior to the
 * NFD normalisation fix, slugifyPlayerName("Yordan Álvarez") produced
 * "yordan-lvarez" (á dropped its codepoint, leaving a bare "lvarez"), which
 * never matched the ASCII slug and caused enrichSide to skip the batter.
 */

import { describe, expect, it } from "vitest";
import {
  findBoxscorePlayerNumericId,
  slugifyPlayerName
} from "../../lib/services/loadLiveSlate";
import { asPlayerId } from "../../lib/contracts/types";

// ---------------------------------------------------------------------------
// Minimal synthetic boxscore fixture
// ---------------------------------------------------------------------------

const makeBoxscore = (
  side: "away" | "home",
  players: Array<{ id: number; fullName: string }>
): unknown => ({
  teams: {
    [side]: {
      players: Object.fromEntries(
        players.map(p => [
          `ID${p.id}`,
          { person: { id: p.id, fullName: p.fullName } }
        ])
      )
    }
  }
});

// ---------------------------------------------------------------------------
// slugifyPlayerName — diacritic normalisation
// ---------------------------------------------------------------------------

describe("slugifyPlayerName — diacritic normalisation", () => {
  it("strips accute-accent diacritics (á → a)", () => {
    expect(slugifyPlayerName("Yordan Álvarez")).toBe("yordan-alvarez");
  });

  it("strips multiple distinct diacritics in a single name", () => {
    // é, ú
    expect(slugifyPlayerName("Félix Hernández")).toBe("felix-hernandez");
  });

  it("strips tilde (ñ → n)", () => {
    expect(slugifyPlayerName("Juán Peñón")).toBe("juan-penon");
  });

  it("leaves pure-ASCII names unchanged", () => {
    expect(slugifyPlayerName("Mike Trout")).toBe("mike-trout");
    expect(slugifyPlayerName("Shohei Ohtani")).toBe("shohei-ohtani");
  });

  it("collapses punctuation/spaces to single hyphens", () => {
    expect(slugifyPlayerName("Jo-El  Rodríguez")).toBe("jo-el-rodriguez");
  });
});

// ---------------------------------------------------------------------------
// findBoxscorePlayerNumericId — accented-name round-trip
// ---------------------------------------------------------------------------

describe("findBoxscorePlayerNumericId — accented-name round-trip", () => {
  it("resolves numeric id when boxscore fullName has diacritics and playerId is ASCII slug", () => {
    const boxscore = makeBoxscore("away", [
      { id: 670541, fullName: "Yordan Álvarez" }
    ]);

    const result = findBoxscorePlayerNumericId(
      boxscore,
      "away",
      asPlayerId("yordan-alvarez")
    );

    expect(result).toBe(670541);
  });

  it("resolves numeric id by direct numeric-string match regardless of diacritics", () => {
    const boxscore = makeBoxscore("home", [
      { id: 670541, fullName: "Yordan Álvarez" }
    ]);

    // When playerId is the numeric string representation, slug-match is irrelevant.
    const result = findBoxscorePlayerNumericId(
      boxscore,
      "home",
      asPlayerId("670541")
    );

    expect(result).toBe(670541);
  });

  it("returns null when no player in the boxscore matches the slug", () => {
    const boxscore = makeBoxscore("away", [
      { id: 670541, fullName: "Yordan Álvarez" }
    ]);

    const result = findBoxscorePlayerNumericId(
      boxscore,
      "away",
      asPlayerId("juan-soto")
    );

    expect(result).toBeNull();
  });

  it("returns null when playerId is null", () => {
    const boxscore = makeBoxscore("away", [
      { id: 670541, fullName: "Yordan Álvarez" }
    ]);

    const result = findBoxscorePlayerNumericId(boxscore, "away", null);

    expect(result).toBeNull();
  });

  it("returns null when the requested side has no players", () => {
    const boxscore = makeBoxscore("away", [
      { id: 670541, fullName: "Yordan Álvarez" }
    ]);

    // Requesting "home" side when only "away" is populated.
    const result = findBoxscorePlayerNumericId(
      boxscore,
      "home",
      asPlayerId("yordan-alvarez")
    );

    expect(result).toBeNull();
  });

  it("resolves correctly when multiple players are present", () => {
    const boxscore = makeBoxscore("away", [
      { id: 670541, fullName: "Yordan Álvarez" },
      { id: 666182, fullName: "José Abreu" },
      { id: 514888, fullName: "Mike Trout" }
    ]);

    expect(
      findBoxscorePlayerNumericId(boxscore, "away", asPlayerId("jose-abreu"))
    ).toBe(666182);

    expect(
      findBoxscorePlayerNumericId(boxscore, "away", asPlayerId("mike-trout"))
    ).toBe(514888);

    expect(
      findBoxscorePlayerNumericId(boxscore, "away", asPlayerId("yordan-alvarez"))
    ).toBe(670541);
  });
});
