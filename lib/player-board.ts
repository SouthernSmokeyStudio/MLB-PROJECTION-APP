import type {
  PlayerBoardDeterministicSummary,
  PlayerBoardPayload,
  PlayerBoardProjection,
  PlayerBoardRow
} from "@lib/contracts/player-board";
import {
  asGameId,
  asISOTimestamp,
  asPlayerId,
  asTeamId,
  type BlockedState,
  type GameStatus,
  type PlayerPosition
} from "@lib/contracts/types";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readString = (record: Record<string, unknown>, fieldName: string): string => {
  const value = record[fieldName];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Player board payload is missing ${fieldName}.`);
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
    throw new Error(`Player board payload has invalid ${fieldName}.`);
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
    throw new Error(`Player board payload has invalid ${fieldName}.`);
  }
  return value;
};

const readNumber = (record: Record<string, unknown>, fieldName: string): number => {
  const value = readNullableNumber(record, fieldName);
  if (value === null) {
    throw new Error(`Player board payload is missing ${fieldName}.`);
  }
  return value;
};

const readBoolean = (record: Record<string, unknown>, fieldName: string): boolean => {
  const value = record[fieldName];
  if (typeof value !== "boolean") {
    throw new Error(`Player board payload has invalid ${fieldName}.`);
  }
  return value;
};

const readGameStatus = (
  record: Record<string, unknown>,
  fieldName: string
): GameStatus => {
  const value = readString(record, fieldName);
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
      throw new Error(`Player board payload has invalid ${fieldName}.`);
  }
};

const readPlayerPosition = (
  record: Record<string, unknown>,
  fieldName: string
): PlayerPosition => {
  const value = readString(record, fieldName);
  switch (value) {
    case "P":
    case "C":
    case "1B":
    case "2B":
    case "3B":
    case "SS":
    case "LF":
    case "CF":
    case "RF":
    case "DH":
    case "UTIL":
    case "unknown":
      return value;
    default:
      throw new Error(`Player board payload has invalid ${fieldName}.`);
  }
};

const readBlockedState = (value: unknown): BlockedState => {
  if (!isRecord(value)) {
    throw new Error("Player board payload has invalid blocked state.");
  }

  return {
    is_blocked: readBoolean(value, "is_blocked"),
    blocked_reason: readNullableString(value, "blocked_reason")
  };
};

const parseDeterministicSummary = (
  value: unknown
): PlayerBoardDeterministicSummary => {
  if (value === null || value === undefined) {
    return null;
  }

  if (!isRecord(value)) {
    throw new Error("Player board payload has invalid deterministic_summary.");
  }

  const kind = readString(value, "kind");

  if (kind === "pitcher") {
    return {
      kind: "pitcher",
      projected_ip: readNullableNumber(value, "projected_ip"),
      projected_k: readNullableNumber(value, "projected_k"),
      projected_er: readNullableNumber(value, "projected_er"),
      projected_hits: readNullableNumber(value, "projected_hits"),
      projected_bb: readNullableNumber(value, "projected_bb")
    };
  }

  if (kind === "batter") {
    return {
      kind: "batter",
      projected_pa: readNullableNumber(value, "projected_pa"),
      projected_ab: readNullableNumber(value, "projected_ab"),
      projected_hits: readNullableNumber(value, "projected_hits"),
      projected_hr: readNullableNumber(value, "projected_hr"),
      projected_rbi: readNullableNumber(value, "projected_rbi"),
      projected_runs: readNullableNumber(value, "projected_runs"),
      projected_sb: readNullableNumber(value, "projected_sb")
    };
  }

  throw new Error("Player board payload has invalid deterministic_summary.kind.");
};

const parseFantasySummary = (
  value: unknown
): PlayerBoardProjection["fantasy_summary"] => {
  if (value === null || value === undefined) {
    return null;
  }

  if (!isRecord(value)) {
    throw new Error("Player board payload has invalid fantasy_summary.");
  }

  const platform = readString(value, "platform");
  const contestType = readString(value, "contest_type");

  if (
    (platform !== "draftkings" && platform !== "fanduel") ||
    (contestType !== "classic" && contestType !== "showdown")
  ) {
    throw new Error("Player board payload has invalid fantasy_summary shape.");
  }

  return {
    platform,
    contest_type: contestType,
    projected_points: readNumber(value, "projected_points"),
    floor: readNullableNumber(value, "floor"),
    ceiling: readNullableNumber(value, "ceiling"),
    salary: readNullableNumber(value, "salary"),
    value: readNullableNumber(value, "value")
  };
};

const parseSimulationSummary = (
  value: unknown
): PlayerBoardProjection["simulation_summary"] => {
  if (value === null || value === undefined) {
    return null;
  }

  if (!isRecord(value) || readString(value, "derived_from") !== "simulation") {
    throw new Error("Player board payload has invalid simulation_summary.");
  }

  return {
    derived_from: "simulation",
    mean_points: readNumber(value, "mean_points"),
    simulated_floor: readNumber(value, "simulated_floor"),
    simulated_ceiling: readNumber(value, "simulated_ceiling")
  };
};

const parseProjection = (value: unknown): PlayerBoardProjection => {
  if (!isRecord(value)) {
    throw new Error("Player board payload has invalid projection block.");
  }

  return {
    deterministic_summary: parseDeterministicSummary(value.deterministic_summary),
    fantasy_summary: parseFantasySummary(value.fantasy_summary),
    simulation_summary: parseSimulationSummary(value.simulation_summary),
    blocked: readBlockedState(value.blocked)
  };
};

const parseTeamSide = (value: unknown): "away" | "home" => {
  if (value === "away" || value === "home") {
    return value;
  }
  throw new Error("Player board payload has invalid team_side.");
};

const parsePlayerBoardRow = (value: unknown): PlayerBoardRow => {
  if (!isRecord(value)) {
    throw new Error("Player board payload has invalid player row.");
  }

  return {
    player_id: asPlayerId(readString(value, "player_id")),
    full_name: readNullableString(value, "full_name"),
    position: readPlayerPosition(value, "position"),
    batting_order: readNullableNumber(value, "batting_order"),
    team_side: parseTeamSide(value.team_side),
    team_id: asTeamId(readString(value, "team_id")),
    team_abbreviation: readString(value, "team_abbreviation"),
    team_full_name: readString(value, "team_full_name"),
    opponent_team_id: asTeamId(readString(value, "opponent_team_id")),
    opponent_team_abbreviation: readString(value, "opponent_team_abbreviation"),
    opponent_team_full_name: readString(value, "opponent_team_full_name"),
    game_id: asGameId(readString(value, "game_id")),
    matchup: readString(value, "matchup"),
    scheduled_start: asISOTimestamp(readString(value, "scheduled_start")),
    status: readGameStatus(value, "status"),
    venue_name: readNullableString(value, "venue_name"),
    projection: parseProjection(value.projection)
  };
};

export const parsePlayerBoardPayload = (value: unknown): PlayerBoardPayload => {
  if (!isRecord(value)) {
    throw new Error("Player board payload must be an object.");
  }

  if (readString(value, "mode") !== "player-board-v1") {
    throw new Error("Player board payload has invalid mode.");
  }

  if (!isRecord(value.summary)) {
    throw new Error("Player board payload is missing summary.");
  }

  if (!isRecord(value.counts)) {
    throw new Error("Player board payload is missing counts.");
  }

  if (!Array.isArray(value.players)) {
    throw new Error("Player board payload is missing players.");
  }

  return {
    source: readString(value, "source"),
    mode: "player-board-v1",
    date: readString(value, "date"),
    generated_at: asISOTimestamp(readString(value, "generated_at")),
    summary: {
      total_players: readNumber(value.summary, "total_players"),
      projected_players: readNumber(value.summary, "projected_players"),
      blocked_players: readNumber(value.summary, "blocked_players"),
      pitchers: readNumber(value.summary, "pitchers"),
      batters: readNumber(value.summary, "batters"),
      games_covered: readNumber(value.summary, "games_covered")
    },
    counts: {
      fetched_raw: readNumber(value.counts, "fetched_raw"),
      parsed: readNumber(value.counts, "parsed"),
      normalized: readNumber(value.counts, "normalized"),
      prepared: readNumber(value.counts, "prepared"),
      boxscore_enriched: readNumber(value.counts, "boxscore_enriched")
    },
    players: value.players.map(parsePlayerBoardRow),
    note: readNullableString(value, "note")
  };
};

export const isPitcherPlayer = (player: PlayerBoardRow): boolean =>
  player.position === "P" || player.projection.deterministic_summary?.kind === "pitcher";

export const formatPlayerProjectionStatus = (
  player: PlayerBoardRow
): string => (player.projection.blocked.is_blocked ? "Held" : "Player-ready");

export const getPlayerProjectedPoints = (player: PlayerBoardRow): number | null =>
  player.projection.fantasy_summary?.projected_points ??
  player.projection.simulation_summary?.mean_points ??
  null;

const formatMetric = (value: number | null): string =>
  value === null ? "--" : value.toFixed(1);

export const formatPlayerProjectedPoints = (player: PlayerBoardRow): string =>
  formatMetric(getPlayerProjectedPoints(player));

export const buildPlayerRoleLabel = (player: PlayerBoardRow): string => {
  if (isPitcherPlayer(player)) {
    return `${player.team_abbreviation} P`;
  }

  if (player.batting_order !== null) {
    return `${player.team_abbreviation} ${player.position} | Batting ${player.batting_order}`;
  }

  return `${player.team_abbreviation} ${player.position}`;
};

export const buildPlayerStatSummary = (player: PlayerBoardRow): string => {
  if (player.projection.blocked.is_blocked) {
    return "Held from current slate inputs.";
  }

  const deterministic = player.projection.deterministic_summary;

  if (deterministic?.kind === "pitcher") {
    return `IP ${formatMetric(deterministic.projected_ip)} | K ${formatMetric(
      deterministic.projected_k
    )} | ER ${formatMetric(deterministic.projected_er)}`;
  }

  if (deterministic?.kind === "batter") {
    return `PA ${formatMetric(deterministic.projected_pa)} | H ${formatMetric(
      deterministic.projected_hits
    )} | HR ${formatMetric(deterministic.projected_hr)} | RBI ${formatMetric(
      deterministic.projected_rbi
    )}`;
  }

  return "Projection ready from current slate inputs.";
};

export const buildPlayerDetailSummary = (player: PlayerBoardRow): string => {
  if (player.projection.blocked.is_blocked) {
    return `${player.matchup} | ${player.venue_name ?? "Venue pending"}`;
  }

  const simulation = player.projection.simulation_summary;
  if (simulation) {
    return `Mean ${simulation.mean_points.toFixed(1)} | Floor ${simulation.simulated_floor.toFixed(
      1
    )} | Ceiling ${simulation.simulated_ceiling.toFixed(1)}`;
  }

  return `${player.matchup} | ${player.venue_name ?? "Venue pending"}`;
};
