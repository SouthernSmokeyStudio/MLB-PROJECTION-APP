import type {
  LiveScoreboardGame,
  LiveScoreboardPayload
} from "@lib/contracts/live-scoreboard";
import type { SmokeSignalPayload } from "@lib/contracts/smoke-signal";
import type {
  SlateSnapshotPayload,
  SlateSnapshotSectionKey,
  SlateSnapshotSectionState,
  SlateSnapshotSectionStatus,
  SlateSnapshotWrappedSection
} from "@lib/contracts/slate-snapshot";
import { parseBettingEdgeBoardPayload } from "./betting-edge-board";
import { parseDfsEdgeBoardPayload } from "./dfs-edge-board";
import { parsePlayerBoardPayload } from "./player-board";
import { parseScheduleBoardPayload } from "./schedule-board";
import { asGameId, asISOTimestamp, asTeamId, type GameStatus } from "@lib/contracts/types";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readString = (record: Record<string, unknown>, fieldName: string): string => {
  const value = record[fieldName];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Slate snapshot payload is missing ${fieldName}.`);
  }
  return value;
};

const readNumber = (record: Record<string, unknown>, fieldName: string): number => {
  const value = record[fieldName];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Slate snapshot payload has invalid ${fieldName}.`);
  }
  return value;
};

const readBoolean = (record: Record<string, unknown>, fieldName: string): boolean => {
  const value = record[fieldName];
  if (typeof value !== "boolean") {
    throw new Error(`Slate snapshot payload has invalid ${fieldName}.`);
  }
  return value;
};

const readNullableString = (
  record: Record<string, unknown>,
  fieldName: string
): string | null => {
  const value = record[fieldName];
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`Slate snapshot payload has invalid ${fieldName}.`);
  }
  return value;
};

const readNullableNumber = (
  record: Record<string, unknown>,
  fieldName: string
): number | null => {
  const value = record[fieldName];
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Slate snapshot payload has invalid ${fieldName}.`);
  }
  return value;
};

const parseSectionState = (value: unknown): SlateSnapshotSectionState => {
  switch (value) {
    case "ready":
    case "partial":
    case "blocked":
    case "empty":
      return value;
    default:
      throw new Error("Slate snapshot payload has invalid section state.");
  }
};

const parseSectionStatus = (value: unknown): SlateSnapshotSectionStatus => {
  if (!isRecord(value)) {
    throw new Error("Slate snapshot payload is missing section status.");
  }

  const reason = value.reason;
  if (reason !== null && reason !== undefined && typeof reason !== "string") {
    throw new Error("Slate snapshot payload has invalid section reason.");
  }

  return {
    state: parseSectionState(value.state),
    reason: reason ?? null
  };
};

const parseWrappedSection = <TPayload>(
  value: unknown,
  parsePayload: (payload: unknown) => TPayload
): SlateSnapshotWrappedSection<TPayload> => {
  if (!isRecord(value)) {
    throw new Error("Slate snapshot payload is missing wrapped section.");
  }

  const payload = value.payload;

  return {
    status: parseSectionStatus(value.status),
    payload: payload === null || payload === undefined ? null : parsePayload(payload)
  };
};

const parseGameStatus = (value: unknown): GameStatus => {
  switch (value) {
    case "scheduled":
    case "pregame":
    case "in_progress":
    case "delayed":
    case "suspended":
    case "final":
    case "postponed":
    case "cancelled":
    case "unknown":
      return value;
    default:
      throw new Error("Slate snapshot payload has invalid live-scoreboard status.");
  }
};

const parseBlockedState = (
  value: unknown
): LiveScoreboardGame["blocked"] => {
  if (!isRecord(value)) {
    throw new Error("Slate snapshot payload has invalid live-scoreboard blocked state.");
  }

  return {
    is_blocked: readBoolean(value, "is_blocked"),
    blocked_reason: readNullableString(value, "blocked_reason")
  };
};

const parseSmokeSignalPayload = (value: unknown): SmokeSignalPayload => {
  if (!isRecord(value)) {
    throw new Error("Slate snapshot payload has invalid smoke_signal payload.");
  }

  if (readString(value, "mode") !== "smoke-signal-v1") {
    throw new Error("Slate snapshot payload has invalid smoke_signal mode.");
  }

  if (!isRecord(value.summary)) {
    throw new Error("Slate snapshot payload is missing smoke_signal summary.");
  }

  if (!isRecord(value.overview)) {
    throw new Error("Slate snapshot payload is missing smoke_signal overview.");
  }

  const parseGameHighlight = (entry: unknown): SmokeSignalPayload["top_projected_total_game"] => {
    if (entry === null || entry === undefined) {
      return null;
    }

    if (!isRecord(entry)) {
      throw new Error("Slate snapshot payload has invalid smoke_signal game highlight.");
    }

    return {
      game_id: asGameId(readString(entry, "game_id")),
      matchup: readString(entry, "matchup"),
      scheduled_start: asISOTimestamp(readString(entry, "scheduled_start")),
      status: parseGameStatus(entry.status),
      projected_total: readNullableNumber(entry, "projected_total"),
      away_win_probability: readNullableNumber(entry, "away_win_probability"),
      home_win_probability: readNullableNumber(entry, "home_win_probability"),
      blocked: parseBlockedState(entry.blocked)
    };
  };

  const parsePlayerHighlight = (entry: unknown): SmokeSignalPayload["top_projected_player"] => {
    if (entry === null || entry === undefined) {
      return null;
    }

    if (!isRecord(entry)) {
      throw new Error("Slate snapshot payload has invalid smoke_signal player highlight.");
    }

    return {
      player_id: readString(entry, "player_id") as SmokeSignalPayload["top_projected_player"] extends infer T
        ? T extends { player_id: infer TPlayerId }
          ? TPlayerId
          : never
        : never,
      full_name: readNullableString(entry, "full_name"),
      team_abbreviation: readString(entry, "team_abbreviation"),
      position: readString(entry, "position") as SmokeSignalPayload["top_projected_player"] extends infer T
        ? T extends { position: infer TPosition }
          ? TPosition
          : never
        : never,
      game_id: asGameId(readString(entry, "game_id")),
      matchup: readString(entry, "matchup"),
      projected_points: readNullableNumber(entry, "projected_points"),
      blocked: parseBlockedState(entry.blocked)
    };
  };

  const parseDfsHighlight = (entry: unknown): SmokeSignalPayload["top_dfs_value_player"] => {
    if (entry === null || entry === undefined) {
      return null;
    }

    if (!isRecord(entry)) {
      throw new Error("Slate snapshot payload has invalid smoke_signal DFS highlight.");
    }

    const ownershipSource = entry.ownership_source;
    if (
      ownershipSource !== null &&
      ownershipSource !== undefined &&
      ownershipSource !== "placeholder" &&
      ownershipSource !== "model" &&
      ownershipSource !== "provider"
    ) {
      throw new Error("Slate snapshot payload has invalid smoke_signal ownership_source.");
    }

    return {
      player_id: readString(entry, "player_id") as SmokeSignalPayload["top_dfs_value_player"] extends infer T
        ? T extends { player_id: infer TPlayerId }
          ? TPlayerId
          : never
        : never,
      full_name: readString(entry, "full_name"),
      team_abbreviation: readString(entry, "team_abbreviation"),
      position: readString(entry, "position") as SmokeSignalPayload["top_dfs_value_player"] extends infer T
        ? T extends { position: infer TPosition }
          ? TPosition
          : never
        : never,
      projected_points: readNumber(entry, "projected_points"),
      salary: readNumber(entry, "salary"),
      value: readNumber(entry, "value"),
      draft_group_id: readNullableString(entry, "draft_group_id"),
      projected_ownership: readNullableNumber(entry, "projected_ownership"),
      ownership_source: ownershipSource ?? null
    };
  };

  const parseBettingHighlight = (entry: unknown): SmokeSignalPayload["top_betting_edge_side"] => {
    if (entry === null || entry === undefined) {
      return null;
    }

    if (!isRecord(entry)) {
      throw new Error("Slate snapshot payload has invalid smoke_signal betting highlight.");
    }

    return {
      game_id: asGameId(readString(entry, "game_id")),
      matchup: readString(entry, "matchup"),
      team_abbreviation: readString(entry, "team_abbreviation"),
      team_full_name: readString(entry, "team_full_name"),
      opponent_team_abbreviation: readString(entry, "opponent_team_abbreviation"),
      market_odds_american: readNumber(entry, "market_odds_american"),
      fair_american_odds: readNumber(entry, "fair_american_odds"),
      model_probability: readNumber(entry, "model_probability"),
      edge: readNumber(entry, "edge")
    };
  };

  const parseLivePulse = (entry: unknown): SmokeSignalPayload["live_pulse"] => {
    if (entry === null || entry === undefined) {
      return null;
    }

    if (!isRecord(entry)) {
      throw new Error("Slate snapshot payload has invalid smoke_signal live pulse.");
    }

    return {
      total_games: readNumber(entry, "total_games"),
      live_games: readNumber(entry, "live_games"),
      final_games: readNumber(entry, "final_games"),
      pregame_games: readNumber(entry, "pregame_games"),
      blocked_games: readNumber(entry, "blocked_games")
    };
  };

  return {
    source: readString(value, "source"),
    mode: "smoke-signal-v1",
    date: readString(value, "date"),
    generated_at: asISOTimestamp(readString(value, "generated_at")),
    summary: {
      total_sections_considered: readNumber(value.summary, "total_sections_considered"),
      ready_signals: readNumber(value.summary, "ready_signals"),
      blocked_signals: readNumber(value.summary, "blocked_signals")
    },
    overview: {
      total_games: readNumber(value.overview, "total_games"),
      projection_ready_games: readNumber(value.overview, "projection_ready_games"),
      player_ready_games: readNumber(value.overview, "player_ready_games"),
      live_games: readNumber(value.overview, "live_games"),
      blocked_games: readNumber(value.overview, "blocked_games")
    },
    top_projected_total_game: parseGameHighlight(value.top_projected_total_game),
    top_projected_player: parsePlayerHighlight(value.top_projected_player),
    top_dfs_value_player: parseDfsHighlight(value.top_dfs_value_player),
    top_betting_edge_side: parseBettingHighlight(value.top_betting_edge_side),
    live_pulse: parseLivePulse(value.live_pulse),
    note: readNullableString(value, "note")
  };
};

const parseInningState = (
  value: unknown
): LiveScoreboardGame["inning_state"] => {
  switch (value) {
    case "top":
    case "middle":
    case "bottom":
    case "end":
    case null:
    case undefined:
      return value ?? null;
    default:
      throw new Error("Slate snapshot payload has invalid live-scoreboard inning_state.");
  }
};

const parseLiveScoreboardPayload = (value: unknown): LiveScoreboardPayload => {
  if (!isRecord(value)) {
    throw new Error("Slate snapshot payload has invalid live_scoreboard payload.");
  }

  if (readString(value, "mode") !== "live-scoreboard-v1") {
    throw new Error("Slate snapshot payload has invalid live_scoreboard mode.");
  }

  if (!isRecord(value.summary)) {
    throw new Error("Slate snapshot payload is missing live_scoreboard summary.");
  }

  if (!Array.isArray(value.games)) {
    throw new Error("Slate snapshot payload is missing live_scoreboard games.");
  }

  return {
    source: readString(value, "source"),
    mode: "live-scoreboard-v1",
    date: readString(value, "date"),
    generated_at: asISOTimestamp(readString(value, "generated_at")),
    summary: {
      total_games: readNumber(value.summary, "total_games"),
      live_games: readNumber(value.summary, "live_games"),
      final_games: readNumber(value.summary, "final_games"),
      pregame_games: readNumber(value.summary, "pregame_games"),
      blocked_games: readNumber(value.summary, "blocked_games")
    },
    counts: parseScheduleBoardPayload({
      source: "count-probe",
      mode: "schedule-board-v1",
      date: "2000-01-01",
      generated_at: "2000-01-01T00:00:00Z",
      summary: {
        total_games: 0,
        projection_ready_games: 0,
        games_ready_for_player_projections: 0,
        blocked_games: 0,
        games_with_both_starters: 0,
        games_with_both_lineups: 0
      },
      counts: value.counts,
      games: [],
      note: null
    }).counts,
    games: value.games.map((game): LiveScoreboardGame => {
      if (!isRecord(game)) {
        throw new Error("Slate snapshot payload has invalid live_scoreboard row.");
      }

      return {
        game_id: asGameId(readString(game, "game_id")),
        matchup: readString(game, "matchup"),
        scheduled_start: asISOTimestamp(readString(game, "scheduled_start")),
        status: parseGameStatus(game.status),
        venue_name: readNullableString(game, "venue_name"),
        away_team_id: asTeamId(readString(game, "away_team_id")),
        away_team_abbreviation: readString(game, "away_team_abbreviation"),
        away_team_full_name: readString(game, "away_team_full_name"),
        home_team_id: asTeamId(readString(game, "home_team_id")),
        home_team_abbreviation: readString(game, "home_team_abbreviation"),
        home_team_full_name: readString(game, "home_team_full_name"),
        away_score: readNullableNumber(game, "away_score"),
        home_score: readNullableNumber(game, "home_score"),
        inning_number: readNullableNumber(game, "inning_number"),
        inning_state: parseInningState(game.inning_state),
        is_live: readBoolean(game, "is_live"),
        is_final: readBoolean(game, "is_final"),
        display_state: readNullableString(game, "display_state"),
        blocked: parseBlockedState(game.blocked)
      };
    }),
    note: readNullableString(value, "note")
  };
};

const parseBlockedSections = (value: unknown): readonly SlateSnapshotSectionKey[] => {
  if (!Array.isArray(value)) {
    throw new Error("Slate snapshot payload has invalid blocked_sections.");
  }

  return value.map((entry) => {
    switch (entry) {
      case "schedule":
      case "player_projections":
      case "dfs_edge":
      case "betting_edge":
      case "smoke_signal":
      case "live_scoreboard":
        return entry;
      default:
        throw new Error("Slate snapshot payload has invalid blocked section key.");
    }
  });
};

export const parseSlateSnapshotPayload = (value: unknown): SlateSnapshotPayload => {
  if (!isRecord(value)) {
    throw new Error("Slate snapshot payload must be an object.");
  }

  if (!isRecord(value.publication)) {
    throw new Error("Slate snapshot payload is missing publication.");
  }

  if (!isRecord(value.degradation)) {
    throw new Error("Slate snapshot payload is missing degradation.");
  }

  return {
    source: readString(value, "source"),
    mode: readString(value, "mode") as SlateSnapshotPayload["mode"],
    version: readNumber(value, "version") as SlateSnapshotPayload["version"],
    date: readString(value, "date"),
    generated_at: readString(value, "generated_at") as SlateSnapshotPayload["generated_at"],
    counts: parseScheduleBoardPayload({
      source: "count-probe",
      mode: "schedule-board-v1",
      date: "2000-01-01",
      generated_at: "2000-01-01T00:00:00Z",
      summary: {
        total_games: 0,
        projection_ready_games: 0,
        games_ready_for_player_projections: 0,
        blocked_games: 0,
        games_with_both_starters: 0,
        games_with_both_lineups: 0
      },
      counts: value.counts,
      games: [],
      note: null
    }).counts,
    publication: {
      is_complete: readBoolean(value.publication, "is_complete"),
      blocked_sections: parseBlockedSections(value.publication.blocked_sections)
    },
    degradation: {
      schedule: parseSectionStatus(value.degradation.schedule),
      player_projections: parseSectionStatus(value.degradation.player_projections),
      dfs_edge: parseSectionStatus(value.degradation.dfs_edge),
      betting_edge: parseSectionStatus(value.degradation.betting_edge),
      smoke_signal: parseSectionStatus(value.degradation.smoke_signal),
      live_scoreboard: parseSectionStatus(value.degradation.live_scoreboard)
    },
    schedule: parseWrappedSection(value.schedule, parseScheduleBoardPayload),
    player_projections: parseWrappedSection(value.player_projections, parsePlayerBoardPayload),
    dfs_edge: parseWrappedSection(value.dfs_edge, parseDfsEdgeBoardPayload),
    betting_edge: parseWrappedSection(value.betting_edge, parseBettingEdgeBoardPayload),
    smoke_signal: parseWrappedSection(value.smoke_signal, parseSmokeSignalPayload),
    live_scoreboard: parseWrappedSection(value.live_scoreboard, parseLiveScoreboardPayload)
  };
};

export const getSlateSnapshotBlockedSections = (
  snapshot: SlateSnapshotPayload
): readonly SlateSnapshotSectionKey[] => snapshot.publication.blocked_sections;
