import { describe, expect, it } from "vitest";
import preparedFixture from "../../data/fixtures/sample-prepared-game.json";
import invalidPreparedFixture from "../../data/fixtures/sample-prepared-game-invalid.json";
import type { PreparedGameInputs } from "../../lib/contracts/prepared";
import { buildGameCard } from "../../lib/services/buildGameCard";
import { buildPlayerCards } from "../../lib/services/buildPlayerCard";
import { buildSlateView } from "../../lib/services/buildSlateView";

const prepared = preparedFixture as unknown as PreparedGameInputs;
const invalidPrepared = invalidPreparedFixture as unknown as PreparedGameInputs;

describe("phase 9 services", () => {
  it("builds a clean game card without changing model meaning", () => {
    const card = buildGameCard(prepared);

    expect(card.game_id).toBe(prepared.game_id);
    expect(card.away_team_id).toBe(prepared.away_team.team_id);
    expect(card.home_team_id).toBe(prepared.home_team.team_id);
    expect(card.deterministic.derived_from).toBe("deterministic");
    expect(card.deterministic.projected_total).toBeGreaterThan(0);
    expect(card.simulation?.derived_from).toBe("simulation");
    expect(card.market).toBeNull();
    expect(card.evaluation).toBeNull();
    expect(card.blocked.is_blocked).toBe(false);
  });

  it("keeps blocked states visibly blocked", () => {
    const card = buildGameCard(invalidPrepared);
    const players = buildPlayerCards(invalidPrepared);

    expect(card.blocked.is_blocked).toBe(true);
    expect(card.simulation).toBeNull();
    expect(players.blocked.is_blocked).toBe(true);
  });

  it("surfaces market fields as market-derived instead of merging them into certainty", () => {
    const card = buildGameCard(prepared, {
      market: {
        moneyline: {
          away_odds: 110,
          home_odds: -110
        },
        total: {
          line: 8.5,
          over_odds: -110,
          under_odds: -110
        }
      },
      simulation: {
        seed: 17,
        iterations: 250
      }
    });

    expect(card.market?.derived_from).toBe("market");
    expect(card.market?.moneyline?.away.model_probability).toBeGreaterThanOrEqual(0);
    expect(card.market?.moneyline?.away.model_probability).toBeLessThanOrEqual(1);
    expect(card.market?.total?.over.side).toBe("over");
    expect(card.market?.total?.under.side).toBe("under");
  });

  it("builds player cards with ids, fantasy summaries, and simulation-derived fields", () => {
    const result = buildPlayerCards(prepared, {
      simulation: {
        seed: 321,
        iterations: 250
      }
    });

    expect(result.players.length).toBeGreaterThan(0);

    const first = result.players[0];
    expect(first).toBeDefined();

    if (!first) {
      throw new Error("Expected at least one player card");
    }

    expect(first.player_id).toBeTruthy();
    expect(first.team_id).toBeTruthy();
    expect(first.game_id).toBeTruthy();
    expect(first.fantasy_summary).not.toBeNull();
    expect(first.simulation_summary?.derived_from).toBe("simulation");
    expect(result.players.some((player) => player.deterministic_summary !== null)).toBe(true);
  });

  it("builds a grouped slate view with only app-surface fields", () => {
    const slate = buildSlateView([prepared], {
      simulation: {
        seed: 7,
        iterations: 100
      }
    });

    expect(slate.games).toHaveLength(1);
    expect(slate.players.length).toBeGreaterThan(0);
    expect(Object.keys(slate.players_by_game_id)).toContain(prepared.game_id);
    expect(slate.blocked.games_blocked).toBe(0);
  });
});
