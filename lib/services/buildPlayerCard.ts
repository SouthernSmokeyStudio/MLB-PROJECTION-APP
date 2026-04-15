import type { ProjectionLineage } from "@lib/contracts/projection-lineage";
import type { PreparedGameInputs } from "@lib/contracts/prepared";
import type { BlockedState } from "@lib/contracts/types";
import { createProjectionLineage } from "@lib/contracts/projection-lineage";
import {
  assembleGameProjection,
  type AssembledGameProjection
} from "@lib/projections/assembleGameProjection";
import { projectFantasyPoints } from "@lib/scoring/projectFantasyPoints";
import { simulateFantasy } from "@lib/simulation/simulateFantasy";
import type { IndexedCrosswalk } from "@lib/crosswalk/resolvePlayerIdentity";
import { resolvePlayerIdentity } from "@lib/crosswalk/resolvePlayerIdentity";

export interface PlayerCard {
  readonly player_id: string;
  readonly canonical_player_id: string | null;
  readonly mlb_stats_api_id: string | null;
  readonly team_id: string;
  readonly game_id: string;
  readonly projection_lineage: ProjectionLineage;
  readonly deterministic_summary:
    | {
        readonly kind: "pitcher";
        readonly projected_ip: number | null;
        readonly projected_k: number | null;
        readonly projected_er: number | null;
        readonly projected_hits: number | null;
        readonly projected_bb: number | null;
      }
    | {
        readonly kind: "batter";
        readonly projected_pa: number | null;
        readonly projected_ab: number | null;
        readonly projected_hits: number | null;
        readonly projected_hr: number | null;
        readonly projected_rbi: number | null;
        readonly projected_runs: number | null;
        readonly projected_sb: number | null;
      }
    | null;
  readonly fantasy_summary:
    | {
        readonly platform: "draftkings" | "fanduel";
        readonly contest_type: "classic" | "showdown";
        readonly projected_points: number;
        readonly floor: number | null;
        readonly ceiling: number | null;
        readonly salary: number | null;
        readonly value: number | null;
      }
    | null;
  readonly simulation_summary:
    | {
        readonly derived_from: "simulation";
        readonly mean_points: number;
        readonly simulated_floor: number;
        readonly simulated_ceiling: number;
      }
    | null;
  readonly market: null;
  readonly evaluation: null;
  readonly blocked: BlockedState;
}

export interface PlayerCardsResult {
  readonly blocked: BlockedState;
  readonly players: readonly PlayerCard[];
}

export interface BuildPlayerCardOptions {
  readonly simulation?: {
    readonly seed?: number;
    readonly iterations?: number;
  };
  /** Pre-indexed crosswalk for canonical_player_id resolution. When absent, all cards get null. */
  readonly crosswalk?: IndexedCrosswalk;
  /** Caller-supplied assembled projection. When absent, assembleGameProjection is called internally. */
  readonly assembled?: AssembledGameProjection;
}

type GenericRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is GenericRecord =>
  typeof value === "object" && value !== null;

const hasPlayerIdentity = (value: unknown): value is GenericRecord =>
  isRecord(value) &&
  typeof value.player_id === "string" &&
  typeof value.team_id === "string" &&
  typeof value.game_id === "string";

const readBlockedState = (
  preparedInputs: PreparedGameInputs,
  fantasyBlocked: BlockedState | undefined
): BlockedState => fantasyBlocked ?? preparedInputs.blocked;

const toPitcherSummary = (value: GenericRecord): PlayerCard["deterministic_summary"] =>
  "projected_ip" in value
    ? {
        kind: "pitcher",
        projected_ip: (value.projected_ip as number | null | undefined) ?? null,
        projected_k: (value.projected_k as number | null | undefined) ?? null,
        projected_er: (value.projected_er as number | null | undefined) ?? null,
        projected_hits: (value.projected_hits as number | null | undefined) ?? null,
        projected_bb: (value.projected_bb as number | null | undefined) ?? null
      }
    : null;

const toBatterSummary = (value: GenericRecord): PlayerCard["deterministic_summary"] =>
  "projected_pa" in value
    ? {
        kind: "batter",
        projected_pa: (value.projected_pa as number | null | undefined) ?? null,
        projected_ab: (value.projected_ab as number | null | undefined) ?? null,
        projected_hits: (value.projected_hits as number | null | undefined) ?? null,
        projected_hr: (value.projected_hr as number | null | undefined) ?? null,
        projected_rbi: (value.projected_rbi as number | null | undefined) ?? null,
        projected_runs: (value.projected_runs as number | null | undefined) ?? null,
        projected_sb: (value.projected_sb as number | null | undefined) ?? null
      }
    : null;

const setDeterministicCandidate = (
  map: Map<string, PlayerCard>,
  candidate: unknown,
  blocked: BlockedState,
  projectionLineage: ProjectionLineage
): void => {
  if (!hasPlayerIdentity(candidate)) {
    return;
  }

  const pitcherSummary = toPitcherSummary(candidate);
  const batterSummary = toBatterSummary(candidate);
  const deterministicSummary = pitcherSummary ?? batterSummary;

  if (deterministicSummary === null) {
    return;
  }

  const playerId = candidate.player_id as string;
  const existing = map.get(playerId);

  map.set(playerId, {
    player_id: playerId,
    canonical_player_id: existing?.canonical_player_id ?? null,
    mlb_stats_api_id: existing?.mlb_stats_api_id ?? null,
    team_id: candidate.team_id as string,
    game_id: candidate.game_id as string,
    projection_lineage: projectionLineage,
    deterministic_summary: deterministicSummary,
    fantasy_summary: existing?.fantasy_summary ?? null,
    simulation_summary: existing?.simulation_summary ?? null,
    market: null,
    evaluation: null,
    blocked
  });
};

const extractDeterministicPlayers = (
  assembled: AssembledGameProjection,
  blocked: BlockedState,
  projectionLineage: ProjectionLineage
): Map<string, PlayerCard> => {
  const map = new Map<string, PlayerCard>();

  if (!isRecord(assembled)) {
    return map;
  }

  const directCandidates = [
    assembled.away_pitcher,
    assembled.home_pitcher,
    isRecord(assembled.pitcher_projections)
      ? assembled.pitcher_projections.away_pitcher
      : undefined,
    isRecord(assembled.pitcher_projections)
      ? assembled.pitcher_projections.home_pitcher
      : undefined,
    isRecord(assembled.pitchers) ? assembled.pitchers.away_pitcher : undefined,
    isRecord(assembled.pitchers) ? assembled.pitchers.home_pitcher : undefined
  ];

  directCandidates.forEach((candidate) => {
    setDeterministicCandidate(map, candidate, blocked, projectionLineage);
  });

  const arrayCandidates = [
    assembled.batter_projections,
    assembled.batters,
    assembled.player_projections,
    assembled.away_batters,
    assembled.home_batters
  ];

  arrayCandidates.forEach((candidate) => {
    if (Array.isArray(candidate)) {
      candidate.forEach((item) =>
        setDeterministicCandidate(map, item, blocked, projectionLineage)
      );
    }
  });

  return map;
};

export const buildPlayerCards = (
  preparedInputs: PreparedGameInputs,
  options: BuildPlayerCardOptions = {}
): PlayerCardsResult => {
  const assembled = options.assembled ?? assembleGameProjection(preparedInputs);
  const fantasy = projectFantasyPoints(assembled as never);
  const blocked = readBlockedState(preparedInputs, fantasy.blocked);
  const projectionLineage = createProjectionLineage({
    game_id: preparedInputs.game_id,
    prepared_at: preparedInputs.prepared_at,
    metadata: assembled.game_projection.metadata
  });
  const deterministicPlayers = extractDeterministicPlayers(
    assembled,
    blocked,
    projectionLineage
  );

  // Attach mlb_stats_api_id from prepared pitcher inputs for DFS salary join
  const pitcherMlbIds = new Map<string, string>();
  if (preparedInputs.away_starter?.mlb_stats_api_id) {
    pitcherMlbIds.set(preparedInputs.away_starter.player_id, preparedInputs.away_starter.mlb_stats_api_id);
  }
  if (preparedInputs.home_starter?.mlb_stats_api_id) {
    pitcherMlbIds.set(preparedInputs.home_starter.player_id, preparedInputs.home_starter.mlb_stats_api_id);
  }
  for (const [playerId, card] of deterministicPlayers) {
    const mlbId = pitcherMlbIds.get(playerId);
    if (mlbId) {
      deterministicPlayers.set(playerId, { ...card, mlb_stats_api_id: mlbId });
    }
  }

  const simulations = fantasy.blocked.is_blocked
    ? null
    : simulateFantasy(fantasy, options.simulation);

  fantasy.pitcher_fantasy_points.forEach((player) => {
    const existing = deterministicPlayers.get(player.player_id);

    deterministicPlayers.set(player.player_id, {
      player_id: player.player_id,
      canonical_player_id: existing?.canonical_player_id ?? null,
      mlb_stats_api_id: existing?.mlb_stats_api_id ?? null,
      team_id: player.team_id,
      game_id: player.game_id,
      projection_lineage: projectionLineage,
      deterministic_summary: existing?.deterministic_summary ?? null,
      fantasy_summary: {
        platform: player.platform,
        contest_type: player.contest_type,
        projected_points: player.projected_points,
        floor: player.floor,
        ceiling: player.ceiling,
        salary: player.salary,
        value: player.value
      },
      simulation_summary: existing?.simulation_summary ?? null,
      market: null,
      evaluation: null,
      blocked
    });
  });

  fantasy.batter_fantasy_points.forEach((player) => {
    const existing = deterministicPlayers.get(player.player_id);

    deterministicPlayers.set(player.player_id, {
      player_id: player.player_id,
      canonical_player_id: existing?.canonical_player_id ?? null,
      mlb_stats_api_id: existing?.mlb_stats_api_id ?? null,
      team_id: player.team_id,
      game_id: player.game_id,
      projection_lineage: projectionLineage,
      deterministic_summary: existing?.deterministic_summary ?? null,
      fantasy_summary: {
        platform: player.platform,
        contest_type: player.contest_type,
        projected_points: player.projected_points,
        floor: player.floor,
        ceiling: player.ceiling,
        salary: player.salary,
        value: player.value
      },
      simulation_summary: existing?.simulation_summary ?? null,
      market: null,
      evaluation: null,
      blocked
    });
  });

  simulations?.pitcher_summaries.forEach((player) => {
    const existing = deterministicPlayers.get(player.player_id);

    if (!existing) {
      return;
    }

    deterministicPlayers.set(player.player_id, {
      ...existing,
      simulation_summary: {
        derived_from: "simulation",
        mean_points: player.mean_points,
        simulated_floor: player.simulated_floor,
        simulated_ceiling: player.simulated_ceiling
      }
    });
  });

  simulations?.batter_summaries.forEach((player) => {
    const existing = deterministicPlayers.get(player.player_id);

    if (!existing) {
      return;
    }

    deterministicPlayers.set(player.player_id, {
      ...existing,
      simulation_summary: {
        derived_from: "simulation",
        mean_points: player.mean_points,
        simulated_floor: player.simulated_floor,
        simulated_ceiling: player.simulated_ceiling
      }
    });
  });

  // Resolve canonical_player_id when crosswalk is provided
  if (options.crosswalk) {
    const teamAbbreviationMap = new Map<string, string>([
      [preparedInputs.away_team.team_id, preparedInputs.away_team.team_id.toUpperCase()],
      [preparedInputs.home_team.team_id, preparedInputs.home_team.team_id.toUpperCase()]
    ]);

    for (const [playerId, card] of deterministicPlayers) {
      const resolution = resolvePlayerIdentity(options.crosswalk, {
        mlb_stats_api_id: card.mlb_stats_api_id,
        player_id: playerId,
        team_abbreviation: teamAbbreviationMap.get(card.team_id) ?? card.team_id.toUpperCase()
      });

      if (resolution.canonical_player_id !== null) {
        deterministicPlayers.set(playerId, {
          ...card,
          canonical_player_id: resolution.canonical_player_id
        });
      }
    }
  }

  return {
    blocked,
    players: [...deterministicPlayers.values()]
  };
};

export const buildPlayerCard = (
  preparedInputs: PreparedGameInputs,
  playerId: string,
  options: BuildPlayerCardOptions = {}
): PlayerCard | null =>
  buildPlayerCards(preparedInputs, options).players.find((player) => player.player_id === playerId) ?? null;
