import type {
  DraftKingsClassicJoinState,
  DraftKingsClassicSalarySlate
} from "@lib/contracts/draftkings-classic";
import type { PreparedGameInputs } from "@lib/contracts/prepared";
import type { BlockedState } from "@lib/contracts/types";
import { buildGameCard, type GameCard } from "./buildGameCard";
import { assembleGameProjection, type AssembledGameProjection } from "@lib/projections/assembleGameProjection";
import {
  buildPlayerCards,
  type BuildPlayerCardOptions,
  type PlayerCard
} from "./buildPlayerCard";
import { checkProjectionReconciliation } from "./checkProjectionReconciliation";
import type { IndexedCrosswalk } from "@lib/crosswalk/resolvePlayerIdentity";
import { resolvePlayerIdentity } from "@lib/crosswalk/resolvePlayerIdentity";
import { parseCanonicalPlayerId } from "@lib/contracts/player-crosswalk";
import type { LoadedDraftKingsClassicSlateItem } from "./loadDraftKingsClassicSlate";

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
  /** Multi-slate inventory. Takes precedence over salary_slate when provided. */
  readonly salary_slates?: readonly LoadedDraftKingsClassicSlateItem[];
  /** Single-slate backward-compat. Used only when salary_slates is absent. */
  readonly salary_slate?: DraftKingsClassicSalarySlate;
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
  salaryByPlayerId: ReadonlyMap<string, DraftKingsClassicSalarySlate["salaries"][number]>
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

  const salaryEntry = salaryByPlayerId.get(crosswalkEntry.dk_player_id);
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
  const playerName = identity?.full_name ?? player.player_id;
  const teamAbbreviation =
    identity?.team_abbreviation ?? player.team_id.toUpperCase();

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
  salary_slates: inputSlates,
  salary_slate: inputSingleSlate,
  crosswalk,
  salaryJoinIdentities
}: JoinDraftKingsClassicSalariesInput): DraftKingsClassicPlayerCardsResult => {
  const reconciliation = checkProjectionReconciliation({ game, players });

  // Normalize: prefer explicit multi-slate input; fall back to wrapping the single-slate
  const salarySlates: readonly LoadedDraftKingsClassicSlateItem[] =
    inputSlates ??
    (inputSingleSlate
      ? [{
          draft_group_id: inputSingleSlate.draft_group_id,
          label: "DraftKings Classic",
          min_start_time: "",
          max_start_time: "",
          salary_slate: inputSingleSlate
        }]
      : []);

  // Use the first slate's draft_group_id as the default for held players
  const defaultDraftGroupId =
    salarySlates.length > 0 && salarySlates[0] ? salarySlates[0].draft_group_id : "unknown";

  if (!reconciliation.passed) {
    const blockedReason =
      reconciliation.failures[0] ??
      "Projection chain failed reconciliation before DraftKings Classic salary join";
    const heldPlayers = players.map((player) =>
      toHeldPlayer(player, defaultDraftGroupId, blockedReason)
    );

    return {
      draft_group_id: defaultDraftGroupId,
      blocked: {
        is_blocked: true,
        blocked_reason: blockedReason
      },
      ready_players: 0,
      held_players: heldPlayers.length,
      players: heldPlayers
    };
  }

  // Build per-slate indices: player_id lookup + normalized name+team lookup
  interface SlateIndex {
    readonly item: LoadedDraftKingsClassicSlateItem;
    readonly salaryByPlayerId: ReadonlyMap<string, DraftKingsClassicSalarySlate["salaries"][number]>;
    readonly salaryByNormalizedNameAndTeam: ReadonlyMap<
      string,
      DraftKingsClassicSalarySlate["salaries"][number] | null
    >;
  }

  const AMBIGUOUS_SENTINEL = null;
  const slateIndices: SlateIndex[] = salarySlates.map((slateItem) => {
    const slate = slateItem.salary_slate;

    const salaryByPlayerId = new Map(
      slate.salaries.map(
        (entry) => [String(entry.player_id), entry] as const
      )
    );

    const salaryByNormalizedNameAndTeam = (() => {
      const map = new Map<string, typeof slate.salaries[number] | null>();
      for (const entry of slate.salaries) {
        const key = buildNameTeamKey(entry.display_name, entry.team_abbreviation);
        if (key === null) continue;
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

    return { item: slateItem, salaryByPlayerId, salaryByNormalizedNameAndTeam };
  });

  const toReadyPlayer = (
    player: PlayerCard,
    salary: DraftKingsClassicSalarySlate["salaries"][number],
    draftGroupId: string
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

  /**
   * Try to find a salary match for a player across ALL slates.
   * Legacy path (no crosswalk): tries mlb_stats_api_id/player_id lookup first,
   * then name+team fallback per slate.
   */
  const findSalaryInSlates = (
    player: PlayerCard
  ): { salary: DraftKingsClassicSalarySlate["salaries"][number]; draftGroupId: string } | null => {
    for (const idx of slateIndices) {
      // Primary: player_id lookup (DK salary entries use numeric MLB Stats API IDs)
      const salaryJoinKey = player.mlb_stats_api_id ?? player.player_id;
      const byId = idx.salaryByPlayerId.get(salaryJoinKey);
      if (byId) {
        return { salary: byId, draftGroupId: idx.item.draft_group_id };
      }
    }

    // Secondary: name+team fallback across all slates
    for (const idx of slateIndices) {
      const byName = matchSalaryByNameAndTeam(
        player,
        salaryJoinIdentities,
        idx.salaryByNormalizedNameAndTeam
      );
      if (byName) {
        return { salary: byName, draftGroupId: idx.item.draft_group_id };
      }
    }

    return null;
  };

  const buildMissingSalaryPlayer = (
    player: PlayerCard,
    crosswalkMissReason: "unresolved" | "no_dk_link" | null
  ): DraftKingsClassicPlayerCard => {
    // Crosswalk-specific hold reasons are fail-closed: do NOT fall through to name+team.
    if (crosswalkMissReason === "unresolved") {
      return toHeldPlayer(
        player,
        defaultDraftGroupId,
        "Crosswalk: player identity unresolved — cannot match DraftKings salary"
      );
    }

    if (crosswalkMissReason === "no_dk_link") {
      return toHeldPlayer(
        player,
        defaultDraftGroupId,
        "Crosswalk: player resolved but no dk_player_id link — cannot match DraftKings salary"
      );
    }

    // Legacy path only: try name+team fallback across all slates
    for (const idx of slateIndices) {
      const fallback = matchSalaryByNameAndTeam(
        player,
        salaryJoinIdentities,
        idx.salaryByNormalizedNameAndTeam
      );
      if (fallback) {
        return toReadyPlayer(player, fallback, idx.item.draft_group_id);
      }
    }

    return toHeldPlayer(
      player,
      defaultDraftGroupId,
      "DraftKings Classic salary missing for reconciled player row"
    );
  };

  const joinedPlayers = players.map<DraftKingsClassicPlayerCard>((player) => {
    if (player.blocked.is_blocked) {
      return toHeldPlayer(
        player,
        defaultDraftGroupId,
        player.blocked.blocked_reason ?? "Upstream player projection is blocked"
      );
    }

    if (!player.fantasy_summary) {
      return toHeldPlayer(
        player,
        defaultDraftGroupId,
        "DraftKings Classic salary join requires a fantasy projection"
      );
    }

    if (crosswalk) {
      // Crosswalk-driven path: resolve identity → use dk_player_id → match salary
      // Search across all slates for a salary match via crosswalk.
      for (const idx of slateIndices) {
        const matched = matchSalaryViaCrosswalk(player, crosswalk, idx.salaryByPlayerId);
        if (matched) {
          return toReadyPlayer(player, matched, idx.item.draft_group_id);
        }
      }

      // Not found in any slate via crosswalk — determine miss reason
      const resolution = resolvePlayerIdentity(crosswalk, {
        mlb_stats_api_id: player.mlb_stats_api_id,
        player_id: player.player_id,
        team_abbreviation: player.team_id.toUpperCase()
      });

      return buildMissingSalaryPlayer(
        player,
        resolution.canonical_player_id === null ? "unresolved" : "no_dk_link"
      );
    } else {
      // Legacy path: mlb_stats_api_id / player_id primary match across all slates,
      // then name+team fallback across all slates
      const matched = findSalaryInSlates(player);
      if (matched) {
        return toReadyPlayer(player, matched.salary, matched.draftGroupId);
      }

      return buildMissingSalaryPlayer(player, null);
    }
  });

  const heldPlayers = joinedPlayers.filter(
    (player) => player.draftkings_classic.blocked.is_blocked
  ).length;

  return {
    draft_group_id: defaultDraftGroupId,
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
  salaryInput: DraftKingsClassicSalarySlate | readonly LoadedDraftKingsClassicSlateItem[],
  options: BuildPlayerCardOptions & {
    readonly salaryJoinIdentities?: DraftKingsClassicSalaryJoinIdentities;
    /** Pre-computed game projection. When provided, skips recomputation. */
    readonly preassembled?: AssembledGameProjection;
  } = {}
): DraftKingsClassicPlayerCardsResult => {
  const isSlateArray = Array.isArray(salaryInput);
  const salary_slates: readonly LoadedDraftKingsClassicSlateItem[] = isSlateArray
    ? (salaryInput as readonly LoadedDraftKingsClassicSlateItem[])
    : [{
        draft_group_id: (salaryInput as DraftKingsClassicSalarySlate).draft_group_id,
        label: "DraftKings Classic",
        min_start_time: "",
        max_start_time: "",
        salary_slate: salaryInput as DraftKingsClassicSalarySlate
      }];

  const assembled = options.preassembled ?? assembleGameProjection(preparedInputs);
  return joinDraftKingsClassicSalaries({
    game: buildGameCard(preparedInputs, {}, assembled),
    players: buildPlayerCards(preparedInputs, { ...options, assembled }).players,
    salary_slates,
    ...(options.crosswalk ? { crosswalk: options.crosswalk } : {}),
    ...(options.salaryJoinIdentities
      ? { salaryJoinIdentities: options.salaryJoinIdentities }
      : {})
  });
};
