import type {
  ProjectionLineage,
  ProjectionReconciliationResult
} from "@lib/contracts/projection-lineage";
import { asGameId, type BlockedState } from "@lib/contracts/types";
import type { GameCard } from "./buildGameCard";
import type { PlayerCard } from "./buildPlayerCard";

export interface CheckProjectionReconciliationInput {
  readonly game: GameCard;
  readonly players: readonly PlayerCard[];
}

const hasSameBlockedFlag = (
  left: BlockedState,
  right: BlockedState
): boolean => left.is_blocked === right.is_blocked;

const hasMatchingVersionFields = (
  left: ProjectionLineage,
  right: ProjectionLineage
): boolean =>
  left.model_version === right.model_version &&
  left.feature_set_version === right.feature_set_version &&
  left.scoring_version === right.scoring_version &&
  left.data_version === right.data_version;

const isPitcher = (player: PlayerCard): boolean =>
  player.deterministic_summary?.kind === "pitcher";

export const checkProjectionReconciliation = ({
  game,
  players
}: CheckProjectionReconciliationInput): ProjectionReconciliationResult => {
  const { projection_lineage: gameLineage } = game;

  const gameIdMatches =
    gameLineage.game_id === game.game_id &&
    players.every(
      (player) =>
        player.game_id === game.game_id &&
        player.projection_lineage.game_id === gameLineage.game_id &&
        player.projection_lineage.game_id === player.game_id
    );

  const runIdMatches = players.every(
    (player) => player.projection_lineage.run_id === gameLineage.run_id
  );

  const projectedAtMatches = players.every(
    (player) => player.projection_lineage.projected_at === gameLineage.projected_at
  );

  const versionFieldsMatch = players.every((player) =>
    hasMatchingVersionFields(player.projection_lineage, gameLineage)
  );

  const blockedStateConsistency =
    hasSameBlockedFlag(game.blocked, gameLineage.blocked) &&
    players.every(
      (player) =>
        hasSameBlockedFlag(player.blocked, player.projection_lineage.blocked) &&
        hasSameBlockedFlag(player.blocked, game.blocked) &&
        hasSameBlockedFlag(player.projection_lineage.blocked, gameLineage.blocked)
    );

  const playerTeamMembershipValid = players.every(
    (player) =>
      player.team_id === game.away_team_id || player.team_id === game.home_team_id
  );

  const pitcherRoleShapeValid = game.blocked.is_blocked
    ? true
    : players.filter(
        (player) => player.team_id === game.away_team_id && isPitcher(player)
      ).length <= 1 &&
      players.filter(
        (player) => player.team_id === game.home_team_id && isPitcher(player)
      ).length <= 1;

  const checks = {
    game_id_match: gameIdMatches,
    run_id_match: runIdMatches,
    projected_at_match: projectedAtMatches,
    version_fields_match: versionFieldsMatch,
    blocked_state_consistency: blockedStateConsistency,
    player_team_membership_valid: playerTeamMembershipValid,
    pitcher_role_shape_valid: pitcherRoleShapeValid
  };

  const failures: string[] = [];

  if (!checks.game_id_match) {
    failures.push("Game and player outputs do not reconcile on game_id.");
  }

  if (!checks.run_id_match) {
    failures.push("Game and player outputs do not reconcile on run_id.");
  }

  if (!checks.projected_at_match) {
    failures.push("Game and player outputs do not reconcile on projected_at.");
  }

  if (!checks.version_fields_match) {
    failures.push("Game and player outputs do not reconcile on projection version fields.");
  }

  if (!checks.blocked_state_consistency) {
    failures.push("Game and player outputs do not reconcile on blocked state.");
  }

  if (!checks.player_team_membership_valid) {
    failures.push("One or more player outputs belong to a team outside the game matchup.");
  }

  if (!checks.pitcher_role_shape_valid) {
    failures.push("Player outputs exceed the supported one-pitcher-per-side shape.");
  }

  return {
    game_id: asGameId(game.game_id),
    passed: failures.length === 0,
    checks,
    failures
  };
};
