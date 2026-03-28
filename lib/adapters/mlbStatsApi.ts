import { err, ok, type Result } from "@lib/contracts/types";
import type {
  MlbStatsApiGameAdapter,
  MlbStatsApiGameStatus,
  MlbStatsApiProbablePitcher,
  MlbStatsApiScheduleGame,
  MlbStatsApiScheduleTeams,
  MlbStatsApiTeamReference,
  MlbStatsApiTeamSide,
  MlbStatsApiVenue
} from "./contracts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readNullableString = (value: unknown): string | null => (typeof value === "string" ? value : null);
const readNullableNumber = (value: unknown): number | null => (typeof value === "number" ? value : null);

const parseTeamReference = (value: unknown, side: "away" | "home"): Result<MlbStatsApiTeamReference, string> => {
  if (!isRecord(value)) {
    return err(`Missing ${side} team reference`);
  }

  const id = readNullableNumber(value.id);
  const name = readNullableString(value.name);

  if (id === null) {
    return err(`Missing ${side} team id`);
  }

  if (name === null || name.trim().length === 0) {
    return err(`Missing ${side} team name`);
  }

  return ok({ id, name });
};

const parseProbablePitcher = (value: unknown): Result<MlbStatsApiProbablePitcher | null, string> => {
  if (value === null || value === undefined) {
    return ok(null);
  }

  if (!isRecord(value)) {
    return err("Invalid probablePitcher object");
  }

  const id = readNullableNumber(value.id);
  if (id === null) {
    return err("Missing probablePitcher id");
  }

  return ok({
    id,
    fullName: readNullableString(value.fullName)
  });
};

const parseTeamSide = (value: unknown, side: "away" | "home"): Result<MlbStatsApiTeamSide, string> => {
  if (!isRecord(value)) {
    return err(`Missing ${side} team block`);
  }

  const team = parseTeamReference(value.team, side);
  if (!team.success) {
    return team;
  }

  const probablePitcher = parseProbablePitcher(value.probablePitcher);
  if (!probablePitcher.success) {
    return probablePitcher;
  }

  return ok({
    team: team.data,
    probablePitcher: probablePitcher.data
  });
};

const parseTeams = (value: unknown): Result<MlbStatsApiScheduleTeams, string> => {
  if (!isRecord(value)) {
    return err("Missing teams block");
  }

  const away = parseTeamSide(value.away, "away");
  if (!away.success) {
    return away;
  }

  const home = parseTeamSide(value.home, "home");
  if (!home.success) {
    return home;
  }

  return ok({ away: away.data, home: home.data });
};

const parseStatus = (value: unknown): MlbStatsApiGameStatus => {
  if (!isRecord(value)) {
    return {
      codedGameState: null,
      detailedState: null
    };
  }

  return {
    codedGameState: readNullableString(value.codedGameState),
    detailedState: readNullableString(value.detailedState)
  };
};

const parseVenue = (value: unknown): Result<MlbStatsApiVenue | null, string> => {
  if (value === null || value === undefined) {
    return ok(null);
  }

  if (!isRecord(value)) {
    return err("Invalid venue block");
  }

  const id = readNullableNumber(value.id);
  const name = readNullableString(value.name);

  if (id === null || name === null || name.trim().length === 0) {
    return err("Venue requires id and name when provided");
  }

  return ok({ id, name });
};

export const parseMlbStatsApiGamePayload = (payload: unknown): Result<MlbStatsApiScheduleGame, string> => {
  if (!isRecord(payload)) {
    return err("Raw MLB Stats API payload must be an object");
  }

  const gamePk = readNullableNumber(payload.gamePk);
  const gameDate = readNullableString(payload.gameDate);

  if (gamePk === null) {
    return err("Missing gamePk in raw payload");
  }

  if (gameDate === null || gameDate.trim().length === 0) {
    return err("Missing gameDate in raw payload");
  }

  const teams = parseTeams(payload.teams);
  if (!teams.success) {
    return teams;
  }

  const venue = parseVenue(payload.venue);
  if (!venue.success) {
    return venue;
  }

  return ok({
    gamePk,
    gameDate,
    status: parseStatus(payload.status),
    teams: teams.data,
    venue: venue.data
  });
};

export const mlbStatsApiAdapter: MlbStatsApiGameAdapter = {
  source: "mlb-statsapi",
  parseGamePayload: parseMlbStatsApiGamePayload
};
