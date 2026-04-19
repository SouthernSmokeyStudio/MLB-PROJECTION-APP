import type {
  LiveScoreboardGame,
  LiveScoreboardPayload
} from "@lib/contracts/live-scoreboard";
import { asGameId, asISOTimestamp, asTeamId } from "@lib/contracts/types";
import type { LiveSlateCounts, LiveSlateSourceGame } from "./loadLiveSlate";

export interface BuildLiveScoreboardOptions {
  readonly source: string;
  readonly date: string;
  readonly counts: LiveSlateCounts;
  readonly generated_at?: string;
  readonly note?: string | null;
}

const buildMatchupLabel = (sourceGame: LiveSlateSourceGame): string =>
  `${sourceGame.canonicalGame.away.team.full_name} at ${sourceGame.canonicalGame.home.team.full_name}`;

const buildBlockedState = (
  sourceGame: LiveSlateSourceGame
): LiveScoreboardGame["blocked"] => {
  const { status } = sourceGame.canonicalGame;
  const scoreState = sourceGame.liveScoreState;

if (status === "in_progress" &&
      (scoreState.away_score === null || scoreState.home_score === null)) {
    return {
      is_blocked: true,
      blocked_reason: "Live score state is missing away/home score for a live game."
    };
  }

  if (status === "in_progress" &&
      (scoreState.inning_number === null || scoreState.inning_state === null)) {
    return {
      is_blocked: true,
      blocked_reason: "Live score state is missing inning context for an in-progress game."
    };
  }

  return {
    is_blocked: false,
    blocked_reason: null
  };
};

const buildLiveScoreboardGame = (
  sourceGame: LiveSlateSourceGame
): LiveScoreboardGame => ({
  game_id: asGameId(sourceGame.canonicalGame.game_id),
  matchup: buildMatchupLabel(sourceGame),
  scheduled_start: asISOTimestamp(sourceGame.canonicalGame.scheduled_start),
  status: sourceGame.canonicalGame.status,
  venue_name: sourceGame.canonicalGame.venue?.name ?? null,
  away_team_id: asTeamId(sourceGame.canonicalGame.away.team.team_id),
  away_team_abbreviation: sourceGame.canonicalGame.away.team.abbreviation,
  away_team_full_name: sourceGame.canonicalGame.away.team.full_name,
  home_team_id: asTeamId(sourceGame.canonicalGame.home.team.team_id),
  home_team_abbreviation: sourceGame.canonicalGame.home.team.abbreviation,
  home_team_full_name: sourceGame.canonicalGame.home.team.full_name,
  away_score: sourceGame.liveScoreState.away_score,
  home_score: sourceGame.liveScoreState.home_score,
  inning_number: sourceGame.liveScoreState.inning_number,
  inning_state: sourceGame.liveScoreState.inning_state,
  is_live: sourceGame.liveScoreState.is_live,
  is_final: sourceGame.liveScoreState.is_final,
  display_state: sourceGame.liveScoreState.display_state,
  blocked: buildBlockedState(sourceGame)
});

export const buildLiveScoreboard = (
  sourceGames: readonly LiveSlateSourceGame[],
  options: BuildLiveScoreboardOptions
): LiveScoreboardPayload => {
  const games = sourceGames.map(buildLiveScoreboardGame);

  return {
    source: options.source,
    mode: "live-scoreboard-v1",
    date: options.date,
    generated_at: asISOTimestamp(options.generated_at ?? new Date().toISOString()),
    summary: {
      total_games: games.length,
      live_games: games.filter((game) => game.is_live).length,
      final_games: games.filter((game) => game.is_final).length,
      pregame_games: games.filter(
        (game) => game.status === "scheduled" || game.status === "pregame"
      ).length,
      blocked_games: games.filter((game) => game.blocked.is_blocked).length
    },
    counts: options.counts,
    games,
    note: options.note ?? null
  };
};
