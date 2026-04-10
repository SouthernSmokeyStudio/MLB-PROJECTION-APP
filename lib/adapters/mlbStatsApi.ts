import type { CanonicalGame } from "@lib/contracts/canonical";
import type {
  PreparedBatterInputs,
  PreparedPitcherInputs,
  PreparedTeamInputs
} from "@lib/contracts/prepared";
import { asISOTimestamp, asPlayerId, err, ok, type Result } from "@lib/contracts/types";
import type { GamePreparationData } from "@lib/preparation";
import type {
  MlbStatsApiGameAdapter,
  MlbStatsApiGameStatus,
  MlbStatsApiLinescore,
  MlbStatsApiProbablePitcher,
  MlbStatsApiScheduleGame,
  MlbStatsApiScheduleTeams,
  MlbStatsApiTeamReference,
  MlbStatsApiTeamSide,
  MlbStatsApiVenue
} from "./contracts";
import { fetchWithTimeout } from "./fetchWithTimeout";

const MLB_STATS_API_SCHEDULE_ENDPOINT = "https://statsapi.mlb.com/api/v1/schedule";
const MLB_STATS_API_GAME_ENDPOINT = "https://statsapi.mlb.com/api/v1/game";
const MLB_STATS_API_PEOPLE_ENDPOINT = "https://statsapi.mlb.com/api/v1/people";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readNullableString = (value: unknown): string | null => (typeof value === "string" ? value : null);
const readNullableNumber = (value: unknown): number | null => (typeof value === "number" ? value : null);
const readNullableRecord = (value: unknown): Record<string, unknown> | null => (isRecord(value) ? value : null);

const parseNumericString = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  if (
    normalized.length === 0 ||
    normalized === "-" ||
    normalized === "--" ||
    normalized === "-.--" ||
    normalized.toUpperCase() === "N/A"
  ) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseBaseballInnings = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    value = String(value);
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  if (
    normalized.length === 0 ||
    normalized === "-" ||
    normalized === "--" ||
    normalized === "-.--" ||
    normalized.toUpperCase() === "N/A"
  ) {
    return null;
  }

  const match = normalized.match(/^(\d+)(?:\.(\d))?$/);

  if (!match) {
    return null;
  }

  const wholeInnings = Number(match[1]);
  const outs = match[2] ? Number(match[2]) : 0;

  if (!Number.isInteger(wholeInnings) || !Number.isInteger(outs) || outs < 0 || outs > 2) {
    return null;
  }

  return wholeInnings + outs / 3;
};

const parseIntegerLike = (value: unknown): number | null => {
  const parsed = parseNumericString(value);

  if (parsed === null) {
    return null;
  }

  return Number.isInteger(parsed) ? parsed : null;
};

const parseBattingOrderSlot = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 9) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  const match = normalized.match(/[1-9]/);

  if (!match) {
    return null;
  }

  return Number(match[0]);
};

const parseRate = (numerator: unknown, denominator: unknown): number | null => {
  const parsedNumerator = parseNumericString(numerator);
  const parsedDenominator = parseNumericString(denominator);

  if (parsedNumerator === null || parsedDenominator === null || parsedDenominator <= 0) {
    return null;
  }

  return parsedNumerator / parsedDenominator;
};

const parsePlayerId = (value: unknown): ReturnType<typeof asPlayerId> | null => {
  const numericId = parseIntegerLike(value);
  return numericId === null ? null : asPlayerId(String(numericId));
};

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

export const fetchMlbStatsApiSchedule = async (date: string): Promise<Result<unknown[], string>> => {
  const searchParams = new URLSearchParams({
    sportId: "1",
    scheduleType: "games",
    date
  });

  const { response, error: fetchError } = await fetchWithTimeout(`${MLB_STATS_API_SCHEDULE_ENDPOINT}?${searchParams.toString()}`, {
    method: "GET",
    headers: {
      Accept: "application/json"
    },
    cache: "no-store"
  });

  if (!response) {
    return err(`MLB Stats API schedule ${fetchError}`);
  }

  if (!response.ok) {
    return err(`MLB Stats API schedule request failed with status ${response.status}`);
  }

  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    return err("MLB Stats API schedule response was not valid JSON");
  }

  if (!isRecord(payload)) {
    return err("MLB Stats API schedule response must be an object");
  }

  if (!Array.isArray(payload.dates)) {
    return err("MLB Stats API schedule response missing dates array");
  }

  if (payload.dates.length === 0) {
    return ok([]);
  }

  const firstDate = payload.dates[0];

  if (!isRecord(firstDate)) {
    return err("MLB Stats API schedule date block must be an object");
  }

  if (!Array.isArray(firstDate.games)) {
    return err("MLB Stats API schedule response missing dates/games array");
  }

  return ok(firstDate.games);
};

export const fetchMlbStatsApiBoxscore = async (gamePk: number): Promise<Result<unknown, string>> => {
  const { response, error: fetchError } = await fetchWithTimeout(`${MLB_STATS_API_GAME_ENDPOINT}/${gamePk}/boxscore`, {
    method: "GET",
    headers: {
      Accept: "application/json"
    },
    cache: "no-store"
  });

  if (!response) {
    return err(`MLB Stats API boxscore ${fetchError}`);
  }

  if (!response.ok) {
    return err(`MLB Stats API boxscore request failed with status ${response.status}`);
  }

  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    return err("MLB Stats API boxscore response was not valid JSON");
  }

  if (!isRecord(payload)) {
    return err("MLB Stats API boxscore response must be an object");
  }

  return ok(payload);
};

export const parseMlbStatsApiLinescorePayload = (
  payload: unknown
): Result<MlbStatsApiLinescore, string> => {
  if (!isRecord(payload)) {
    return err("MLB Stats API linescore payload must be an object");
  }

  const teams = readNullableRecord(payload.teams);
  const away = readNullableRecord(teams?.away);
  const home = readNullableRecord(teams?.home);

  if (!teams || !away || !home) {
    return err("MLB Stats API linescore payload missing teams block");
  }

  return ok({
    currentInning: parseIntegerLike(payload.currentInning),
    currentInningOrdinal: readNullableString(payload.currentInningOrdinal),
    inningState: readNullableString(payload.inningState),
    inningHalf: readNullableString(payload.inningHalf),
    isTopInning:
      typeof payload.isTopInning === "boolean" ? payload.isTopInning : null,
    teams: {
      away: {
        runs: parseIntegerLike(away.runs)
      },
      home: {
        runs: parseIntegerLike(home.runs)
      }
    }
  });
};

export const fetchMlbStatsApiLinescore = async (
  gamePk: number
): Promise<Result<MlbStatsApiLinescore, string>> => {
  const { response, error: fetchError } = await fetchWithTimeout(`${MLB_STATS_API_GAME_ENDPOINT}/${gamePk}/linescore`, {
    method: "GET",
    headers: {
      Accept: "application/json"
    },
    cache: "no-store"
  });

  if (!response) {
    return err(`MLB Stats API linescore ${fetchError}`);
  }

  if (!response.ok) {
    return err(`MLB Stats API linescore request failed with status ${response.status}`);
  }

  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    return err("MLB Stats API linescore response was not valid JSON");
  }

  return parseMlbStatsApiLinescorePayload(payload);
};

export const fetchAndParseMlbStatsApiSchedule = async (
  date: string
): Promise<Result<{ rawGames: unknown[]; parsedGames: MlbStatsApiScheduleGame[] }, string>> => {
  const fetched = await fetchMlbStatsApiSchedule(date);

  if (!fetched.success) {
    return fetched;
  }

  const rawGames = fetched.data;
  const parsedGames: MlbStatsApiScheduleGame[] = [];

  for (const rawGame of rawGames) {
    const parsed = parseMlbStatsApiGamePayload(rawGame);

    if (parsed.success) {
      parsedGames.push(parsed.data);
    }
  }

  if (rawGames.length === 0) {
    return ok({ rawGames: [], parsedGames: [] });
  }

  if (parsedGames.length === 0) {
    return err("No MLB Stats API schedule games parsed successfully");
  }

  return ok({ rawGames, parsedGames });
};

const readBoxscoreTeamBlock = (
  boxscore: Record<string, unknown>,
  side: "away" | "home"
): Result<Record<string, unknown>, string> => {
  const teams = readNullableRecord(boxscore.teams);

  if (!teams) {
    return err("MLB Stats API boxscore response missing teams object");
  }

  const teamBlock = readNullableRecord(teams[side]);

  if (!teamBlock) {
    return err(`MLB Stats API boxscore response missing teams.${side} object`);
  }

  return ok(teamBlock);
};

const buildPreparedTeamInputs = (
  teamBlock: Record<string, unknown>,
  teamId: PreparedTeamInputs["team_id"],
  lineupBattersAvailable: number
): PreparedTeamInputs => {
  const teamStats = readNullableRecord(teamBlock.teamStats);
  const pitching = readNullableRecord(teamStats?.pitching);

  return {
    team_id: teamId,
    team_woba: null,
    team_runs_per_game: null,
    team_k_rate: null,
    team_bb_rate: null,
    team_era: parseNumericString(pitching?.era),
    team_whip: parseNumericString(pitching?.whip),
    bullpen_era: null,
    lineup_batters_available: lineupBattersAvailable,
    lineup_avg_woba: null
  };
};

const buildPreparedBatters = (
  teamBlock: Record<string, unknown>,
  teamId: PreparedTeamInputs["team_id"]
): PreparedBatterInputs[] => {
  const players = readNullableRecord(teamBlock.players);

  if (!players) {
    return [];
  }

  const batters: PreparedBatterInputs[] = [];

  for (const player of Object.values(players)) {
    const playerRecord = readNullableRecord(player);
    const person = readNullableRecord(playerRecord?.person);
    const seasonStats = readNullableRecord(playerRecord?.seasonStats);
    const batting = readNullableRecord(seasonStats?.batting);
    const playerId = parsePlayerId(person?.id);
    const battingOrder = parseBattingOrderSlot(playerRecord?.battingOrder);
    const plateAppearances = parseIntegerLike(batting?.plateAppearances);

    if (!playerRecord || !batting || !playerId || battingOrder === null) {
      continue;
    }

    batters.push({
      player_id: playerId,
      team_id: teamId,
      batting_order: battingOrder,
      handedness: "unknown",
      season_pa: plateAppearances,
      season_avg: parseNumericString(batting.avg),
      season_obp: parseNumericString(batting.obp),
      season_slg: parseNumericString(batting.slg),
      season_woba: null,
      season_iso: (() => {
        const avg = parseNumericString(batting.avg);
        const slg = parseNumericString(batting.slg);
        return avg === null || slg === null ? null : slg - avg;
      })(),
      season_k_rate: parseRate(batting.strikeOuts, batting.plateAppearances),
      season_bb_rate: parseRate(batting.baseOnBalls, batting.plateAppearances),
      season_hr_rate: parseRate(batting.homeRuns, batting.plateAppearances),
      season_sb: parseIntegerLike(batting.stolenBases),
      recent_games_n: null,
      recent_woba: null,
      recent_avg: null,
      vs_lhp_woba: null,
      vs_rhp_woba: null
    });
  }

  return batters.sort((left, right) => {
    const leftOrder = left.batting_order ?? 99;
    const rightOrder = right.batting_order ?? 99;
    return leftOrder - rightOrder;
  });
};

const buildPreparedStarter = (
  teamBlock: Record<string, unknown>,
  teamId: PreparedTeamInputs["team_id"]
): PreparedPitcherInputs | null => {
  const players = readNullableRecord(teamBlock.players);

  if (!players) {
    return null;
  }

  const starters: PreparedPitcherInputs[] = [];

  for (const player of Object.values(players)) {
    const playerRecord = readNullableRecord(player);
    const person = readNullableRecord(playerRecord?.person);
    const stats = readNullableRecord(playerRecord?.stats);
    const gamePitching = readNullableRecord(stats?.pitching);
    const seasonStats = readNullableRecord(playerRecord?.seasonStats);
    const seasonPitching = readNullableRecord(seasonStats?.pitching);
    const playerId = parsePlayerId(person?.id);
    const gamesStarted = parseIntegerLike(gamePitching?.gamesStarted);
    const seasonGamesStarted = parseIntegerLike(seasonPitching?.gamesStarted);
    const seasonInningsPitched = parseBaseballInnings(seasonPitching?.inningsPitched);
    const recentIpPerStart =
      seasonInningsPitched !== null && seasonGamesStarted !== null && seasonGamesStarted > 0
        ? seasonInningsPitched / seasonGamesStarted
        : null;

    if (!playerRecord || !playerId || gamesStarted !== 1) {
      continue;
    }

    starters.push({
      player_id: playerId,
      mlb_stats_api_id: String(playerId),
      team_id: teamId,
      handedness: "unknown",
      // Provisional runtime fallback only: season innings pitched is sourced
      // from seasonStats.pitching. True recent-start enrichment is not yet
      // sourced, and this is not final pitcher-baseline math.
      season_ip: seasonInningsPitched,
      season_era: parseNumericString(seasonPitching?.era),
      season_whip: parseNumericString(seasonPitching?.whip),
      season_k_per_9: parseNumericString(seasonPitching?.strikeoutsPer9Inn),
      season_bb_per_9: parseNumericString(seasonPitching?.walksPer9Inn),
      season_hr_per_9: null,
      recent_starts_n: null,
      recent_era: null,
      recent_k_per_9: null,
      recent_ip_per_start: recentIpPerStart,
      vs_lhb_era: null,
      vs_rhb_era: null,
      days_rest: null,
      last_start_pitches: null
    });
  }

  return starters.length === 1 ? (starters[0] ?? null) : null;
};

export const extractPreparedGameDataFromBoxscore = (
  boxscore: unknown,
  normalizedGame: CanonicalGame
): Result<GamePreparationData, string> => {
  const boxscoreRecord = readNullableRecord(boxscore);

  if (!boxscoreRecord) {
    return err("MLB Stats API boxscore payload must be an object");
  }

  const awayTeamBlock = readBoxscoreTeamBlock(boxscoreRecord, "away");
  if (!awayTeamBlock.success) {
    return awayTeamBlock;
  }

  const homeTeamBlock = readBoxscoreTeamBlock(boxscoreRecord, "home");
  if (!homeTeamBlock.success) {
    return homeTeamBlock;
  }

  const awayBatters = buildPreparedBatters(awayTeamBlock.data, normalizedGame.away.team.team_id);
  const homeBatters = buildPreparedBatters(homeTeamBlock.data, normalizedGame.home.team.team_id);

  return ok({
    prepared_at: asISOTimestamp(new Date().toISOString()),
    away_team: buildPreparedTeamInputs(awayTeamBlock.data, normalizedGame.away.team.team_id, awayBatters.length),
    home_team: buildPreparedTeamInputs(homeTeamBlock.data, normalizedGame.home.team.team_id, homeBatters.length),
    away_starter: buildPreparedStarter(awayTeamBlock.data, normalizedGame.away.team.team_id),
    home_starter: buildPreparedStarter(homeTeamBlock.data, normalizedGame.home.team.team_id),
    away_batters: awayBatters,
    home_batters: homeBatters
  });
};

export const fetchMlbStatsApiPitcherSeasonStats = async (
  numericPlayerId: number,
  season: string
): Promise<Result<unknown, string>> => {
  const searchParams = new URLSearchParams({
    stats: "season",
    group: "pitching",
    season,
    gameType: "R"
  });

  const { response, error: fetchError } = await fetchWithTimeout(
    `${MLB_STATS_API_PEOPLE_ENDPOINT}/${numericPlayerId}/stats?${searchParams.toString()}`,
    { method: "GET", headers: { Accept: "application/json" }, cache: "no-store" }
  );

  if (!response) {
    return err(`MLB Stats API pitcher season stats ${fetchError}`);
  }

  if (!response.ok) {
    return err(`MLB Stats API pitcher season stats request failed with status ${response.status}`);
  }

  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    return err("MLB Stats API pitcher season stats response was not valid JSON");
  }

  if (!isRecord(payload)) {
    return err("MLB Stats API pitcher season stats response must be an object");
  }

  const stats = Array.isArray(payload.stats) ? payload.stats : null;
  const firstBlock = stats && stats.length > 0 ? readNullableRecord(stats[0]) : null;
  const splits = firstBlock && Array.isArray(firstBlock.splits) ? firstBlock.splits : null;
  const firstSplit = splits && splits.length > 0 ? readNullableRecord(splits[0]) : null;

  if (!firstSplit || !readNullableRecord(firstSplit.stat)) {
    return err(`MLB Stats API pitcher season stats for ${numericPlayerId} missing stat block`);
  }

  return ok(payload);
};

export const buildPreparedStarterFromPeopleStats = (
  canonicalPlayerId: ReturnType<typeof asPlayerId>,
  teamId: PreparedTeamInputs["team_id"],
  payload: unknown,
  mlbStatsApiId?: string | null
): PreparedPitcherInputs | null => {
  const payloadRecord = readNullableRecord(payload);
  const stats = payloadRecord && Array.isArray(payloadRecord.stats) ? payloadRecord.stats : null;
  const firstBlock = stats && stats.length > 0 ? readNullableRecord(stats[0]) : null;
  const splits = firstBlock && Array.isArray(firstBlock.splits) ? firstBlock.splits : null;
  const firstSplit = splits && splits.length > 0 ? readNullableRecord(splits[0]) : null;
  const stat = firstSplit ? readNullableRecord(firstSplit.stat) : null;

  if (!stat) {
    return null;
  }

  const seasonIp = parseBaseballInnings(stat.inningsPitched);
  const seasonGs = parseIntegerLike(stat.gamesStarted);
  const recentIpPerStart =
    seasonIp !== null && seasonGs !== null && seasonGs > 0
      ? seasonIp / seasonGs
      : null;

  return {
    player_id: canonicalPlayerId,
    mlb_stats_api_id: mlbStatsApiId ?? null,
    team_id: teamId,
    handedness: "unknown",
    season_ip: seasonIp,
    season_era: parseNumericString(stat.era),
    season_whip: parseNumericString(stat.whip),
    season_k_per_9: parseNumericString(stat.strikeoutsPer9Inn),
    season_bb_per_9: parseNumericString(stat.walksPer9Inn),
    season_hr_per_9: parseNumericString(stat.homeRunsPer9),
    recent_starts_n: null,
    recent_era: null,
    recent_k_per_9: null,
    recent_ip_per_start: recentIpPerStart,
    vs_lhb_era: null,
    vs_rhb_era: null,
    days_rest: null,
    last_start_pitches: null
  };
};

export const mlbStatsApiAdapter: MlbStatsApiGameAdapter = {
  source: "mlb-statsapi",
  parseGamePayload: parseMlbStatsApiGamePayload
};
