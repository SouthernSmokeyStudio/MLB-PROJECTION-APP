import type { PreparedGameInputs } from "@lib/contracts/prepared";
import { buildGameCard, type BuildGameCardOptions, type GameCard } from "./buildGameCard";
import { buildPlayerCards, type PlayerCard } from "./buildPlayerCard";

export interface BuildSlateViewOptions {
  readonly market_by_game_id?: Record<string, BuildGameCardOptions["market"]>;
  readonly simulation?: {
    readonly seed?: number;
    readonly iterations?: number;
  };
}

export interface SlateView {
  readonly games: readonly GameCard[];
  readonly players: readonly PlayerCard[];
  readonly players_by_game_id: Readonly<Record<string, readonly PlayerCard[]>>;
  readonly blocked: {
    readonly games_blocked: number;
    readonly players_blocked: number;
  };
}

export const buildSlateView = (
  preparedGames: readonly PreparedGameInputs[],
  options: BuildSlateViewOptions = {}
): SlateView => {
  const games = preparedGames.map((prepared) => {
    const market = options.market_by_game_id?.[prepared.game_id];

    return buildGameCard(prepared, {
      ...(market ? { market } : {}),
      ...(options.simulation ? { simulation: options.simulation } : {})
    });
  });

  const playerResults = preparedGames.map((prepared) =>
    buildPlayerCards(
      prepared,
      options.simulation ? { simulation: options.simulation } : {}
    )
  );

  const players = playerResults.flatMap((result) => result.players);

  const playersByGameId = players.reduce<Record<string, PlayerCard[]>>((accumulator, player) => {
    const existing = accumulator[player.game_id] ?? [];
    accumulator[player.game_id] = [...existing, player];
    return accumulator;
  }, {});

  return {
    games,
    players,
    players_by_game_id: playersByGameId,
    blocked: {
      games_blocked: games.filter((game) => game.blocked.is_blocked).length,
      players_blocked: players.filter((player) => player.blocked.is_blocked).length
    }
  };
};