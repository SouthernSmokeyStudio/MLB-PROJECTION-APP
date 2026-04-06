import type {
  DraftKingsClassicJoinState,
  DraftKingsClassicSalarySlate
} from "@lib/contracts/draftkings-classic";
import type { PreparedGameInputs } from "@lib/contracts/prepared";
import type { BlockedState } from "@lib/contracts/types";
import { buildGameCard, type GameCard } from "./buildGameCard";
import {
  buildPlayerCards,
  type BuildPlayerCardOptions,
  type PlayerCard
} from "./buildPlayerCard";
import { checkProjectionReconciliation } from "./checkProjectionReconciliation";

export interface DraftKingsClassicPlayerCard extends PlayerCard {
  readonly draftkings_classic: DraftKingsClassicJoinState;
}

export interface JoinDraftKingsClassicSalariesInput {
  readonly game: GameCard;
  readonly players: readonly PlayerCard[];
  readonly salary_slate: DraftKingsClassicSalarySlate;
}

export interface DraftKingsClassicPlayerCardsResult {
  readonly draft_group_id: string;
  readonly blocked: BlockedState;
  readonly ready_players: number;
  readonly held_players: number;
  readonly players: readonly DraftKingsClassicPlayerCard[];
}

const deriveDraftKingsClassicValue = (
  projectedPoints: number,
  salary: number
): number | null => {
  if (!Number.isFinite(projectedPoints) || !Number.isFinite(salary) || salary <= 0) {
    return null;
  }

  return projectedPoints / (salary / 1000);
};

const buildHeldJoinState = (
  draftGroupId: string,
  reason: string
): DraftKingsClassicJoinState => ({
  platform: "draftkings",
  contest_type: "classic",
  draft_group_id: draftGroupId,
  draftable_id: null,
  blocked: {
    is_blocked: true,
    blocked_reason: reason
  }
});

const buildReadyJoinState = (
  draftGroupId: string,
  draftableId: string
): DraftKingsClassicJoinState => ({
  platform: "draftkings",
  contest_type: "classic",
  draft_group_id: draftGroupId,
  draftable_id: draftableId,
  blocked: {
    is_blocked: false,
    blocked_reason: null
  }
});

const toHeldPlayer = (
  player: PlayerCard,
  draftGroupId: string,
  reason: string
): DraftKingsClassicPlayerCard => ({
  ...player,
  fantasy_summary: player.fantasy_summary
    ? {
        ...player.fantasy_summary,
        salary: null,
        value: null
      }
    : null,
  draftkings_classic: buildHeldJoinState(draftGroupId, reason)
});

export const joinDraftKingsClassicSalaries = ({
  game,
  players,
  salary_slate
}: JoinDraftKingsClassicSalariesInput): DraftKingsClassicPlayerCardsResult => {
  const reconciliation = checkProjectionReconciliation({ game, players });
  const draftGroupId = salary_slate.draft_group_id;

  if (!reconciliation.passed) {
    const blockedReason =
      reconciliation.failures[0] ??
      "Projection chain failed reconciliation before DraftKings Classic salary join";
    const heldPlayers = players.map((player) =>
      toHeldPlayer(player, draftGroupId, blockedReason)
    );

    return {
      draft_group_id: draftGroupId,
      blocked: {
        is_blocked: true,
        blocked_reason: blockedReason
      },
      ready_players: 0,
      held_players: heldPlayers.length,
      players: heldPlayers
    };
  }

  const salaryByPlayerId = new Map(
    salary_slate.salaries.map((salaryEntry) => [String(salaryEntry.player_id), salaryEntry] as const)
  );

  const joinedPlayers = players.map<DraftKingsClassicPlayerCard>((player) => {
    if (player.blocked.is_blocked) {
      return toHeldPlayer(
        player,
        draftGroupId,
        player.blocked.blocked_reason ?? "Upstream player projection is blocked"
      );
    }

    if (!player.fantasy_summary) {
      return toHeldPlayer(
        player,
        draftGroupId,
        "DraftKings Classic salary join requires a fantasy projection"
      );
    }

    const matchedSalary = salaryByPlayerId.get(player.player_id);

    if (!matchedSalary) {
      return toHeldPlayer(
        player,
        draftGroupId,
        "DraftKings Classic salary missing for reconciled player row"
      );
    }

    return {
      ...player,
      fantasy_summary: {
        ...player.fantasy_summary,
        salary: matchedSalary.salary,
        value: deriveDraftKingsClassicValue(
          player.fantasy_summary.projected_points,
          matchedSalary.salary
        )
      },
      draftkings_classic: buildReadyJoinState(
        draftGroupId,
        matchedSalary.draftable_id
      )
    };
  });

  const heldPlayers = joinedPlayers.filter(
    (player) => player.draftkings_classic.blocked.is_blocked
  ).length;

  return {
    draft_group_id: draftGroupId,
    blocked: {
      is_blocked: false,
      blocked_reason: null
    },
    ready_players: joinedPlayers.length - heldPlayers,
    held_players: heldPlayers,
    players: joinedPlayers
  };
};

export const buildDraftKingsClassicPlayerCards = (
  preparedInputs: PreparedGameInputs,
  salarySlate: DraftKingsClassicSalarySlate,
  options: BuildPlayerCardOptions = {}
): DraftKingsClassicPlayerCardsResult =>
  joinDraftKingsClassicSalaries({
    game: buildGameCard(preparedInputs),
    players: buildPlayerCards(preparedInputs, options).players,
    salary_slate: salarySlate
  });
