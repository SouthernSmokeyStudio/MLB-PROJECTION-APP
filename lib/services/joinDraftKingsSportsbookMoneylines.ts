import type {
  DraftKingsSportsbookMlbMoneylineJoinState,
  DraftKingsSportsbookMlbMoneylineSlate
} from "@lib/contracts/draftkings-sportsbook-mlb-moneyline";
import type { GameStatus, ISOTimestamp } from "@lib/contracts/types";
import { normalizeDkTeamAbbreviation } from "@lib/adapters/draftKingsSportsbook";
import { buildGameCard, type BuildGameCardOptions, type GameCard } from "./buildGameCard";
import { type AssembledGameProjection } from "@lib/projections/assembleGameProjection";
import type { LiveSlateSourceGame } from "./loadLiveSlate";

export interface DraftKingsSportsbookMoneylineGameCard extends GameCard {
  readonly scheduled_start: ISOTimestamp;
  readonly status: GameStatus;
  readonly away_team_abbreviation: string;
  readonly away_team_full_name: string;
  readonly home_team_abbreviation: string;
  readonly home_team_full_name: string;
  readonly draftkings_sportsbook_moneyline: DraftKingsSportsbookMlbMoneylineJoinState;
}

export interface DraftKingsSportsbookMoneylineGameCardsResult {
  readonly ready_games: number;
  readonly held_games: number;
  readonly games: readonly DraftKingsSportsbookMoneylineGameCard[];
}

const MONEYLINE_START_TIME_JOIN_WINDOW_MS = 30 * 60 * 1000;

const buildHeldJoinState = (
  reason: string
): DraftKingsSportsbookMlbMoneylineJoinState => ({
  provider: "draftkings-sportsbook",
  sport: "MLB",
  market_type: "moneyline",
  event_id: null,
  market_id: null,
  away_odds_american: null,
  home_odds_american: null,
  blocked: {
    is_blocked: true,
    blocked_reason: reason
  }
});

const buildReadyJoinState = ({
  eventId,
  marketId,
  awayOddsAmerican,
  homeOddsAmerican
}: {
  readonly eventId: string;
  readonly marketId: string;
  readonly awayOddsAmerican: number;
  readonly homeOddsAmerican: number;
}): DraftKingsSportsbookMlbMoneylineJoinState => ({
  provider: "draftkings-sportsbook",
  sport: "MLB",
  market_type: "moneyline",
  event_id: eventId,
  market_id: marketId,
  away_odds_american: awayOddsAmerican,
  home_odds_american: homeOddsAmerican,
  blocked: {
    is_blocked: false,
    blocked_reason: null
  }
});

const buildBaseGameRow = (
  sourceGame: LiveSlateSourceGame,
  game: GameCard
): Omit<DraftKingsSportsbookMoneylineGameCard, "market" | "draftkings_sportsbook_moneyline"> => ({
  ...game,
  scheduled_start: sourceGame.canonicalGame.scheduled_start,
  status: sourceGame.canonicalGame.status,
  away_team_abbreviation: sourceGame.canonicalGame.away.team.abbreviation,
  away_team_full_name: sourceGame.canonicalGame.away.team.full_name,
  home_team_abbreviation: sourceGame.canonicalGame.home.team.abbreviation,
  home_team_full_name: sourceGame.canonicalGame.home.team.full_name
});

const buildHeldGameRow = ({
  sourceGame,
  game,
  reason
}: {
  readonly sourceGame: LiveSlateSourceGame;
  readonly game: GameCard;
  readonly reason: string;
}): DraftKingsSportsbookMoneylineGameCard => ({
  ...buildBaseGameRow(sourceGame, game),
  market: null,
  draftkings_sportsbook_moneyline: buildHeldJoinState(reason)
});

const buildJoinCandidates = ({
  sourceGame,
  moneylineSlate
}: {
  readonly sourceGame: LiveSlateSourceGame;
  readonly moneylineSlate: DraftKingsSportsbookMlbMoneylineSlate;
}) => {
  const scheduledStartTime = Date.parse(sourceGame.canonicalGame.scheduled_start);

  if (!Number.isFinite(scheduledStartTime)) {
    return [];
  }

  return moneylineSlate.entries.filter(
    (entry) => {
      const marketStartTime = Date.parse(entry.start_time);

      // Normalize stored abbreviations at join time: entries captured before a
      // BF-004 mapping was added may carry the pre-fix raw value (e.g. "NY"
      // instead of "NYY"). normalizeDkTeamAbbreviation is idempotent — already-
      // canonical values pass through unchanged.
      const awayAbbr = normalizeDkTeamAbbreviation(entry.away_team_abbreviation).canonical;
      const homeAbbr = normalizeDkTeamAbbreviation(entry.home_team_abbreviation).canonical;

      return (
        Number.isFinite(marketStartTime) &&
        awayAbbr === sourceGame.canonicalGame.away.team.abbreviation &&
        homeAbbr === sourceGame.canonicalGame.home.team.abbreviation &&
        Math.abs(marketStartTime - scheduledStartTime) <=
          MONEYLINE_START_TIME_JOIN_WINDOW_MS
      );
    }
  );
};

export const joinDraftKingsSportsbookMoneylines = ({
  sourceGames,
  moneylineSlate,
  options = {}
}: {
  readonly sourceGames: readonly LiveSlateSourceGame[];
  readonly moneylineSlate: DraftKingsSportsbookMlbMoneylineSlate;
  readonly options?: Pick<BuildGameCardOptions, "simulation"> & {
    /** Pre-computed game projections keyed by game_id. When provided, skips recomputation. */
    readonly preassembled?: ReadonlyMap<string, AssembledGameProjection>;
  };
}): DraftKingsSportsbookMoneylineGameCardsResult => {
  const games = sourceGames.map<DraftKingsSportsbookMoneylineGameCard>((sourceGame) => {
    const preassembledForGame = options.preassembled?.get(sourceGame.preparedGame.game_id);
    const game = buildGameCard(
      sourceGame.preparedGame,
      { ...(options.simulation ? { simulation: options.simulation } : {}) },
      preassembledForGame
    );

    if (!game.simulation) {
      return buildHeldGameRow({
        sourceGame,
        game,
        reason: !sourceGame.preparedGame.team_level_ready
          ? (game.blocked.blocked_reason ?? "Team-level inputs insufficient for simulation")
          : "DraftKings Sportsbook moneyline join requires a simulation-backed game row"
      });
    }

    const candidates = buildJoinCandidates({
      sourceGame,
      moneylineSlate
    });

    if (candidates.length === 0) {
      return buildHeldGameRow({
        sourceGame,
        game,
        reason: "DraftKings Sportsbook moneyline missing for projected game row"
      });
    }

    if (candidates.length > 1) {
      return buildHeldGameRow({
        sourceGame,
        game,
        reason: "DraftKings Sportsbook moneyline join is ambiguous for projected game row"
      });
    }

    const matched = candidates[0];

    if (!matched) {
      return buildHeldGameRow({
        sourceGame,
        game,
        reason: "DraftKings Sportsbook moneyline missing for projected game row"
      });
    }

    const marketAwareGame = buildGameCard(sourceGame.preparedGame, {
      ...(options.simulation ? { simulation: options.simulation } : {}),
      market: {
        format: "american",
        moneyline: {
          away_odds: matched.away_odds_american,
          home_odds: matched.home_odds_american
        }
      }
    }, preassembledForGame);

    return {
      ...buildBaseGameRow(sourceGame, marketAwareGame),
      market: marketAwareGame.market,
      draftkings_sportsbook_moneyline: buildReadyJoinState({
        eventId: matched.event_id,
        marketId: matched.market_id,
        awayOddsAmerican: matched.away_odds_american,
        homeOddsAmerican: matched.home_odds_american
      })
    };
  });

  const heldGames = games.filter(
    (game) => game.draftkings_sportsbook_moneyline.blocked.is_blocked
  ).length;

  return {
    ready_games: games.length - heldGames,
    held_games: heldGames,
    games
  };
};
