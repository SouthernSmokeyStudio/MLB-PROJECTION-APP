import type {
  BettingEdgeBoardCounts,
  BettingEdgeBoardMoneylineSide,
  BettingEdgeBoardPayload,
  BettingEdgeBoardRow,
  BettingEdgeBoardTopSide
} from "@lib/contracts/betting-edge-board";
import type { DraftKingsSportsbookMlbMoneylineSlate } from "@lib/contracts/draftkings-sportsbook-mlb-moneyline";
import { asGameId, asISOTimestamp } from "@lib/contracts/types";
import type { TwoWayMarketEdge } from "@lib/market/edge";
import {
  joinDraftKingsSportsbookMoneylines,
  type DraftKingsSportsbookMoneylineGameCard
} from "./joinDraftKingsSportsbookMoneylines";
import type { LiveSlateCounts, LiveSlateSourceGame } from "./loadLiveSlate";

export interface BuildBettingEdgeBoardOptions {
  readonly source: string;
  readonly date: string;
  readonly generated_at?: string;
  readonly counts: LiveSlateCounts;
  readonly note?: string | null;
  readonly draftkings_sportsbook_moneyline: {
    readonly site: "US-TN-SB";
    readonly label: string;
  };
  readonly moneyline_slate: DraftKingsSportsbookMlbMoneylineSlate;
  readonly simulation?: {
    readonly seed?: number;
    readonly iterations?: number;
  };
}

const buildMatchupLabel = (sourceGame: LiveSlateSourceGame): string =>
  `${sourceGame.canonicalGame.away.team.full_name} at ${sourceGame.canonicalGame.home.team.full_name}`;

const buildMoneylineSide = ({
  teamSide,
  teamAbbreviation,
  teamFullName,
  odds,
  edge
}: {
  readonly teamSide: "away" | "home";
  readonly teamAbbreviation: string;
  readonly teamFullName: string;
  readonly odds: number | null;
  readonly edge: TwoWayMarketEdge | null;
}): BettingEdgeBoardMoneylineSide => ({
  team_side: teamSide,
  team_abbreviation: teamAbbreviation,
  team_full_name: teamFullName,
  market_odds_american: odds,
  model_probability: edge?.model_probability ?? null,
  market_implied_probability: edge?.market_implied_probability ?? null,
  market_no_vig_probability: edge?.market_no_vig_probability ?? null,
  edge: edge?.no_vig_edge ?? null,
  fair_american_odds: edge?.fair_american_odds ?? null
});

const toBettingEdgeBoardRow = ({
  sourceGame,
  game
}: {
  readonly sourceGame: LiveSlateSourceGame;
  readonly game: DraftKingsSportsbookMoneylineGameCard;
}): BettingEdgeBoardRow => {
  const awayMoneyline = game.market?.moneyline?.away ?? null;
  const homeMoneyline = game.market?.moneyline?.home ?? null;
  const matchup = buildMatchupLabel(sourceGame);

  return {
    game_id: asGameId(game.game_id),
    matchup,
    scheduled_start: sourceGame.canonicalGame.scheduled_start,
    status: sourceGame.canonicalGame.status,
    venue_name: sourceGame.canonicalGame.venue?.name ?? null,
    away_team_abbreviation: sourceGame.canonicalGame.away.team.abbreviation,
    away_team_full_name: sourceGame.canonicalGame.away.team.full_name,
    home_team_abbreviation: sourceGame.canonicalGame.home.team.abbreviation,
    home_team_full_name: sourceGame.canonicalGame.home.team.full_name,
    projection: {
      blocked: game.blocked,
      projected_away_runs: game.deterministic.projected_away_runs,
      projected_home_runs: game.deterministic.projected_home_runs,
      projected_total: game.deterministic.projected_total,
      away_win_probability: game.simulation?.away_win_probability ?? null,
      home_win_probability: game.simulation?.home_win_probability ?? null
    },
    draftkings_sportsbook_moneyline: {
      provider: game.draftkings_sportsbook_moneyline.provider,
      sport: game.draftkings_sportsbook_moneyline.sport,
      market_type: game.draftkings_sportsbook_moneyline.market_type,
      event_id: game.draftkings_sportsbook_moneyline.event_id,
      market_id: game.draftkings_sportsbook_moneyline.market_id,
      away_odds_american: game.draftkings_sportsbook_moneyline.away_odds_american,
      home_odds_american: game.draftkings_sportsbook_moneyline.home_odds_american,
      away: buildMoneylineSide({
        teamSide: "away",
        teamAbbreviation: sourceGame.canonicalGame.away.team.abbreviation,
        teamFullName: sourceGame.canonicalGame.away.team.full_name,
        odds: game.draftkings_sportsbook_moneyline.away_odds_american,
        edge: awayMoneyline
      }),
      home: buildMoneylineSide({
        teamSide: "home",
        teamAbbreviation: sourceGame.canonicalGame.home.team.abbreviation,
        teamFullName: sourceGame.canonicalGame.home.team.full_name,
        odds: game.draftkings_sportsbook_moneyline.home_odds_american,
        edge: homeMoneyline
      }),
      blocked: game.draftkings_sportsbook_moneyline.blocked
    }
  };
};

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

const getTopSide = (
  game: BettingEdgeBoardRow
): BettingEdgeBoardRow["draftkings_sportsbook_moneyline"]["away"] | BettingEdgeBoardRow["draftkings_sportsbook_moneyline"]["home"] => {
  const awayEdge = game.draftkings_sportsbook_moneyline.away.edge;
  const homeEdge = game.draftkings_sportsbook_moneyline.home.edge;

  if (compareNullableNumbersDesc(awayEdge, homeEdge) <= 0) {
    return game.draftkings_sportsbook_moneyline.home;
  }

  return game.draftkings_sportsbook_moneyline.away;
};

const buildTopEdgeSide = (game: BettingEdgeBoardRow): BettingEdgeBoardTopSide | null => {
  const topSide = getTopSide(game);

  if (
    topSide.edge === null ||
    topSide.market_odds_american === null ||
    topSide.fair_american_odds === null ||
    topSide.model_probability === null
  ) {
    return null;
  }

  return {
    game_id: asGameId(game.game_id),
    matchup: game.matchup,
    team_abbreviation: topSide.team_abbreviation,
    team_full_name: topSide.team_full_name,
    opponent_team_abbreviation:
      topSide.team_side === "away"
        ? game.home_team_abbreviation
        : game.away_team_abbreviation,
    market_odds_american: topSide.market_odds_american,
    fair_american_odds: topSide.fair_american_odds,
    model_probability: topSide.model_probability,
    edge: topSide.edge
  };
};

const sortReadyGames = (left: BettingEdgeBoardRow, right: BettingEdgeBoardRow): number => {
  const edgeComparison = compareNullableNumbersDesc(
    getTopSide(left).edge,
    getTopSide(right).edge
  );

  if (edgeComparison !== 0) {
    return edgeComparison;
  }

  return left.scheduled_start.localeCompare(right.scheduled_start);
};

const sortHeldGames = (left: BettingEdgeBoardRow, right: BettingEdgeBoardRow): number => {
  const startComparison = left.scheduled_start.localeCompare(right.scheduled_start);

  if (startComparison !== 0) {
    return startComparison;
  }

  return left.matchup.localeCompare(right.matchup);
};

const createEmptySummary = () => ({
  total_games: 0,
  ready_games: 0,
  held_games: 0,
  average_ready_edge: null,
  top_edge_side: null
});

export const createEmptyBettingEdgeBoard = ({
  source,
  date,
  generated_at,
  counts,
  note,
  draftkings_sportsbook_moneyline
}: {
  readonly source: string;
  readonly date: string;
  readonly generated_at?: string;
  readonly counts: BettingEdgeBoardCounts;
  readonly note: string | null;
  readonly draftkings_sportsbook_moneyline: BettingEdgeBoardPayload["draftkings_sportsbook_moneyline"];
}): BettingEdgeBoardPayload => ({
  source,
  mode: "betting-edge-board-v1",
  date,
  generated_at: asISOTimestamp(generated_at ?? new Date().toISOString()),
  draftkings_sportsbook_moneyline,
  summary: createEmptySummary(),
  counts,
  ready_games: [],
  held_games: [],
  note
});

export const buildBettingEdgeBoard = (
  sourceGames: readonly LiveSlateSourceGame[],
  options: BuildBettingEdgeBoardOptions
): BettingEdgeBoardPayload => {
  const joined = joinDraftKingsSportsbookMoneylines({
    sourceGames,
    moneylineSlate: options.moneyline_slate,
    ...(options.simulation ? { options: { simulation: options.simulation } } : {})
  });

  const rows = joined.games.map((game, index) =>
    toBettingEdgeBoardRow({
      sourceGame: sourceGames[index] as LiveSlateSourceGame,
      game
    })
  );
  const readyGames = rows
    .filter((game) => !game.draftkings_sportsbook_moneyline.blocked.is_blocked)
    .sort(sortReadyGames);
  const heldGames = rows
    .filter((game) => game.draftkings_sportsbook_moneyline.blocked.is_blocked)
    .sort(sortHeldGames);
  const topEdgeSide = readyGames
    .map(buildTopEdgeSide)
    .filter((game): game is BettingEdgeBoardTopSide => game !== null)
    .sort((left, right) => right.edge - left.edge)[0] ?? null;
  const totalReadyEdge = readyGames.reduce((sum, game) => {
    const edge = getTopSide(game).edge;
    return sum + (edge ?? 0);
  }, 0);

  return {
    source: options.source,
    mode: "betting-edge-board-v1",
    date: options.date,
    generated_at: asISOTimestamp(options.generated_at ?? new Date().toISOString()),
    draftkings_sportsbook_moneyline: {
      provider: "draftkings-sportsbook",
      sport: "MLB",
      market_type: "moneyline",
      site: options.draftkings_sportsbook_moneyline.site,
      label: options.draftkings_sportsbook_moneyline.label
    },
    summary: {
      total_games: rows.length,
      ready_games: readyGames.length,
      held_games: heldGames.length,
      average_ready_edge: readyGames.length === 0 ? null : totalReadyEdge / readyGames.length,
      top_edge_side: topEdgeSide
    },
    counts: {
      ...options.counts,
      moneyline_entries: options.moneyline_slate.entries.length,
      matched_markets: readyGames.length
    },
    ready_games: readyGames,
    held_games: heldGames,
    note: options.note ?? null
  };
};
