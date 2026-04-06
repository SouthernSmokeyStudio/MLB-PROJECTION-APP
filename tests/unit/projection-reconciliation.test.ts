import { describe, expect, it } from "vitest";
import preparedFixture from "../../data/fixtures/sample-prepared-game.json";
import invalidPreparedFixture from "../../data/fixtures/sample-prepared-game-invalid.json";
import type { PreparedGameInputs } from "../../lib/contracts/prepared";
import { buildGameCard } from "../../lib/services/buildGameCard";
import { buildPlayerCards } from "../../lib/services/buildPlayerCard";
import { checkProjectionReconciliation } from "../../lib/services/checkProjectionReconciliation";

const prepared = preparedFixture as unknown as PreparedGameInputs;
const invalidPrepared = invalidPreparedFixture as unknown as PreparedGameInputs;

describe("projection reconciliation", () => {
  it("shares upstream lineage across game and player outputs from the same prepared input", () => {
    const game = buildGameCard(prepared);
    const players = buildPlayerCards(prepared).players;

    expect(players.length).toBeGreaterThan(0);

    for (const player of players) {
      expect(player.projection_lineage.game_id).toBe(game.projection_lineage.game_id);
      expect(player.projection_lineage.run_id).toBe(game.projection_lineage.run_id);
      expect(player.projection_lineage.projected_at).toBe(game.projection_lineage.projected_at);
      expect(player.projection_lineage.model_version).toBe(
        game.projection_lineage.model_version
      );
      expect(player.projection_lineage.feature_set_version).toBe(
        game.projection_lineage.feature_set_version
      );
      expect(player.projection_lineage.scoring_version).toBe(
        game.projection_lineage.scoring_version
      );
      expect(player.projection_lineage.data_version).toBe(
        game.projection_lineage.data_version
      );
    }

    const result = checkProjectionReconciliation({ game, players });

    expect(result.passed).toBe(true);
    expect(result.checks.game_id_match).toBe(true);
    expect(result.checks.run_id_match).toBe(true);
    expect(result.checks.projected_at_match).toBe(true);
    expect(result.checks.version_fields_match).toBe(true);
  });

  it("propagates blocked state from the game layer into player outputs", () => {
    const game = buildGameCard(invalidPrepared);
    const playerResult = buildPlayerCards(invalidPrepared);
    const result = checkProjectionReconciliation({
      game,
      players: playerResult.players
    });

    expect(game.blocked.is_blocked).toBe(true);
    expect(game.projection_lineage.blocked.is_blocked).toBe(true);
    expect(playerResult.blocked.is_blocked).toBe(true);
    expect(
      playerResult.players.every(
        (player) =>
          player.blocked.is_blocked && player.projection_lineage.blocked.is_blocked
      )
    ).toBe(true);
    expect(result.passed).toBe(true);
    expect(result.checks.blocked_state_consistency).toBe(true);
  });

  it("fails reconciliation when a player belongs to a third team", () => {
    const game = buildGameCard(prepared);
    const players = buildPlayerCards(prepared).players;
    const firstPlayer = players[0];

    expect(firstPlayer).toBeDefined();

    if (!firstPlayer) {
      throw new Error("Expected at least one player for reconciliation test");
    }

    const result = checkProjectionReconciliation({
      game,
      players: [{ ...firstPlayer, team_id: "lad" }, ...players.slice(1)]
    });

    expect(result.passed).toBe(false);
    expect(result.checks.player_team_membership_valid).toBe(false);
    expect(result.failures).toContain(
      "One or more player outputs belong to a team outside the game matchup."
    );
  });

  it("fails reconciliation when an unblocked game has more than one pitcher on a side", () => {
    const game = buildGameCard(prepared);
    const players = buildPlayerCards(prepared).players;
    const awayPitcher = players.find(
      (player) =>
        player.team_id === game.away_team_id &&
        player.deterministic_summary?.kind === "pitcher"
    );

    expect(awayPitcher).toBeDefined();

    if (!awayPitcher) {
      throw new Error("Expected an away pitcher for reconciliation test");
    }

    const result = checkProjectionReconciliation({
      game,
      players: [
        ...players,
        {
          ...awayPitcher,
          player_id: `${awayPitcher.player_id}-duplicate`
        }
      ]
    });

    expect(result.passed).toBe(false);
    expect(result.checks.pitcher_role_shape_valid).toBe(false);
    expect(result.failures).toContain(
      "Player outputs exceed the supported one-pitcher-per-side shape."
    );
  });
});
