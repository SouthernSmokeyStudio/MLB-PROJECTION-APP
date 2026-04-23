import type {
  ScheduleBoardGame,
  ScheduleBoardInputCoverage,
  ScheduleBoardPayload,
  ScheduleBoardProjection,
  ScheduleBoardPlayerProjectionStatus,
  ScheduleBoardSummary,
  ScheduleBoardTeam,
  ScheduleBoardWeather
} from "@lib/contracts/schedule-board";
import {
  asGameId,
  asISOTimestamp,
  asPlayerId,
  asTeamId,
  type BlockedState,
  type GameStatus,
  type Handedness,
  type StartingStatus
} from "@lib/contracts/types";
import { probabilityToFairAmericanOdds } from "@lib/market/fairPrice";

const BOARD_TIME_ZONE = "America/Chicago";

export const EMPTY_SCHEDULE_SUMMARY: ScheduleBoardSummary = {
  total_games: 0,
  projection_ready_games: 0,
  games_ready_for_player_projections: 0,
  blocked_games: 0,
  games_with_both_starters: 0,
  games_with_both_lineups: 0
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readString = (record: Record<string, unknown>, fieldName: string): string => {
  const value = record[fieldName];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Schedule board payload is missing ${fieldName}.`);
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
    throw new Error(`Schedule board payload has invalid ${fieldName}.`);
  }
  return value;
};

const readNumber = (record: Record<string, unknown>, fieldName: string): number => {
  const value = record[fieldName];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Schedule board payload has invalid ${fieldName}.`);
  }
  return value;
};

const readBoolean = (record: Record<string, unknown>, fieldName: string): boolean => {
  const value = record[fieldName];
  if (typeof value !== "boolean") {
    throw new Error(`Schedule board payload has invalid ${fieldName}.`);
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
      throw new Error(`Schedule board payload has invalid ${fieldName}.`);
  }
};

const readHandedness = (
  record: Record<string, unknown>,
  fieldName: string
): Handedness => {
  const value = readString(record, fieldName);
  switch (value) {
    case "L":
    case "R":
    case "S":
    case "unknown":
      return value;
    default:
      throw new Error(`Schedule board payload has invalid ${fieldName}.`);
  }
};

const readStartingStatus = (
  record: Record<string, unknown>,
  fieldName: string
): StartingStatus => {
  const value = readString(record, fieldName);
  switch (value) {
    case "confirmed":
    case "expected":
    case "probable":
    case "unknown":
      return value;
    default:
      throw new Error(`Schedule board payload has invalid ${fieldName}.`);
  }
};

const readPlayerProjectionStatus = (
  record: Record<string, unknown>,
  fieldName: string
): ScheduleBoardPlayerProjectionStatus => {
  const value = readString(record, fieldName);
  switch (value) {
    case "ready":
    case "held":
      return value;
    default:
      throw new Error(`Schedule board payload has invalid ${fieldName}.`);
  }
};

const readBlockedState = (value: unknown): BlockedState => {
  if (!isRecord(value)) {
    throw new Error("Schedule board payload has invalid blocked state.");
  }

  return {
    is_blocked: readBoolean(value, "is_blocked"),
    blocked_reason: readNullableString(value, "blocked_reason")
  };
};

const parseScheduleBoardPitcher = (
  value: unknown
): ScheduleBoardTeam["probable_pitcher"] => {
  if (value === null || value === undefined) {
    return null;
  }

  if (!isRecord(value)) {
    throw new Error("Schedule board payload has invalid probable_pitcher.");
  }

  const playerId = value.player_id;
  if (playerId !== null && playerId !== undefined && typeof playerId !== "string") {
    throw new Error("Schedule board payload has invalid probable_pitcher.player_id.");
  }

  return {
    player_id: typeof playerId === "string" ? asPlayerId(playerId) : null,
    full_name: readNullableString(value, "full_name"),
    handedness: readHandedness(value, "handedness"),
    starting_status: readStartingStatus(value, "starting_status")
  };
};

const parseScheduleBoardTeam = (value: unknown): ScheduleBoardTeam => {
  if (!isRecord(value)) {
    throw new Error("Schedule board payload has invalid team block.");
  }

  return {
    team_id: asTeamId(readString(value, "team_id")),
    abbreviation: readString(value, "abbreviation"),
    full_name: readString(value, "full_name"),
    probable_pitcher: parseScheduleBoardPitcher(value.probable_pitcher),
    lineup_batters_available: readNumber(value, "lineup_batters_available")
  };
};

const parseScheduleBoardProjection = (value: unknown): ScheduleBoardProjection => {
  if (!isRecord(value)) {
    throw new Error("Schedule board payload has invalid projection block.");
  }

  const readNullableMetric = (fieldName: string): number | null => {
    const fieldValue = value[fieldName];
    if (fieldValue === null || fieldValue === undefined) {
      return null;
    }
    if (typeof fieldValue !== "number" || !Number.isFinite(fieldValue)) {
      throw new Error(`Schedule board payload has invalid projection ${fieldName}.`);
    }
    return fieldValue;
  };

  return {
    blocked: readBlockedState(value.blocked),
    projected_away_runs: readNullableMetric("projected_away_runs"),
    projected_home_runs: readNullableMetric("projected_home_runs"),
    projected_total: readNullableMetric("projected_total"),
    away_win_probability: readNullableMetric("away_win_probability"),
    home_win_probability: readNullableMetric("home_win_probability"),
    average_total_runs: readNullableMetric("average_total_runs")
  };
};

const parseScheduleBoardWeather = (value: unknown): ScheduleBoardWeather | null => {
  if (value === null || value === undefined) {
    return null;
  }

  if (!isRecord(value)) {
    throw new Error("Schedule board payload has invalid weather block.");
  }

  const readNullableNumber = (fieldName: string): number | null => {
    const fieldValue = value[fieldName];
    if (fieldValue === null || fieldValue === undefined) return null;
    if (typeof fieldValue !== "number" || !Number.isFinite(fieldValue)) {
      throw new Error(`Schedule board payload has invalid weather ${fieldName}.`);
    }
    return fieldValue;
  };

  const readNullableBoolean = (fieldName: string): boolean | null => {
    const fieldValue = value[fieldName];
    if (fieldValue === null || fieldValue === undefined) return null;
    if (typeof fieldValue !== "boolean") {
      throw new Error(`Schedule board payload has invalid weather ${fieldName}.`);
    }
    return fieldValue;
  };

  return {
    temperature_f: readNullableNumber("temperature_f"),
    wind_speed_mph: readNullableNumber("wind_speed_mph"),
    wind_direction: readNullableString(value, "wind_direction"),
    conditions: readNullableString(value, "conditions"),
    precipitation_chance: readNullableNumber("precipitation_chance"),
    dome_closed: readNullableBoolean("dome_closed")
  };
};

const parseScheduleBoardInputCoverage = (value: unknown): ScheduleBoardInputCoverage => {
  if (!isRecord(value)) {
    throw new Error("Schedule board payload has invalid input_coverage block.");
  }

  const readNullableNumber = (fieldName: string): number | null => {
    const fieldValue = value[fieldName];
    if (fieldValue === null || fieldValue === undefined) return null;
    if (typeof fieldValue !== "number" || !Number.isFinite(fieldValue)) {
      throw new Error(`Schedule board payload has invalid input_coverage ${fieldName}.`);
    }
    return fieldValue;
  };

  return {
    away_pitcher_handedness: readHandedness(value, "away_pitcher_handedness"),
    home_pitcher_handedness: readHandedness(value, "home_pitcher_handedness"),
    away_lineup_avg_woba: readNullableNumber("away_lineup_avg_woba"),
    home_lineup_avg_woba: readNullableNumber("home_lineup_avg_woba"),
    away_woba_batter_count: readNumber(value, "away_woba_batter_count"),
    home_woba_batter_count: readNumber(value, "home_woba_batter_count")
  };
};

const parseScheduleBoardGame = (value: unknown): ScheduleBoardGame => {
  if (!isRecord(value)) {
    throw new Error("Schedule board payload has invalid game.");
  }

  return {
    game_id: asGameId(readString(value, "game_id")),
    scheduled_start: asISOTimestamp(readString(value, "scheduled_start")),
    status: readGameStatus(value, "status"),
    venue_name: readNullableString(value, "venue_name"),
    away_team: parseScheduleBoardTeam(value.away_team),
    home_team: parseScheduleBoardTeam(value.home_team),
    has_both_starters: readBoolean(value, "has_both_starters"),
    has_both_lineups: readBoolean(value, "has_both_lineups"),
    completeness_score: readNumber(value, "completeness_score"),
    player_projection_status: readPlayerProjectionStatus(
      value,
      "player_projection_status"
    ),
    projection: parseScheduleBoardProjection(value.projection),
    weather: parseScheduleBoardWeather(value.weather),
    input_coverage: parseScheduleBoardInputCoverage(value.input_coverage)
  };
};

export const parseScheduleBoardPayload = (
  value: unknown
): ScheduleBoardPayload => {
  if (!isRecord(value)) {
    throw new Error("Schedule board payload must be an object.");
  }

  if (readString(value, "mode") !== "schedule-board-v1") {
    throw new Error("Schedule board payload has invalid mode.");
  }

  if (!isRecord(value.summary)) {
    throw new Error("Schedule board payload is missing summary.");
  }

  if (!isRecord(value.counts)) {
    throw new Error("Schedule board payload is missing counts.");
  }

  if (!Array.isArray(value.games)) {
    throw new Error("Schedule board payload is missing games.");
  }

  return {
    source: readString(value, "source"),
    mode: "schedule-board-v1",
    date: readString(value, "date"),
    generated_at: asISOTimestamp(readString(value, "generated_at")),
    summary: {
      total_games: readNumber(value.summary, "total_games"),
      projection_ready_games: readNumber(value.summary, "projection_ready_games"),
      games_ready_for_player_projections: readNumber(
        value.summary,
        "games_ready_for_player_projections"
      ),
      blocked_games: readNumber(value.summary, "blocked_games"),
      games_with_both_starters: readNumber(
        value.summary,
        "games_with_both_starters"
      ),
      games_with_both_lineups: readNumber(value.summary, "games_with_both_lineups")
    },
    counts: {
      fetched_raw: readNumber(value.counts, "fetched_raw"),
      parsed: readNumber(value.counts, "parsed"),
      normalized: readNumber(value.counts, "normalized"),
      prepared: readNumber(value.counts, "prepared"),
      boxscore_enriched: readNumber(value.counts, "boxscore_enriched")
    },
    games: value.games.map(parseScheduleBoardGame),
    note: readNullableString(value, "note")
  };
};

export const formatGeneratedStamp = (value: string): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return value;
  }

  const month = parsed
    .toLocaleString("en-US", { month: "short", timeZone: "UTC" })
    .toUpperCase();
  const day = parsed.toLocaleString("en-US", { day: "2-digit", timeZone: "UTC" });
  const time = parsed.toLocaleString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC"
  });

  return `${month} ${day} | ${time} UTC`;
};

export const formatScheduledStart = (value: string): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return value;
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: BOARD_TIME_ZONE
  }).formatToParts(parsed);

  const readPart = (type: string): string =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${readPart("month").toUpperCase()} ${readPart("day")} | ${readPart(
    "hour"
  )}:${readPart("minute")} ${readPart("dayPeriod").toUpperCase()} CT`;
};

export const formatBoardDate = (value: string): string => {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.valueOf())) {
    return value;
  }

  const month = parsed
    .toLocaleString("en-US", { month: "short", timeZone: "UTC" })
    .toUpperCase();
  const day = parsed.toLocaleString("en-US", { day: "2-digit", timeZone: "UTC" });

  return `${month} ${day}`;
};

export const formatStatusLabel = (value: GameStatus): string => {
  switch (value) {
    case "scheduled":
      return "Scheduled";
    case "pregame":
      return "Pregame";
    case "in_progress":
      return "In Progress";
    case "delayed":
      return "Delayed";
    case "suspended":
      return "Suspended";
    case "final":
      return "Final";
    case "postponed":
      return "Postponed";
    case "cancelled":
      return "Cancelled";
    default:
      return "Unknown";
  }
};

export const formatSourceLabel = (value: string): string => {
  if (value === "mlb-statsapi-live") {
    return "MLB Stats API";
  }

  if (value === "supabase-governed") {
    return "Supabase feed";
  }

  return value.trim().replace(/[_-]+/g, " ");
};

export const formatProbability = (value: number): string =>
  `${(value * 100).toFixed(1)}%`;

export const formatProjectionReadyLabel = (game: ScheduleBoardGame): string =>
  game.projection.blocked.is_blocked ? "Blocked" : "Ready";

export const formatPlayerProjectionStatusLabel = (
  status: ScheduleBoardGame["player_projection_status"]
): string => (status === "ready" ? "Player-ready" : "Player-held");

export const formatProjectionEdgeLabel = (game: ScheduleBoardGame): string | null => {
  const away = game.projection.away_win_probability;
  const home = game.projection.home_win_probability;

  if (away === null || home === null) {
    return null;
  }

  return away >= home
    ? `${game.away_team.abbreviation} ${formatProbability(away)}`
    : `${game.home_team.abbreviation} ${formatProbability(home)}`;
};

export const formatProjectedTotalLabel = (game: ScheduleBoardGame): string | null =>
  game.projection.projected_total === null
    ? null
    : `Total ${game.projection.projected_total.toFixed(1)}`;

export const formatInputCoverageLabel = (game: ScheduleBoardGame): string => {
  const away = game.away_team.lineup_batters_available;
  const home = game.home_team.lineup_batters_available;
  const awayFull = away >= 9;
  const homeFull = home >= 9;

  if (awayFull && homeFull) return "Full lineups set";
  if (away === 0 && home === 0) return "Lineups pending";

  const parts: string[] = [];
  if (!awayFull) parts.push(`away ${away}/9`);
  if (!homeFull) parts.push(`home ${home}/9`);
  return `Lineups partial — ${parts.join(", ")}`;
};

export const formatBlockedReason = (value: string | null): string | null =>
  value === null ? null : value.replace(/_/g, " ");

export const formatWeatherLine = (game: ScheduleBoardGame): string | null => {
  const w = game.weather;
  if (!w) return null;
  if (w.dome_closed === true) return "Dome closed";

  const parts: string[] = [];
  if (w.temperature_f !== null) parts.push(`${Math.round(w.temperature_f)}°F`);
  if (w.conditions !== null) parts.push(w.conditions);
  if (w.wind_speed_mph !== null && w.wind_direction !== null) {
    parts.push(`Wind ${Math.round(w.wind_speed_mph)} mph ${w.wind_direction}`);
  } else if (w.wind_speed_mph !== null) {
    parts.push(`Wind ${Math.round(w.wind_speed_mph)} mph`);
  }
  if (w.precipitation_chance !== null && w.precipitation_chance > 0) {
    parts.push(`${Math.round(w.precipitation_chance * 100)}% precip`);
  }

  return parts.length > 0 ? parts.join(" · ") : null;
};

export const buildStarterLine = (game: ScheduleBoardGame): string => {
  const awayStarter = game.away_team.probable_pitcher?.full_name ?? "Starter TBD";
  const homeStarter = game.home_team.probable_pitcher?.full_name ?? "Starter TBD";
  return `Starters: ${awayStarter} vs ${homeStarter}`;
};

export const buildAvailabilityLine = (game: ScheduleBoardGame): string => {
  const lineupCoverage = formatInputCoverageLabel(game);
  const blockedReason = formatBlockedReason(game.projection.blocked.blocked_reason);
  const playerProjectionStatus = formatPlayerProjectionStatusLabel(
    game.player_projection_status
  );

  if (game.projection.blocked.is_blocked) {
    return blockedReason
      ? `${lineupCoverage} | ${blockedReason} | ${playerProjectionStatus}`
      : `${lineupCoverage} | Projection blocked | ${playerProjectionStatus}`;
  }

  return `${lineupCoverage} | Projection ready from current inputs | ${playerProjectionStatus}`;
};

const formatAmericanOddsSign = (odds: number): string =>
  odds > 0 ? `+${odds}` : String(odds);

const isValidProbability = (value: number | null): value is number =>
  value !== null && Number.isFinite(value) && value > 0 && value < 1;

export const formatFairOddsLabel = (game: ScheduleBoardGame): string | null => {
  const away = game.projection.away_win_probability;
  const home = game.projection.home_win_probability;
  if (!isValidProbability(away) || !isValidProbability(home)) return null;
  const awayOdds = probabilityToFairAmericanOdds(away);
  const homeOdds = probabilityToFairAmericanOdds(home);
  return `${game.away_team.abbreviation} ${formatAmericanOddsSign(awayOdds)} / ${game.home_team.abbreviation} ${formatAmericanOddsSign(homeOdds)}`;
};

export const formatGameTypeLabel = (game: ScheduleBoardGame): string => {
  if (game.projection.blocked.is_blocked) return "Incomplete";
  const total = game.projection.projected_total;
  const away = game.projection.projected_away_runs;
  const home = game.projection.projected_home_runs;
  if (total === null || away === null || home === null) return "Pending";
  const spread = Math.abs(away - home);
  if (total < 7.0) return "Pitcher's Duel";
  if (total >= 10.0) return "Slugfest";
  if (spread <= 0.5) return "Balanced";
  if (spread > 1.5) return away > home ? "Away Edge" : "Home Edge";
  return "Balanced";
};

export const getErrorMessage = (value: unknown): string =>
  value instanceof Error ? value.message : "Unknown schedule board failure.";

export const readResponseError = (value: unknown): string | null =>
  isRecord(value) && typeof value.error === "string" && value.error.trim() !== ""
    ? value.error
    : null;
