import type {
  DfsEdgeBoardCounts,
  DfsEdgeBoardPayload,
  DfsEdgeBoardPlayerHighlight,
  DfsEdgeBoardRow
} from "@lib/contracts/dfs-edge-board";
import type { DraftKingsClassicSalarySlate } from "@lib/contracts/draftkings-classic";
import {
  asGameId,
  asISOTimestamp,
  asPlayerId,
  asTeamId,
  type PlayerPosition
} from "@lib/contracts/types";
import {
  buildDraftKingsClassicPlayerCards,
  type DraftKingsClassicPlayerCard
} from "./joinDraftKingsClassicSalaries";
import { buildDfsOwnershipPlaceholder } from "./buildDfsOwnershipPlaceholder";
import type { LiveSlateCounts, LiveSlateSourceGame } from "./loadLiveSlate";
import type { IndexedCrosswalk } from "@lib/crosswalk/resolvePlayerIdentity";

export interface BuildDfsEdgeBoardOptions {
  readonly source: string;
  readonly date: string;
  readonly generated_at?: string;
  readonly counts: LiveSlateCounts;
  readonly note?: string | null;
  readonly draftkings_classic: {
    readonly draft_group_id: string;
    readonly label: string;
    readonly min_start_time: string;
    readonly max_start_time: string;
    readonly tags: readonly string[];
  };
  readonly salary_slate: DraftKingsClassicSalarySlate;
  readonly simulation?: {
    readonly seed?: number;
    readonly iterations?: number;
  };
  /** Pre-indexed crosswalk. When omitted, loaded from the committed crosswalk file. */
  readonly crosswalk?: IndexedCrosswalk;
}

const buildMatchupLabel = (sourceGame: LiveSlateSourceGame): string =>
  `${sourceGame.canonicalGame.away.team.full_name} at ${sourceGame.canonicalGame.home.team.full_name}`;

const buildFallbackPosition = (player: DraftKingsClassicPlayerCard): PlayerPosition =>
  player.deterministic_summary?.kind === "pitcher" ? "P" : "unknown";

const isPitcherRow = (player: DfsEdgeBoardRow): boolean =>
  player.position === "P" || player.projection.deterministic_summary?.kind === "pitcher";

const isReadyRow = (player: DfsEdgeBoardRow): boolean =>
  !player.draftkings_classic.blocked.is_blocked;

const compareNullableNumbersDesc = (left: number | null, right: number | null): number => {
  if (left === right) {
    return 0;
  }

  if (left === null) {
    return 1;
  }

  if (right === null) {
    return -1;
  }

  return right - left;
};

const compareNullableNumbersAsc = (left: number | null, right: number | null): number => {
  if (left === right) {
    return 0;
  }

  if (left === null) {
    return 1;
  }

  if (right === null) {
    return -1;
  }

  return left - right;
};

const sortReadyPitchers = (left: DfsEdgeBoardRow, right: DfsEdgeBoardRow): number => {
  const valueComparison = compareNullableNumbersDesc(
    left.draftkings_classic.value,
    right.draftkings_classic.value
  );
  if (valueComparison !== 0) {
    return valueComparison;
  }

  const projectedComparison = compareNullableNumbersDesc(
    left.projection.fantasy_summary?.projected_points ?? null,
    right.projection.fantasy_summary?.projected_points ?? null
  );
  if (projectedComparison !== 0) {
    return projectedComparison;
  }

  return (left.full_name ?? left.player_id).localeCompare(right.full_name ?? right.player_id);
};

const sortReadyBatters = (left: DfsEdgeBoardRow, right: DfsEdgeBoardRow): number => {
  const valueComparison = compareNullableNumbersDesc(
    left.draftkings_classic.value,
    right.draftkings_classic.value
  );
  if (valueComparison !== 0) {
    return valueComparison;
  }

  const battingOrderComparison = compareNullableNumbersAsc(
    left.batting_order,
    right.batting_order
  );
  if (battingOrderComparison !== 0) {
    return battingOrderComparison;
  }

  const projectedComparison = compareNullableNumbersDesc(
    left.projection.fantasy_summary?.projected_points ?? null,
    right.projection.fantasy_summary?.projected_points ?? null
  );
  if (projectedComparison !== 0) {
    return projectedComparison;
  }

  return (left.full_name ?? left.player_id).localeCompare(right.full_name ?? right.player_id);
};

const sortHeldPlayers = (left: DfsEdgeBoardRow, right: DfsEdgeBoardRow): number => {
  const startComparison = left.scheduled_start.localeCompare(right.scheduled_start);
  if (startComparison !== 0) {
    return startComparison;
  }

  if (isPitcherRow(left) !== isPitcherRow(right)) {
    return isPitcherRow(left) ? -1 : 1;
  }

  return (left.full_name ?? left.player_id).localeCompare(right.full_name ?? right.player_id);
};

const buildHighlight = (player: DfsEdgeBoardRow): DfsEdgeBoardPlayerHighlight | null => {
  const projectedPoints = player.projection.fantasy_summary?.projected_points ?? null;
  const salary = player.draftkings_classic.salary;
  const value = player.draftkings_classic.value;

  if (projectedPoints === null || salary === null || value === null) {
    return null;
  }

  return {
    player_id: asPlayerId(player.player_id),
    full_name: player.full_name ?? player.player_id,
    team_abbreviation: player.team_abbreviation,
    position: player.position,
    projected_points: projectedPoints,
    salary,
    value
  };
};

const toDfsEdgeBoardRow = (
  sourceGame: LiveSlateSourceGame,
  player: DraftKingsClassicPlayerCard
): DfsEdgeBoardRow | null => {
  const isAwayPlayer = player.team_id === sourceGame.canonicalGame.away.team.team_id;
  const isHomePlayer = player.team_id === sourceGame.canonicalGame.home.team.team_id;

  if (!isAwayPlayer && !isHomePlayer) {
    return null;
  }

  const team = isAwayPlayer
    ? sourceGame.canonicalGame.away.team
    : sourceGame.canonicalGame.home.team;
  const opponent = isAwayPlayer
    ? sourceGame.canonicalGame.home.team
    : sourceGame.canonicalGame.away.team;
  const identity = sourceGame.playerIdentities[player.player_id];
  const placeholderOwnership = buildDfsOwnershipPlaceholder({
    position: identity?.position ?? buildFallbackPosition(player),
    batting_order: identity?.batting_order ?? null,
    projected_points: player.fantasy_summary?.projected_points ?? null,
    salary: player.fantasy_summary?.salary ?? null,
    is_blocked: player.draftkings_classic.blocked.is_blocked
  });

  return {
    player_id: asPlayerId(player.player_id),
    full_name: identity?.full_name ?? null,
    position: identity?.position ?? buildFallbackPosition(player),
    batting_order: identity?.batting_order ?? null,
    team_side: isAwayPlayer ? "away" : "home",
    team_id: asTeamId(player.team_id),
    team_abbreviation: team.abbreviation,
    team_full_name: team.full_name,
    opponent_team_id: asTeamId(opponent.team_id),
    opponent_team_abbreviation: opponent.abbreviation,
    opponent_team_full_name: opponent.full_name,
    game_id: asGameId(player.game_id),
    matchup: buildMatchupLabel(sourceGame),
    scheduled_start: sourceGame.canonicalGame.scheduled_start,
    status: sourceGame.canonicalGame.status,
    venue_name: sourceGame.canonicalGame.venue?.name ?? null,
    projection: {
      deterministic_summary: player.deterministic_summary,
      fantasy_summary: player.fantasy_summary,
      simulation_summary: player.simulation_summary,
      blocked: player.blocked
    },
    draftkings_classic: {
      platform: player.draftkings_classic.platform,
      contest_type: player.draftkings_classic.contest_type,
      draft_group_id: player.draftkings_classic.draft_group_id,
      draftable_id: player.draftkings_classic.draftable_id,
      salary: player.fantasy_summary?.salary ?? null,
      value: player.fantasy_summary?.value ?? null,
      projected_ownership: placeholderOwnership.projected_ownership,
      ownership_source: placeholderOwnership.ownership_source,
      blocked: player.draftkings_classic.blocked
    }
  };
};

const buildRows = (
  sourceGames: readonly LiveSlateSourceGame[],
  options: BuildDfsEdgeBoardOptions
): readonly DfsEdgeBoardRow[] =>
  sourceGames.flatMap((sourceGame) => {
    const joinedPlayers = buildDraftKingsClassicPlayerCards(
      sourceGame.preparedGame,
      options.salary_slate,
      {
        ...(options.simulation ? { simulation: options.simulation } : {}),
        ...(options.crosswalk ? { crosswalk: options.crosswalk } : {})
      }
    ).players;

    return joinedPlayers
      .map((player) => toDfsEdgeBoardRow(sourceGame, player))
      .filter((player): player is DfsEdgeBoardRow => player !== null);
  });

const createEmptySummary = () => ({
  total_players: 0,
  ready_players: 0,
  held_players: 0,
  ready_pitchers: 0,
  ready_batters: 0,
  games_covered: 0,
  average_ready_salary: null,
  average_ready_value: null,
  top_value_player: null
});

export const createEmptyDfsEdgeBoard = ({
  source,
  date,
  generated_at,
  counts,
  note,
  draftkings_classic
}: {
  readonly source: string;
  readonly date: string;
  readonly generated_at?: string;
  readonly counts: DfsEdgeBoardCounts;
  readonly note: string | null;
  readonly draftkings_classic: DfsEdgeBoardPayload["draftkings_classic"];
}): DfsEdgeBoardPayload => ({
  source,
  mode: "dfs-edge-board-v1",
  date,
  generated_at: asISOTimestamp(generated_at ?? new Date().toISOString()),
  draftkings_classic,
  summary: createEmptySummary(),
  counts,
  ready_pitchers: [],
  ready_batters: [],
  held_players: [],
  note
});

export const buildDfsEdgeBoard = (
  sourceGames: readonly LiveSlateSourceGame[],
  options: BuildDfsEdgeBoardOptions
): DfsEdgeBoardPayload => {
  const players = buildRows(sourceGames, options);
  const readyPlayers = players.filter(isReadyRow);
  const readyPitchers = [...readyPlayers.filter(isPitcherRow)].sort(sortReadyPitchers);
  const readyBatters = [...readyPlayers.filter((player) => !isPitcherRow(player))].sort(
    sortReadyBatters
  );
  const heldPlayers = [...players.filter((player) => !isReadyRow(player))].sort(sortHeldPlayers);
  const gamesCovered = new Set(players.map((player) => player.game_id)).size;
  const matchedSalaries = readyPlayers.filter(
    (player) => player.draftkings_classic.salary !== null
  ).length;
  const totalReadySalary = readyPlayers.reduce(
    (sum, player) => sum + (player.draftkings_classic.salary ?? 0),
    0
  );
  const totalReadyValue = readyPlayers.reduce(
    (sum, player) => sum + (player.draftkings_classic.value ?? 0),
    0
  );
  const topValuePlayer = [...readyPlayers]
    .filter((player) => player.draftkings_classic.value !== null)
    .sort((left, right) =>
      compareNullableNumbersDesc(left.draftkings_classic.value, right.draftkings_classic.value)
    )[0] ?? null;

  return {
    source: options.source,
    mode: "dfs-edge-board-v1",
    date: options.date,
    generated_at: asISOTimestamp(options.generated_at ?? new Date().toISOString()),
    draftkings_classic: {
      platform: "draftkings",
      contest_type: "classic",
      draft_group_id: options.draftkings_classic.draft_group_id,
      label: options.draftkings_classic.label,
      min_start_time: asISOTimestamp(options.draftkings_classic.min_start_time),
      max_start_time: asISOTimestamp(options.draftkings_classic.max_start_time),
      tags: options.draftkings_classic.tags
    },
    summary: {
      total_players: players.length,
      ready_players: readyPlayers.length,
      held_players: heldPlayers.length,
      ready_pitchers: readyPitchers.length,
      ready_batters: readyBatters.length,
      games_covered: gamesCovered,
      average_ready_salary:
        readyPlayers.length === 0 ? null : totalReadySalary / readyPlayers.length,
      average_ready_value:
        readyPlayers.length === 0 ? null : totalReadyValue / readyPlayers.length,
      top_value_player: topValuePlayer ? buildHighlight(topValuePlayer) : null
    },
    counts: {
      ...options.counts,
      salary_entries: options.salary_slate.salaries.length,
      matched_salaries: matchedSalaries
    },
    ready_pitchers: readyPitchers,
    ready_batters: readyBatters,
    held_players: heldPlayers,
    note: options.note ?? null
  };
};
