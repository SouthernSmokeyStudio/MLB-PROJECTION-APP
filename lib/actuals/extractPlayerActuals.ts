import type { ActualPlayerOutcome } from "@lib/contracts/actuals";
import { asGameId, asPlayerId, asTeamId, err, ok, type Result } from "@lib/contracts/types";

export interface RawActualPlayerInput {
  readonly player_id: string;
  readonly team_id: string;
  readonly game_id: string;
  readonly pa?: number | null;
  readonly ip?: number | null;
  readonly strikeouts?: number | null;
  readonly earned_runs?: number | null;
  readonly hits?: number | null;
  readonly runs?: number | null;
  readonly rbi?: number | null;
  readonly walks?: number | null;
  readonly stolen_bases?: number | null;
  readonly singles?: number | null;
  readonly doubles?: number | null;
  readonly triples?: number | null;
  readonly home_runs?: number | null;
  readonly hbp?: number | null;
  readonly caught_stealing?: number | null;
  readonly win?: boolean | null;
  readonly complete_game?: boolean | null;
  readonly shutout?: boolean | null;
  readonly no_hitter?: boolean | null;
}

export interface RawPlayerActualsInput {
  readonly players: readonly RawActualPlayerInput[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readNullableNumber = (value: unknown): number | null =>
  typeof value === "number" ? value : null;

const readNullableBoolean = (value: unknown): boolean | null =>
  typeof value === "boolean" ? value : null;

const buildPlayerOutcome = (raw: unknown): Result<ActualPlayerOutcome, string> => {
  if (!isRecord(raw)) {
    return err("Invalid player actual payload");
  }

  const player_id = typeof raw.player_id === "string" ? raw.player_id : null;
  const team_id = typeof raw.team_id === "string" ? raw.team_id : null;
  const game_id = typeof raw.game_id === "string" ? raw.game_id : null;

  if (player_id === null || team_id === null || game_id === null) {
    return err("Player actuals require player_id, team_id, and game_id");
  }

  return ok({
    player_id: asPlayerId(player_id),
    team_id: asTeamId(team_id),
    game_id: asGameId(game_id),
    pa: readNullableNumber(raw.pa),
    ip: readNullableNumber(raw.ip),
    strikeouts: readNullableNumber(raw.strikeouts),
    earned_runs: readNullableNumber(raw.earned_runs),
    hits: readNullableNumber(raw.hits),
    runs: readNullableNumber(raw.runs),
    rbi: readNullableNumber(raw.rbi),
    walks: readNullableNumber(raw.walks),
    stolen_bases: readNullableNumber(raw.stolen_bases),
    singles: readNullableNumber(raw.singles),
    doubles: readNullableNumber(raw.doubles),
    triples: readNullableNumber(raw.triples),
    home_runs: readNullableNumber(raw.home_runs),
    hbp: readNullableNumber(raw.hbp),
    caught_stealing: readNullableNumber(raw.caught_stealing),
    win: readNullableBoolean(raw.win),
    complete_game: readNullableBoolean(raw.complete_game),
    shutout: readNullableBoolean(raw.shutout),
    no_hitter: readNullableBoolean(raw.no_hitter)
  });
};

export const extractPlayerActuals = (raw: unknown): Result<readonly ActualPlayerOutcome[], string> => {
  if (!isRecord(raw) || !Array.isArray(raw.players)) {
    return err("Raw player actuals payload must contain a players array");
  }

  const outcomes: ActualPlayerOutcome[] = [];

  for (const player of raw.players) {
    const outcome = buildPlayerOutcome(player);
    if (!outcome.success) {
      return outcome;
    }

    outcomes.push(outcome.data);
  }

  return ok(outcomes);
};
