import type {
  BettingEdgeBoardCounts,
  BettingEdgeBoardPayload,
  BettingEdgeBoardRow
} from "@lib/contracts/betting-edge-board";
import {
  asGameId,
  asISOTimestamp,
  type BlockedState,
  type GameStatus
} from "@lib/contracts/types";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readString = (record: Record<string, unknown>, fieldName: string): string => {
  const value = record[fieldName];

  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Betting edge payload is missing ${fieldName}.`);
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
    throw new Error(`Betting edge payload has invalid ${fieldName}.`);
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
    throw new Error(`Betting edge payload has invalid ${fieldName}.`);
  }

  return value;
};

const readNumber = (record: Record<string, unknown>, fieldName: string): number => {
  const value = readNullableNumber(record, fieldName);

  if (value === null) {
    throw new Error(`Betting edge payload is missing ${fieldName}.`);
  }

  return value;
};

const readBoolean = (record: Record<string, unknown>, fieldName: string): boolean => {
  const value = record[fieldName];

  if (typeof value !== "boolean") {
    throw new Error(`Betting edge payload has invalid ${fieldName}.`);
  }

  return value;
};

const readNullableBoolean = (
  record: Record<string, unknown>,
  fieldName: string
): boolean | null => {
  const value = record[fieldName];

  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "boolean") {
    throw new Error(`Betting edge payload has invalid ${fieldName}.`);
  }

  return value;
};

const readBlockedState = (value: unknown): BlockedState => {
  if (!isRecord(value)) {
    throw new Error("Betting edge payload has invalid blocked state.");
  }

  return {
    is_blocked: readBoolean(value, "is_blocked"),
    blocked_reason: readNullableString(value, "blocked_reason")
  };
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
      throw new Error(`Betting edge payload has invalid ${fieldName}.`);
  }
};

const parseMoneylineSide = (
  value: unknown
): BettingEdgeBoardRow["draftkings_sportsbook_moneyline"]["away"] => {
  if (!isRecord(value)) {
    throw new Error("Betting edge payload has invalid moneyline side.");
  }

  const teamSide = readString(value, "team_side");

  if (teamSide !== "away" && teamSide !== "home") {
    throw new Error("Betting edge payload has invalid team_side.");
  }

  return {
    team_side: teamSide,
    team_abbreviation: readString(value, "team_abbreviation"),
    team_full_name: readString(value, "team_full_name"),
    market_odds_american: readNullableNumber(value, "market_odds_american"),
    model_probability: readNullableNumber(value, "model_probability"),
    market_implied_probability: readNullableNumber(value, "market_implied_probability"),
    market_no_vig_probability: readNullableNumber(value, "market_no_vig_probability"),
    edge: readNullableNumber(value, "edge"),
    fair_american_odds: readNullableNumber(value, "fair_american_odds")
  };
};

const readNullablePitcherBaselineSource = (
  record: Record<string, unknown>,
  fieldName: string
): "season_stats" | "league_average_fallback" | null => {
  const value = record[fieldName];

  if (value === null || value === undefined) {
    return null;
  }

  if (value === "season_stats" || value === "league_average_fallback") {
    return value;
  }

  throw new Error(`Betting edge payload has invalid ${fieldName}.`);
};

const readNullableFallbackReason = (
  record: Record<string, unknown>,
  fieldName: string
): "pitcher_no_2026_stats" | "probable_pitcher_tbd" | null => {
  const value = record[fieldName];

  if (value === null || value === undefined) {
    return null;
  }

  if (value === "pitcher_no_2026_stats" || value === "probable_pitcher_tbd") {
    return value;
  }

  throw new Error(`Betting edge payload has invalid ${fieldName}.`);
};

const parseProjection = (value: unknown): BettingEdgeBoardRow["projection"] => {
  if (!isRecord(value)) {
    throw new Error("Betting edge payload has invalid projection block.");
  }

  return {
    blocked: readBlockedState(value.blocked),
    projected_away_runs: readNullableNumber(value, "projected_away_runs"),
    projected_home_runs: readNullableNumber(value, "projected_home_runs"),
    projected_total: readNullableNumber(value, "projected_total"),
    away_win_probability: readNullableNumber(value, "away_win_probability"),
    home_win_probability: readNullableNumber(value, "home_win_probability"),
    away_pitcher_baseline_source: readNullablePitcherBaselineSource(value, "away_pitcher_baseline_source"),
    home_pitcher_baseline_source: readNullablePitcherBaselineSource(value, "home_pitcher_baseline_source"),
    away_pitcher_identity_known: readNullableBoolean(value, "away_pitcher_identity_known"),
    home_pitcher_identity_known: readNullableBoolean(value, "home_pitcher_identity_known"),
    away_pitcher_fallback_reason: readNullableFallbackReason(value, "away_pitcher_fallback_reason"),
    home_pitcher_fallback_reason: readNullableFallbackReason(value, "home_pitcher_fallback_reason"),
    away_pitcher_fallback_used: readNullableBoolean(value, "away_pitcher_fallback_used"),
    home_pitcher_fallback_used: readNullableBoolean(value, "home_pitcher_fallback_used")
  };
};

const parseMoneylineState = (
  value: unknown
): BettingEdgeBoardRow["draftkings_sportsbook_moneyline"] => {
  if (!isRecord(value)) {
    throw new Error("Betting edge payload has invalid sportsbook block.");
  }

  if (
    readString(value, "provider") !== "draftkings-sportsbook" ||
    readString(value, "sport") !== "MLB" ||
    readString(value, "market_type") !== "moneyline"
  ) {
    throw new Error("Betting edge payload has invalid sportsbook identifiers.");
  }

  return {
    provider: "draftkings-sportsbook",
    sport: "MLB",
    market_type: "moneyline",
    event_id: readNullableString(value, "event_id"),
    market_id: readNullableString(value, "market_id"),
    away_odds_american: readNullableNumber(value, "away_odds_american"),
    home_odds_american: readNullableNumber(value, "home_odds_american"),
    away: parseMoneylineSide(value.away),
    home: parseMoneylineSide(value.home),
    blocked: readBlockedState(value.blocked)
  };
};

const parseRow = (value: unknown): BettingEdgeBoardRow => {
  if (!isRecord(value)) {
    throw new Error("Betting edge payload has invalid row.");
  }

  return {
    game_id: asGameId(readString(value, "game_id")),
    matchup: readString(value, "matchup"),
    scheduled_start: asISOTimestamp(readString(value, "scheduled_start")),
    status: readGameStatus(value, "status"),
    venue_name: readNullableString(value, "venue_name"),
    away_team_abbreviation: readString(value, "away_team_abbreviation"),
    away_team_full_name: readString(value, "away_team_full_name"),
    home_team_abbreviation: readString(value, "home_team_abbreviation"),
    home_team_full_name: readString(value, "home_team_full_name"),
    projection: parseProjection(value.projection),
    draftkings_sportsbook_moneyline: parseMoneylineState(value.draftkings_sportsbook_moneyline)
  };
};

const parseCounts = (value: unknown): BettingEdgeBoardCounts => {
  if (!isRecord(value)) {
    throw new Error("Betting edge payload is missing counts.");
  }

  return {
    fetched_raw: readNumber(value, "fetched_raw"),
    parsed: readNumber(value, "parsed"),
    normalized: readNumber(value, "normalized"),
    prepared: readNumber(value, "prepared"),
    boxscore_enriched: readNumber(value, "boxscore_enriched"),
    moneyline_entries: readNumber(value, "moneyline_entries"),
    matched_markets: readNumber(value, "matched_markets")
  };
};

const parseSportsbookSummary = (
  value: unknown
): BettingEdgeBoardPayload["draftkings_sportsbook_moneyline"] => {
  if (value === null || value === undefined) {
    return null;
  }

  if (!isRecord(value)) {
    throw new Error("Betting edge payload has invalid sportsbook summary.");
  }

  if (
    readString(value, "provider") !== "draftkings-sportsbook" ||
    readString(value, "sport") !== "MLB" ||
    readString(value, "market_type") !== "moneyline" ||
    readString(value, "site") !== "US-TN-SB"
  ) {
    throw new Error("Betting edge payload has invalid sportsbook summary identifiers.");
  }

  return {
    provider: "draftkings-sportsbook",
    sport: "MLB",
    market_type: "moneyline",
    site: "US-TN-SB",
    label: readString(value, "label")
  };
};

export const parseBettingEdgeBoardPayload = (value: unknown): BettingEdgeBoardPayload => {
  if (!isRecord(value)) {
    throw new Error("Betting edge payload must be an object.");
  }

  if (readString(value, "mode") !== "betting-edge-board-v1") {
    throw new Error("Betting edge payload has invalid mode.");
  }

  if (!isRecord(value.summary)) {
    throw new Error("Betting edge payload is missing summary.");
  }

  if (!Array.isArray(value.ready_games) || !Array.isArray(value.held_games)) {
    throw new Error("Betting edge payload is missing game groups.");
  }

  return {
    source: readString(value, "source"),
    mode: "betting-edge-board-v1",
    date: readString(value, "date"),
    generated_at: asISOTimestamp(readString(value, "generated_at")),
    draftkings_sportsbook_moneyline: parseSportsbookSummary(
      value.draftkings_sportsbook_moneyline
    ),
    summary: {
      total_games: readNumber(value.summary, "total_games"),
      ready_games: readNumber(value.summary, "ready_games"),
      held_games: readNumber(value.summary, "held_games"),
      average_ready_edge: readNullableNumber(value.summary, "average_ready_edge"),
      top_edge_side: isRecord(value.summary.top_edge_side)
        ? {
            game_id: asGameId(readString(value.summary.top_edge_side, "game_id")),
            matchup: readString(value.summary.top_edge_side, "matchup"),
            team_abbreviation: readString(value.summary.top_edge_side, "team_abbreviation"),
            team_full_name: readString(value.summary.top_edge_side, "team_full_name"),
            opponent_team_abbreviation: readString(
              value.summary.top_edge_side,
              "opponent_team_abbreviation"
            ),
            market_odds_american: readNumber(
              value.summary.top_edge_side,
              "market_odds_american"
            ),
            fair_american_odds: readNumber(
              value.summary.top_edge_side,
              "fair_american_odds"
            ),
            model_probability: readNumber(
              value.summary.top_edge_side,
              "model_probability"
            ),
            edge: readNumber(value.summary.top_edge_side, "edge")
          }
        : null
    },
    counts: parseCounts(value.counts),
    ready_games: value.ready_games.map(parseRow),
    held_games: value.held_games.map(parseRow),
    note: readNullableString(value, "note"),
    pitcher_fallback_count:
      typeof value.pitcher_fallback_count === "number" && Number.isFinite(value.pitcher_fallback_count)
        ? value.pitcher_fallback_count
        : 0,
    pitcher_fallback_game_ids: Array.isArray(value.pitcher_fallback_game_ids)
      ? (value.pitcher_fallback_game_ids as unknown[]).map((id) => {
          if (typeof id !== "string" || id.trim() === "") {
            throw new Error("Betting edge payload has invalid pitcher_fallback_game_ids entry.");
          }
          return asGameId(id);
        })
      : []
  };
};

export const formatBettingEdgeStatus = (game: BettingEdgeBoardRow): string =>
  game.draftkings_sportsbook_moneyline.blocked.is_blocked ? "Held" : "Moneyline-ready";

export const formatAmericanOdds = (odds: number | null): string => {
  if (odds === null) {
    return "--";
  }

  return odds > 0 ? `+${odds}` : String(odds);
};

export const formatBettingEdgePercent = (edge: number | null): string => {
  if (edge === null) {
    return "--";
  }

  const percent = (edge * 100).toFixed(1);
  return `${edge >= 0 ? "+" : ""}${percent}% edge`;
};

export const formatBettingEdgeProbability = (probability: number | null): string =>
  probability === null ? "--" : `${(probability * 100).toFixed(1)}%`;

export const formatFairAmericanOdds = (odds: number | null): string =>
  odds === null ? "Fair --" : `Fair ${formatAmericanOdds(odds)}`;

export const getBettingEdgeLeader = (
  game: BettingEdgeBoardRow
): BettingEdgeBoardRow["draftkings_sportsbook_moneyline"]["away"] | BettingEdgeBoardRow["draftkings_sportsbook_moneyline"]["home"] =>
  (game.draftkings_sportsbook_moneyline.away.edge ?? Number.NEGATIVE_INFINITY) >=
  (game.draftkings_sportsbook_moneyline.home.edge ?? Number.NEGATIVE_INFINITY)
    ? game.draftkings_sportsbook_moneyline.away
    : game.draftkings_sportsbook_moneyline.home;
