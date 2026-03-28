import type { ActualGameOutcome, ActualTeamOutcome } from "@lib/contracts/actuals";
import {
  asGameId,
  asISOTimestamp,
  asTeamId,
  err,
  ok,
  type Result,
  type SourceMetadata
} from "@lib/contracts/types";

interface RawActualTeamInput {
  readonly team_id: string;
  readonly runs: number;
  readonly hits: number;
  readonly errors: number;
  readonly left_on_base: number;
}

export interface RawActualGameInput {
  readonly game_id: string;
  readonly played_at: string;
  readonly away: RawActualTeamInput;
  readonly home: RawActualTeamInput;
  readonly total_innings: number;
  readonly is_complete: boolean;
  readonly was_postponed: boolean;
  readonly was_suspended: boolean;
  readonly sources?: readonly SourceMetadata[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const buildTeamOutcome = (raw: unknown, side: "away" | "home"): Result<ActualTeamOutcome, string> => {
  if (!isRecord(raw)) {
    return err(`Missing ${side} team actuals`);
  }

  const team_id = typeof raw.team_id === "string" ? raw.team_id : null;
  const runs = typeof raw.runs === "number" ? raw.runs : null;
  const hits = typeof raw.hits === "number" ? raw.hits : null;
  const errors = typeof raw.errors === "number" ? raw.errors : null;
  const left_on_base = typeof raw.left_on_base === "number" ? raw.left_on_base : null;

  if (team_id === null || runs === null || hits === null || errors === null || left_on_base === null) {
    return err(`Incomplete ${side} team actuals`);
  }

  return ok({
    team_id: asTeamId(team_id),
    runs,
    hits,
    errors,
    left_on_base
  });
};

export const extractGameActuals = (raw: unknown): Result<ActualGameOutcome, string> => {
  if (!isRecord(raw)) {
    return err("Raw game actuals payload must be an object");
  }

  const game_id = typeof raw.game_id === "string" ? raw.game_id : null;
  const played_at = typeof raw.played_at === "string" ? raw.played_at : null;
  const total_innings = typeof raw.total_innings === "number" ? raw.total_innings : null;
  const is_complete = typeof raw.is_complete === "boolean" ? raw.is_complete : null;
  const was_postponed = typeof raw.was_postponed === "boolean" ? raw.was_postponed : null;
  const was_suspended = typeof raw.was_suspended === "boolean" ? raw.was_suspended : null;

  if (
    game_id === null ||
    played_at === null ||
    total_innings === null ||
    is_complete === null ||
    was_postponed === null ||
    was_suspended === null
  ) {
    return err("Missing required game actual fields");
  }

  const away = buildTeamOutcome(raw.away, "away");
  if (!away.success) {
    return away;
  }

  const home = buildTeamOutcome(raw.home, "home");
  if (!home.success) {
    return home;
  }

  return ok({
    game_id: asGameId(game_id),
    played_at: asISOTimestamp(played_at),
    away: away.data,
    home: home.data,
    total_runs: away.data.runs + home.data.runs,
    total_innings,
    is_complete,
    was_postponed,
    was_suspended,
    sources: Array.isArray(raw.sources) ? (raw.sources as readonly SourceMetadata[]) : []
  });
};
