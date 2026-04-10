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

/**
 * Normalize a name to a lowercase alpha-only key for deterministic
 * name-based join fallback. Strips all non-letter characters so that
 * slug format ("gerrit-cole"), display format ("Gerrit Cole"), and
 * abbreviated format ("A.J. Minter" / "a-j-minter") all converge.
 *
 * Used only when the primary ID join (mlb_stats_api_id / player_id) misses.
 */
export const normalizeNameForJoin = (name: string): string =>
  name
    .normalize("NFD")                    // decompose diacritics (ñ → n + combining tilde)
    .replace(/[\u0300-\u036f]/g, "")     // strip combining marks
    .replace(/[^a-zA-Z]/g, "")           // strip everything except ASCII letters
    .toLowerCase();

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

  // Secondary name-based index for projected-tier fallback.
  // When a player comes from the projected tier (Rotowire), mlb_stats_api_id is null
  // and player_id is a slug ("gerrit-cole") that cannot match DK numeric IDs.
  // This index lets the join fall back to matching the slug against DK display_name.
  //
  // Ambiguity guard: if two or more DK entries normalize to the same name key,
  // mark that key as ambiguous (null). The fallback will not use ambiguous keys —
  // the player stays held rather than risk matching the wrong salary entry.
  const AMBIGUOUS_SENTINEL = null;
  const salaryByNormalizedName = new Map<string, typeof salary_slate.salaries[number] | null>();
  for (const entry of salary_slate.salaries) {
    const key = normalizeNameForJoin(entry.display_name);
    if (!key) {
      continue;
    }
    if (salaryByNormalizedName.has(key)) {
      salaryByNormalizedName.set(key, AMBIGUOUS_SENTINEL);
    } else {
      salaryByNormalizedName.set(key, entry);
    }
  }

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

    const salaryJoinKey = player.mlb_stats_api_id ?? player.player_id;
    const matchedSalary = salaryByPlayerId.get(salaryJoinKey)
      ?? salaryByNormalizedName.get(normalizeNameForJoin(player.player_id));

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
