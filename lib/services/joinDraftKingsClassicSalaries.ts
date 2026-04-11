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
import type { IndexedCrosswalk } from "@lib/crosswalk/resolvePlayerIdentity";
import { resolvePlayerIdentity } from "@lib/crosswalk/resolvePlayerIdentity";
import { parseCanonicalPlayerId } from "@lib/contracts/player-crosswalk";

export interface DraftKingsClassicPlayerCard extends PlayerCard {
  readonly draftkings_classic: DraftKingsClassicJoinState;
}

export interface DraftKingsClassicSalaryJoinIdentity {
  readonly full_name: string | null;
  readonly team_abbreviation: string;
}

export type DraftKingsClassicSalaryJoinIdentities = Readonly<
  Record<string, DraftKingsClassicSalaryJoinIdentity>
>;

export interface JoinDraftKingsClassicSalariesInput {
  readonly game: GameCard;
  readonly players: readonly PlayerCard[];
  readonly salary_slate: DraftKingsClassicSalarySlate;
  /** When provided, salary join uses crosswalk-driven resolution instead of legacy fallback. */
  readonly crosswalk?: IndexedCrosswalk;
  readonly salaryJoinIdentities?: DraftKingsClassicSalaryJoinIdentities;
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

const buildNameTeamKey = (name: string, teamAbbreviation: string): string | null => {
  const normalizedName = normalizeNameForJoin(name);
  const normalizedTeam = teamAbbreviation.trim().toUpperCase();

  if (normalizedName.length === 0 || normalizedTeam.length === 0) {
    return null;
  }

  return `${normalizedName}::${normalizedTeam}`;
};

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

/**
 * Match a player to a salary entry via the crosswalk resolver.
 *
 * Resolution cascade: mlb_stats_api_id → dk_player_id → rotowire_slug → name+team → null.
 * Once resolved, the crosswalk entry's dk_player_id is used to look up the salary.
 * If unresolved or the crosswalk entry has no dk_player_id link, returns null (fail closed).
 */
const matchSalaryViaCrosswalk = (
  player: PlayerCard,
  crosswalk: IndexedCrosswalk,
  salaryByDkPlayerId: ReadonlyMap<string, DraftKingsClassicSalarySlate["salaries"][number]>
): DraftKingsClassicSalarySlate["salaries"][number] | null => {
  const resolution = resolvePlayerIdentity(crosswalk, {
    mlb_stats_api_id: player.mlb_stats_api_id,
    player_id: player.player_id,
    team_abbreviation: player.team_id.toUpperCase()
  });

  if (resolution.canonical_player_id === null) {
    return null;
  }

  // Player resolved — retrieve the crosswalk entry via the canonical ID.
  // canonical_player_id = "mlb-{mlb_stats_api_id}", so parse to get the MLB ID
  // and look up in the primary index. This works for ALL resolution paths
  // (mlb_stats_api_id, dk_player_id, rotowire_slug, name+team).
  const mlbId = parseCanonicalPlayerId(resolution.canonical_player_id);
  const crosswalkEntry = mlbId !== null ? crosswalk.byMlbStatsApiId.get(mlbId) : null;

  if (!crosswalkEntry) {
    return null;
  }

  if (crosswalkEntry.dk_player_id === null) {
    return null;
  }

  const salaryEntry = salaryByDkPlayerId.get(crosswalkEntry.dk_player_id);
  return salaryEntry ?? null;
};

const matchSalaryByNameAndTeam = (
  player: PlayerCard,
  salaryJoinIdentities: DraftKingsClassicSalaryJoinIdentities | undefined,
  salaryByNormalizedNameAndTeam: ReadonlyMap<
    string,
    DraftKingsClassicSalarySlate["salaries"][number] | null
  >
): DraftKingsClassicSalarySlate["salaries"][number] | null => {
  const identity = salaryJoinIdentities?.[player.player_id];
  const playerName = identity?.full_name ?? (salaryJoinIdentities ? null : player.player_id);
  const teamAbbreviation =
    identity?.team_abbreviation ?? (salaryJoinIdentities ? null : player.team_id.toUpperCase());

  if (!playerName || !teamAbbreviation) {
    return null;
  }

  const key = buildNameTeamKey(playerName, teamAbbreviation);
  if (key === null) {
    return null;
  }

  return salaryByNormalizedNameAndTeam.get(key) ?? null;
};

export const joinDraftKingsClassicSalaries = ({
  game,
  players,
  salary_slate,
  crosswalk,
  salaryJoinIdentities
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

  // Build salary index keyed by DK player_id (used by both crosswalk and legacy paths)
  const salaryByPlayerId = new Map(
    salary_slate.salaries.map((salaryEntry) => [String(salaryEntry.player_id), salaryEntry] as const)
  );

  const AMBIGUOUS_SENTINEL = null;
  const salaryByNormalizedNameAndTeam = (() => {
    const map = new Map<string, typeof salary_slate.salaries[number] | null>();

    for (const entry of salary_slate.salaries) {
      const key = buildNameTeamKey(entry.display_name, entry.team_abbreviation);
      if (key === null) {
        continue;
      }

      if (map.has(key)) {
        const existing = map.get(key);
        // Same player_id = same player listed twice (e.g. multi-slot DK draftables).
        // Keep the existing entry. Only sentinel when player_id differs (true ambiguity).
        if (existing !== AMBIGUOUS_SENTINEL && existing?.player_id !== entry.player_id) {
          map.set(key, AMBIGUOUS_SENTINEL);
        }
      } else {
        map.set(key, entry);
      }
    }

    return map;
  })();

  const toReadyPlayer = (
    player: PlayerCard,
    salary: typeof salary_slate.salaries[number]
  ): DraftKingsClassicPlayerCard => ({
    ...player,
    fantasy_summary: {
      ...player.fantasy_summary!,
      salary: salary.salary,
      value: deriveDraftKingsClassicValue(
        player.fantasy_summary!.projected_points,
        salary.salary
      )
    },
    draftkings_classic: buildReadyJoinState(draftGroupId, salary.draftable_id)
  });

  const buildMissingSalaryPlayer = (
    player: PlayerCard,
    crosswalkMissReason: "unresolved" | "no_dk_link" | null
  ): DraftKingsClassicPlayerCard => {
    const fallbackSalary = matchSalaryByNameAndTeam(
      player,
      salaryJoinIdentities,
      salaryByNormalizedNameAndTeam
    );

    if (fallbackSalary) {
      return toReadyPlayer(player, fallbackSalary);
    }

    if (crosswalkMissReason === "unresolved") {
      return toHeldPlayer(
        player,
        draftGroupId,
        "Crosswalk: player identity unresolved — cannot match DraftKings salary"
      );
    }

    if (crosswalkMissReason === "no_dk_link") {
      return toHeldPlayer(
        player,
        draftGroupId,
        "Crosswalk: player resolved but no dk_player_id link — cannot match DraftKings salary"
      );
    }

    return toHeldPlayer(
      player,
      draftGroupId,
      "DraftKings Classic salary missing for reconciled player row"
    );
  };

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

    let matchedSalary: typeof salary_slate.salaries[number] | null | undefined;

    if (crosswalk) {
      // Crosswalk-driven path: resolve identity → use dk_player_id → match salary
      matchedSalary = matchSalaryViaCrosswalk(player, crosswalk, salaryByPlayerId);

      if (!matchedSalary) {
        const resolution = resolvePlayerIdentity(crosswalk, {
          mlb_stats_api_id: player.mlb_stats_api_id,
          player_id: player.player_id,
          team_abbreviation: player.team_id.toUpperCase()
        });

        return buildMissingSalaryPlayer(
          player,
          resolution.canonical_player_id === null ? "unresolved" : "no_dk_link"
        );
      }
    } else {
      // Legacy path: mlb_stats_api_id / player_id primary match + name fallback
      const salaryJoinKey = player.mlb_stats_api_id ?? player.player_id;
      matchedSalary = salaryByPlayerId.get(salaryJoinKey);

      if (!matchedSalary) {
        return buildMissingSalaryPlayer(player, null);
      }
    }

    return toReadyPlayer(player, matchedSalary);
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
  options: BuildPlayerCardOptions & {
    readonly salaryJoinIdentities?: DraftKingsClassicSalaryJoinIdentities;
  } = {}
): DraftKingsClassicPlayerCardsResult =>
  joinDraftKingsClassicSalaries({
    game: buildGameCard(preparedInputs),
    players: buildPlayerCards(preparedInputs, options).players,
    salary_slate: salarySlate,
    ...(options.crosswalk ? { crosswalk: options.crosswalk } : {}),
    ...(options.salaryJoinIdentities
      ? { salaryJoinIdentities: options.salaryJoinIdentities }
      : {})
  });
