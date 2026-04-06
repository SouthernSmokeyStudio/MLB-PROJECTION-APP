import type {
  DfsEdgeBoardCounts,
  DfsEdgeBoardPayload,
  DfsEdgeBoardRow
} from "@lib/contracts/dfs-edge-board";
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
    throw new Error(`DFS edge payload is missing ${fieldName}.`);
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
    throw new Error(`DFS edge payload has invalid ${fieldName}.`);
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
    throw new Error(`DFS edge payload has invalid ${fieldName}.`);
  }
  return value;
};

const readNumber = (record: Record<string, unknown>, fieldName: string): number => {
  const value = readNullableNumber(record, fieldName);
  if (value === null) {
    throw new Error(`DFS edge payload is missing ${fieldName}.`);
  }
  return value;
};

const readBoolean = (record: Record<string, unknown>, fieldName: string): boolean => {
  const value = record[fieldName];
  if (typeof value !== "boolean") {
    throw new Error(`DFS edge payload has invalid ${fieldName}.`);
  }
  return value;
};

const readBlockedState = (value: unknown): BlockedState => {
  if (!isRecord(value)) {
    throw new Error("DFS edge payload has invalid blocked state.");
  }

  return {
    is_blocked: readBoolean(value, "is_blocked"),
    blocked_reason: readNullableString(value, "blocked_reason")
  };
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
      throw new Error(`DFS edge payload has invalid ${fieldName}.`);
  }
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
      throw new Error(`DFS edge payload has invalid ${fieldName}.`);
  }
};

const parseDeterministicSummary = (
  value: unknown
): DfsEdgeBoardRow["projection"]["deterministic_summary"] => {
  if (value === null || value === undefined) {
    return null;
  }

  if (!isRecord(value)) {
    throw new Error("DFS edge payload has invalid deterministic_summary.");
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

  throw new Error("DFS edge payload has invalid deterministic_summary.kind.");
};

const parseFantasySummary = (
  value: unknown
): DfsEdgeBoardRow["projection"]["fantasy_summary"] => {
  if (value === null || value === undefined) {
    return null;
  }

  if (!isRecord(value)) {
    throw new Error("DFS edge payload has invalid fantasy_summary.");
  }

  const platform = readString(value, "platform");
  const contestType = readString(value, "contest_type");

  if (platform !== "draftkings" || contestType !== "classic") {
    throw new Error("DFS edge payload has invalid fantasy_summary shape.");
  }

  return {
    platform: "draftkings",
    contest_type: "classic",
    projected_points: readNumber(value, "projected_points"),
    floor: readNullableNumber(value, "floor"),
    ceiling: readNullableNumber(value, "ceiling"),
    salary: readNullableNumber(value, "salary"),
    value: readNullableNumber(value, "value")
  };
};

const parseSimulationSummary = (
  value: unknown
): DfsEdgeBoardRow["projection"]["simulation_summary"] => {
  if (value === null || value === undefined) {
    return null;
  }

  if (!isRecord(value) || readString(value, "derived_from") !== "simulation") {
    throw new Error("DFS edge payload has invalid simulation_summary.");
  }

  return {
    derived_from: "simulation",
    mean_points: readNumber(value, "mean_points"),
    simulated_floor: readNumber(value, "simulated_floor"),
    simulated_ceiling: readNumber(value, "simulated_ceiling")
  };
};

const parseProjection = (value: unknown): DfsEdgeBoardRow["projection"] => {
  if (!isRecord(value)) {
    throw new Error("DFS edge payload has invalid projection block.");
  }

  return {
    deterministic_summary: parseDeterministicSummary(value.deterministic_summary),
    fantasy_summary: parseFantasySummary(value.fantasy_summary),
    simulation_summary: parseSimulationSummary(value.simulation_summary),
    blocked: readBlockedState(value.blocked)
  };
};

const parseDraftKingsClassicState = (
  value: unknown
): DfsEdgeBoardRow["draftkings_classic"] => {
  if (!isRecord(value)) {
    throw new Error("DFS edge payload has invalid DraftKings Classic block.");
  }

  if (
    readString(value, "platform") !== "draftkings" ||
    readString(value, "contest_type") !== "classic"
  ) {
    throw new Error("DFS edge payload has invalid DraftKings Classic identifiers.");
  }

  return {
    platform: "draftkings",
    contest_type: "classic",
    draft_group_id: readString(value, "draft_group_id"),
    draftable_id: readNullableString(value, "draftable_id"),
    salary: readNullableNumber(value, "salary"),
    value: readNullableNumber(value, "value"),
    blocked: readBlockedState(value.blocked)
  };
};

const parseTeamSide = (value: unknown): "away" | "home" => {
  if (value === "away" || value === "home") {
    return value;
  }
  throw new Error("DFS edge payload has invalid team_side.");
};

const parseRow = (value: unknown): DfsEdgeBoardRow => {
  if (!isRecord(value)) {
    throw new Error("DFS edge payload has invalid row.");
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
    projection: parseProjection(value.projection),
    draftkings_classic: parseDraftKingsClassicState(value.draftkings_classic)
  };
};

const parseCounts = (value: unknown): DfsEdgeBoardCounts => {
  if (!isRecord(value)) {
    throw new Error("DFS edge payload is missing counts.");
  }

  return {
    fetched_raw: readNumber(value, "fetched_raw"),
    parsed: readNumber(value, "parsed"),
    normalized: readNumber(value, "normalized"),
    prepared: readNumber(value, "prepared"),
    boxscore_enriched: readNumber(value, "boxscore_enriched"),
    salary_entries: readNumber(value, "salary_entries"),
    matched_salaries: readNumber(value, "matched_salaries")
  };
};

const parseDraftKingsSummary = (
  value: unknown
): DfsEdgeBoardPayload["draftkings_classic"] => {
  if (value === null || value === undefined) {
    return null;
  }

  if (!isRecord(value)) {
    throw new Error("DFS edge payload has invalid DraftKings summary.");
  }

  if (
    readString(value, "platform") !== "draftkings" ||
    readString(value, "contest_type") !== "classic"
  ) {
    throw new Error("DFS edge payload has invalid DraftKings summary identifiers.");
  }

  const tags = Array.isArray(value.tags)
    ? value.tags.filter((tag): tag is string => typeof tag === "string")
    : [];

  return {
    platform: "draftkings",
    contest_type: "classic",
    draft_group_id: readString(value, "draft_group_id"),
    label: readString(value, "label"),
    min_start_time: asISOTimestamp(readString(value, "min_start_time")),
    max_start_time: asISOTimestamp(readString(value, "max_start_time")),
    tags
  };
};

export const parseDfsEdgeBoardPayload = (value: unknown): DfsEdgeBoardPayload => {
  if (!isRecord(value)) {
    throw new Error("DFS edge payload must be an object.");
  }

  if (readString(value, "mode") !== "dfs-edge-board-v1") {
    throw new Error("DFS edge payload has invalid mode.");
  }

  if (!isRecord(value.summary)) {
    throw new Error("DFS edge payload is missing summary.");
  }

  if (!Array.isArray(value.ready_pitchers) || !Array.isArray(value.ready_batters) || !Array.isArray(value.held_players)) {
    throw new Error("DFS edge payload is missing player groups.");
  }

  return {
    source: readString(value, "source"),
    mode: "dfs-edge-board-v1",
    date: readString(value, "date"),
    generated_at: asISOTimestamp(readString(value, "generated_at")),
    draftkings_classic: parseDraftKingsSummary(value.draftkings_classic),
    summary: {
      total_players: readNumber(value.summary, "total_players"),
      ready_players: readNumber(value.summary, "ready_players"),
      held_players: readNumber(value.summary, "held_players"),
      ready_pitchers: readNumber(value.summary, "ready_pitchers"),
      ready_batters: readNumber(value.summary, "ready_batters"),
      games_covered: readNumber(value.summary, "games_covered"),
      average_ready_salary: readNullableNumber(value.summary, "average_ready_salary"),
      average_ready_value: readNullableNumber(value.summary, "average_ready_value"),
      top_value_player: isRecord(value.summary.top_value_player)
        ? {
            player_id: asPlayerId(readString(value.summary.top_value_player, "player_id")),
            full_name: readString(value.summary.top_value_player, "full_name"),
            team_abbreviation: readString(value.summary.top_value_player, "team_abbreviation"),
            position: readPlayerPosition(value.summary.top_value_player, "position"),
            projected_points: readNumber(value.summary.top_value_player, "projected_points"),
            salary: readNumber(value.summary.top_value_player, "salary"),
            value: readNumber(value.summary.top_value_player, "value")
          }
        : null
    },
    counts: parseCounts(value.counts),
    ready_pitchers: value.ready_pitchers.map(parseRow),
    ready_batters: value.ready_batters.map(parseRow),
    held_players: value.held_players.map(parseRow),
    note: readNullableString(value, "note")
  };
};

export const formatDfsEdgeStatus = (player: DfsEdgeBoardRow): string =>
  player.draftkings_classic.blocked.is_blocked ? "Held" : "DraftKings-ready";

export const formatDraftKingsClassicSalary = (salary: number | null): string =>
  salary === null ? "--" : `$${salary.toLocaleString("en-US")}`;

export const formatDraftKingsClassicValue = (value: number | null): string =>
  value === null ? "--" : `${value.toFixed(2)} pts/$1k`;
