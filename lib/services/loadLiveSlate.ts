import type { MlbStatsApiScheduleGame } from "@lib/adapters/contracts";
import { fetchWithTimeout } from "@lib/adapters/fetchWithTimeout";
import {
  buildPreparedBatterFromPeopleStats,
  buildPreparedStarterFromPeopleStats,
  extractPreparedGameDataFromBoxscore,
  fetchAndParseMlbStatsApiSchedule,
  fetchMlbStatsApiBoxscore,
  fetchMlbStatsApiBatterSeasonStats,
  fetchMlbStatsApiLinescore,
  fetchMlbStatsApiPitcherSeasonStats
} from "@lib/adapters/mlbStatsApi";
import type { CanonicalGame } from "@lib/contracts/canonical";
import type { MergedLineupEntry } from "@lib/contracts/merge-law";
import type { PreparedBatterInputs, PreparedGameInputs } from "@lib/contracts/prepared";
import {
  asPlayerId,
  err,
  ok,
  type GameId,
  type PlayerId,
  type PlayerPosition,
  type Result
} from "@lib/contracts/types";
import type { MaterializedSlate } from "@lib/contracts/materialized-slate";
import type { ProjectedGameData } from "@lib/contracts/projected-source";
import type { InferredGameData } from "@lib/contracts/inferred-source";
import { normalizeMlbStatsApiGame } from "@lib/normalization/mlbStatsApiNormalizer";
import type { GamePreparationData } from "@lib/preparation";
import { prepareGameInputs } from "@lib/preparation";
import { resolveGameSources, applyMergedStartersToCanonical } from "@lib/merge";

const MLB_STATS_API_TEAM_ENDPOINT = "https://statsapi.mlb.com/api/v1/teams";

type NormalizedGameEntry = {
  readonly parsedGame: MlbStatsApiScheduleGame;
  readonly normalizedGame: CanonicalGame;
};

type JsonObjectResult =
  | { success: true; data: Record<string, unknown> }
  | { success: false; error: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readNullableArray = (value: unknown): unknown[] | null =>
  Array.isArray(value) ? value : null;

const readNullableNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const readNullableRecord = (value: unknown): Record<string, unknown> | null =>
  isRecord(value) ? value : null;

const readNullableString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

const parseIntegerLike = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (normalized.length === 0) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isInteger(parsed) ? parsed : null;
};

const parseBattingOrderSlot = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 9) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const match = value.trim().match(/[1-9]/);
  return match ? Number(match[0]) : null;
};

const parsePlayerId = (value: unknown): PlayerId | null => {
  const parsed = parseIntegerLike(value);
  return parsed === null ? null : asPlayerId(String(parsed));
};

const parsePlayerPosition = (value: unknown): PlayerPosition => {
  const normalized = readNullableString(value)?.trim().toUpperCase();

  switch (normalized) {
    case "P":
    case "C":
    case "1B":
    case "2B":
    case "3B":
    case "SS":
    case "LF":
    case "CF":
    case "RF":
    case "DH":
    case "UTIL":
      return normalized;
    default:
      return "unknown";
  }
};

/**
 * Translate a merged lineup entry into a PreparedBatterInputs skeleton.
 *
 * Used as a fallback when the boxscore has no batting-order data (pre-game).
 * All per-player stat fields are null — only identity and batting-order are
 * carried.  Handedness is unknown because projected lineup entries do not
 * carry it; downstream wOBA math treats unknown-handedness as neutral.
 */
const buildProjectedBatterInputs = (entry: MergedLineupEntry): PreparedBatterInputs => ({
  player_id: entry.player_id,
  mlb_stats_api_id: null,
  team_id: entry.team_id,
  batting_order: entry.batting_order,
  handedness: "unknown",
  lineup_status: "confirmed_order",
  season_pa: null,
  season_avg: null,
  season_obp: null,
  season_slg: null,
  season_woba: null,
  season_iso: null,
  season_k_rate: null,
  season_bb_rate: null,
  season_hr_rate: null,
  season_sb: null,
  recent_games_n: null,
  recent_woba: null,
  recent_avg: null,
  vs_lhp_woba: null,
  vs_rhp_woba: null
});

/**
 * Normalize a player name to a URL-safe ASCII slug.
 *
 * NFD decomposition followed by combining-character removal strips
 * diacritics before the ASCII-only character filter runs, so names like
 * "Yordan Álvarez" produce "yordan-alvarez" — the same slug a projected-
 * source provider emits from an ASCII-only name list.
 */
export const slugifyPlayerName = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const findBoxscorePlayerNumericId = (
  boxscore: unknown,
  side: "away" | "home",
  playerId: PlayerId | null
): number | null => {
  if (playerId === null) {
    return null;
  }

  const boxscoreRecord = readNullableRecord(boxscore);
  const teamBlock = readNullableRecord(readNullableRecord(boxscoreRecord?.teams)?.[side]);
  const players = readNullableRecord(teamBlock?.players);

  if (!players) {
    return null;
  }

  for (const player of Object.values(players)) {
    const playerRecord = readNullableRecord(player);
    const person = readNullableRecord(playerRecord?.person);
    const numericId = parseIntegerLike(person?.id);
    const fullName = readNullableString(person?.fullName);

    if (
      numericId !== null &&
      (String(numericId) === playerId ||
        (fullName !== null && slugifyPlayerName(fullName) === playerId))
    ) {
      return numericId;
    }
  }

  return null;
};

const hasStatsArray = (payload: Record<string, unknown>): boolean =>
  Array.isArray(payload.stats);

const hasFirstTeamStatSplit = (payload: Record<string, unknown>): boolean => {
  const stats = readNullableArray(payload.stats);
  const firstStatsBlock = stats && stats.length > 0 ? readNullableRecord(stats[0]) : null;
  const splits = readNullableArray(firstStatsBlock?.splits);
  const firstSplit = splits && splits.length > 0 ? readNullableRecord(splits[0]) : null;

  return readNullableRecord(firstSplit?.stat) !== null;
};

const hasReliefPitchingSplit = (payload: Record<string, unknown>): boolean => {
  const stats = readNullableArray(payload.stats);
  const firstStatsBlock = stats && stats.length > 0 ? readNullableRecord(stats[0]) : null;
  const splits = readNullableArray(firstStatsBlock?.splits);

  if (!splits) {
    return false;
  }

  for (const split of splits) {
    const splitRecord = readNullableRecord(split);
    const splitMetadata = readNullableRecord(splitRecord?.split);

    if (splitMetadata?.code === "rp" && readNullableRecord(splitRecord?.stat) !== null) {
      return true;
    }
  }

  return false;
};

const fetchMlbStatsApiJsonObject = async (
  url: string,
  label: string
): Promise<JsonObjectResult> => {
  const { response, error: fetchError } = await fetchWithTimeout(url, {
    method: "GET",
    headers: {
      Accept: "application/json"
    },
    cache: "no-store"
  });

  if (!response) {
    return {
      success: false,
      error: `${label} ${fetchError}`
    };
  }

  if (!response.ok) {
    return {
      success: false,
      error: `${label} request failed with status ${response.status}`
    };
  }

  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    return {
      success: false,
      error: `${label} response was not valid JSON`
    };
  }

  if (!isRecord(payload)) {
    return {
      success: false,
      error: `${label} response must be an object`
    };
  }

  if (!hasStatsArray(payload)) {
    return {
      success: false,
      error: `${label} response missing stats array`
    };
  }

  return { success: true, data: payload };
};

const fetchMlbStatsApiTeamSeasonHitting = async (
  teamId: number,
  season: string
): Promise<JsonObjectResult> => {
  const searchParams = new URLSearchParams({
    stats: "season",
    group: "hitting",
    season,
    gameType: "R"
  });

  const fetched = await fetchMlbStatsApiJsonObject(
    `${MLB_STATS_API_TEAM_ENDPOINT}/${teamId}/stats?${searchParams.toString()}`,
    `MLB Stats API team season hitting stats for ${teamId}`
  );

  if (!fetched.success) {
    return fetched;
  }

  if (!hasFirstTeamStatSplit(fetched.data)) {
    return {
      success: false,
      error: `MLB Stats API team season hitting stats for ${teamId} missing first stat split`
    };
  }

  return fetched;
};

const fetchMlbStatsApiTeamReliefPitching = async (
  teamId: number,
  season: string
): Promise<JsonObjectResult> => {
  const searchParams = new URLSearchParams({
    stats: "statSplits",
    group: "pitching",
    season,
    gameType: "R",
    sitCodes: "rp"
  });

  const fetched = await fetchMlbStatsApiJsonObject(
    `${MLB_STATS_API_TEAM_ENDPOINT}/${teamId}/stats?${searchParams.toString()}`,
    `MLB Stats API team reliever pitching split for ${teamId}`
  );

  if (!fetched.success) {
    return fetched;
  }

  if (!hasReliefPitchingSplit(fetched.data)) {
    return {
      success: false,
      error: `MLB Stats API team reliever pitching split for ${teamId} missing rp split`
    };
  }

  return fetched;
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

export interface LiveSlatePlayerIdentity {
  readonly player_id: PlayerId;
  readonly full_name: string | null;
  readonly position: PlayerPosition;
  readonly batting_order: number | null;
}

export interface LiveSlateScoreState {
  readonly away_score: number | null;
  readonly home_score: number | null;
  readonly inning_number: number | null;
  readonly inning_state: "top" | "middle" | "bottom" | "end" | null;
  readonly is_live: boolean;
  readonly is_final: boolean;
  readonly display_state: string | null;
}

export interface LiveSlateSourceGame {
  readonly parsedGame: MlbStatsApiScheduleGame;
  readonly canonicalGame: CanonicalGame;
  readonly preparedGame: PreparedGameInputs;
  readonly playerIdentities: Readonly<Record<string, LiveSlatePlayerIdentity>>;
  readonly liveScoreState: LiveSlateScoreState;
}

export interface LiveSlateCounts {
  readonly fetched_raw: number;
  readonly parsed: number;
  readonly normalized: number;
  readonly prepared: number;
  readonly boxscore_enriched: number;
}

export interface LoadedLiveSlate {
  readonly source: "mlb-statsapi-live";
  readonly date: string;
  readonly generated_at: string;
  readonly counts: LiveSlateCounts;
  readonly note: string | null;
  readonly games: readonly LiveSlateSourceGame[];
}

const mergePlayerIdentity = (
  existing: LiveSlatePlayerIdentity | undefined,
  incoming: LiveSlatePlayerIdentity
): LiveSlatePlayerIdentity => ({
  player_id: incoming.player_id,
  full_name: existing?.full_name ?? incoming.full_name,
  position: existing && existing.position !== "unknown" ? existing.position : incoming.position,
  batting_order: existing?.batting_order ?? incoming.batting_order
});

const buildPlayerIdentitiesFromTeamBlock = (
  teamBlock: Record<string, unknown>
): readonly LiveSlatePlayerIdentity[] => {
  const players = readNullableRecord(teamBlock.players);

  if (!players) {
    return [];
  }

  const identities: LiveSlatePlayerIdentity[] = [];

  for (const player of Object.values(players)) {
    const playerRecord = readNullableRecord(player);
    const person = readNullableRecord(playerRecord?.person);
    const position = readNullableRecord(playerRecord?.position);
    const playerId = parsePlayerId(person?.id);

    if (!playerRecord || !person || !playerId) {
      continue;
    }

    identities.push({
      player_id: playerId,
      full_name: readNullableString(person.fullName),
      position: parsePlayerPosition(position?.abbreviation),
      batting_order: parseBattingOrderSlot(playerRecord.battingOrder)
    });
  }

  return identities;
};

const buildFallbackPitcherIdentity = (
  parsedPitcher: MlbStatsApiScheduleGame["teams"]["away"]["probablePitcher"],
  canonicalPitcher: CanonicalGame["away"]["probable_pitcher"]
): LiveSlatePlayerIdentity | null => {
  if (!canonicalPitcher) {
    return null;
  }

  return {
    player_id: canonicalPitcher.player_id,
    full_name: parsedPitcher?.fullName ?? null,
    position: "P",
    batting_order: null
  };
};

const buildPlayerIdentitiesFromBoxscore = (
  boxscore: unknown
): Result<
  {
    readonly away: readonly LiveSlatePlayerIdentity[];
    readonly home: readonly LiveSlatePlayerIdentity[];
  },
  string
> => {
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

  return ok({
    away: buildPlayerIdentitiesFromTeamBlock(awayTeamBlock.data),
    home: buildPlayerIdentitiesFromTeamBlock(homeTeamBlock.data)
  });
};

const buildProjectedStarterIdentity = (
  starter: ProjectedGameData["away_starter"]
): LiveSlatePlayerIdentity | null => {
  const fullName = starter?.full_name?.trim();

  if (!starter || !fullName) {
    return null;
  }

  return {
    player_id: starter.player_id,
    full_name: fullName,
    position: "P",
    batting_order: null
  };
};

const buildPlayerIdentityMap = (
  sourceGame: NormalizedGameEntry,
  boxscore: unknown | null,
  projectedGame: ProjectedGameData | null
): Readonly<Record<string, LiveSlatePlayerIdentity>> => {
  const identityMap: Record<string, LiveSlatePlayerIdentity> = {};

  const fallbackIdentities = [
    buildFallbackPitcherIdentity(
      sourceGame.parsedGame.teams.away.probablePitcher,
      sourceGame.normalizedGame.away.probable_pitcher
    ),
    buildFallbackPitcherIdentity(
      sourceGame.parsedGame.teams.home.probablePitcher,
      sourceGame.normalizedGame.home.probable_pitcher
    )
  ];

  for (const fallbackIdentity of fallbackIdentities) {
    if (!fallbackIdentity) {
      continue;
    }

    identityMap[fallbackIdentity.player_id] = fallbackIdentity;
  }

  if (boxscore !== null) {
    const boxscoreIdentities = buildPlayerIdentitiesFromBoxscore(boxscore);

    if (boxscoreIdentities.success) {
      for (const identity of [...boxscoreIdentities.data.away, ...boxscoreIdentities.data.home]) {
        identityMap[identity.player_id] = mergePlayerIdentity(
          identityMap[identity.player_id],
          identity
        );
      }
    }
  }

  for (const identity of [
    buildProjectedStarterIdentity(projectedGame?.away_starter ?? null),
    buildProjectedStarterIdentity(projectedGame?.home_starter ?? null)
  ]) {
    if (!identity) {
      continue;
    }

    identityMap[identity.player_id] = mergePlayerIdentity(
      identityMap[identity.player_id],
      identity
    );
  }

  return identityMap;
};

const patchCanonicalTeamProbablePitcherFromActualStarter = (
  teamContext: CanonicalGame["away"],
  actualStarter: PreparedGameInputs["away_starter"]
): CanonicalGame["away"] => {
  if (actualStarter === null) {
    return teamContext;
  }

  return {
    ...teamContext,
    probable_pitcher: {
      player_id: actualStarter.player_id,
      mlb_stats_api_id: actualStarter.mlb_stats_api_id,
      starting_status: "confirmed",
      handedness: actualStarter.handedness
    }
  };
};

const applyRuntimeActualStarterPatch = (
  canonicalGame: CanonicalGame,
  extractedData: Pick<GamePreparationData, "away_starter" | "home_starter">
): CanonicalGame => {
  const away = patchCanonicalTeamProbablePitcherFromActualStarter(
    canonicalGame.away,
    extractedData.away_starter
  );
  const home = patchCanonicalTeamProbablePitcherFromActualStarter(
    canonicalGame.home,
    extractedData.home_starter
  );

  if (away === canonicalGame.away && home === canonicalGame.home) {
    return canonicalGame;
  }

  return {
    ...canonicalGame,
    away,
    home
  };
};

const readBoxscoreTeamRuns = (
  boxscore: unknown,
  side: "away" | "home"
): number | null => {
  const boxscoreRecord = readNullableRecord(boxscore);
  const teamBlock = readNullableRecord(readNullableRecord(boxscoreRecord?.teams)?.[side]);
  const teamStats = readNullableRecord(teamBlock?.teamStats);
  const batting = readNullableRecord(teamStats?.batting);

  return readNullableNumber(batting?.runs);
};

const mapInningState = (
  inningState: string | null
): LiveSlateScoreState["inning_state"] => {
  switch (inningState?.trim().toLowerCase()) {
    case "top":
      return "top";
    case "middle":
      return "middle";
    case "bottom":
      return "bottom";
    case "end":
      return "end";
    default:
      return null;
  }
};

export const buildLiveSlateScoreState = ({
  sourceGame,
  boxscore,
  linescore
}: {
  readonly sourceGame: NormalizedGameEntry;
  readonly boxscore: unknown | null;
  readonly linescore:
    | {
        readonly currentInning: number | null;
        readonly currentInningOrdinal: string | null;
        readonly inningState: string | null;
        readonly teams: {
          readonly away: { readonly runs: number | null };
          readonly home: { readonly runs: number | null };
        };
      }
    | null;
}): LiveSlateScoreState => {
  const status = sourceGame.normalizedGame.status;
  const isLive = status === "in_progress";
  const isFinal = status === "final";
  const inningState = mapInningState(linescore?.inningState ?? null);
  const inningOrdinal = linescore?.currentInningOrdinal?.trim() ?? null;

  return {
    away_score: linescore?.teams.away.runs ?? readBoxscoreTeamRuns(boxscore, "away"),
    home_score: linescore?.teams.home.runs ?? readBoxscoreTeamRuns(boxscore, "home"),
    inning_number: linescore?.currentInning ?? null,
    inning_state: inningState,
    is_live: isLive,
    is_final: isFinal,
    display_state:
      isLive && inningState !== null && inningOrdinal
        ? `${linescore?.inningState} ${inningOrdinal}`
        : sourceGame.parsedGame.status.detailedState ?? null
  };
};

export const getUtcDateString = (): string => new Date().toISOString().slice(0, 10);

export interface LoadLiveSlateOptions {
  readonly materializedBaseline?: MaterializedSlate | undefined;
  /**
   * Optional projected game data keyed by game_id.
   * When provided, the merge law (official > projected > inferred) determines
   * which starter identity feeds preparation.  When absent, official-only
   * behavior is preserved — zero change from the pre-merge path.
   */
  readonly projectedGames?: ReadonlyMap<GameId, ProjectedGameData> | undefined;
  /**
   * Optional inferred game data keyed by game_id.
   * Same merge semantics as projectedGames.
   */
  readonly inferredGames?: ReadonlyMap<GameId, InferredGameData> | undefined;
  /**
   * Optional owned Starter Intelligence, keyed by game_id, mapped to the
   * canonical ProjectedGameData shape before reaching this layer.
   *
   * Precedence: projectedGames (Rotowire) wins if an entry exists for the
   * game; starterIntelligenceGames fills the projected slot only when
   * projectedGames has no entry.  The merge law (official > projected >
   * inferred) continues to govern final resolution.
   */
  readonly starterIntelligenceGames?: ReadonlyMap<GameId, ProjectedGameData> | undefined;
}

/** Artifacts older than this threshold are rejected at the load boundary. */
const MATERIALIZED_STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

const isMaterializedStale = (baseline: MaterializedSlate): boolean => {
  const ageMs = Date.now() - new Date(baseline.generated_at).getTime();
  return ageMs > MATERIALIZED_STALE_THRESHOLD_MS;
};

export const loadLiveSlate = async (
  date: string,
  options?: LoadLiveSlateOptions
): Promise<Result<LoadedLiveSlate, string>> => {
  // Fail-closed: reject stale baselines regardless of what the caller passed.
  // This ensures no future caller can accidentally feed stale data.
  const baseline =
    options?.materializedBaseline && !isMaterializedStale(options.materializedBaseline)
      ? options.materializedBaseline
      : undefined;
  const materializedLookup = new Map(
    (baseline?.games ?? []).map((g) => [g.game_id, g.prepared])
  );
  const fetched = await fetchAndParseMlbStatsApiSchedule(date);
  const generatedAt = new Date().toISOString();

  if (!fetched.success) {
    return err(fetched.error);
  }

  const { rawGames, parsedGames } = fetched.data;

  if (rawGames.length === 0) {
    return ok({
      source: "mlb-statsapi-live",
      date,
      generated_at: generatedAt,
      counts: {
        fetched_raw: 0,
        parsed: 0,
        normalized: 0,
        prepared: 0,
        boxscore_enriched: 0
      },
      note: "No MLB games returned for requested date.",
      games: []
    });
  }

  const normalizedGames = parsedGames
    .map<NormalizedGameEntry | null>((game) => {
      const normalized = normalizeMlbStatsApiGame(game);

      if (!normalized.success) {
        return null;
      }

      return {
        parsedGame: game,
        normalizedGame: normalized.data
      };
    })
    .filter((value): value is NormalizedGameEntry => value !== null);

  if (normalizedGames.length === 0) {
    return ok({
      source: "mlb-statsapi-live",
      date,
      generated_at: generatedAt,
      counts: {
        fetched_raw: rawGames.length,
        parsed: parsedGames.length,
        normalized: 0,
        prepared: 0,
        boxscore_enriched: 0
      },
      note: "No supported games normalized for requested date.",
      games: []
    });
  }

  const liveGames: LiveSlateSourceGame[] = [];
  let boxscoreEnriched = 0;

  for (const game of normalizedGames) {
    const [fetchedBoxscore, fetchedLinescore] = await Promise.all([
      fetchMlbStatsApiBoxscore(game.parsedGame.gamePk),
      fetchMlbStatsApiLinescore(game.parsedGame.gamePk)
    ]);
    const boxscorePayload = fetchedBoxscore.success ? fetchedBoxscore.data : null;
    const linescorePayload = fetchedLinescore.success ? fetchedLinescore.data : null;
    const projectedForGame =
      options?.projectedGames?.get(game.normalizedGame.game_id) ??
      options?.starterIntelligenceGames?.get(game.normalizedGame.game_id) ??
      null;
    const playerIdentities = buildPlayerIdentityMap(game, boxscorePayload, projectedForGame);
    const liveScoreState = buildLiveSlateScoreState({
      sourceGame: game,
      boxscore: boxscorePayload,
      linescore: linescorePayload
    });
    // --------------- Source tier merge (A6) ---------------
    // Resolve which starter identity wins per the three-tier merge law.
    // When no projected/inferred data is provided, mergedCanonical is the
    // original canonicalGame — zero behavioral change from the pre-merge path.
    const inferredForGame = options?.inferredGames?.get(game.normalizedGame.game_id) ?? null;
    const merged = resolveGameSources(game.normalizedGame, projectedForGame, inferredForGame);
    const mergedCanonical = applyMergedStartersToCanonical(game.normalizedGame, merged);

    // When a materialized baseline has a matching game, use it as the
    // initial preparedGame.  If live boxscore enrichment succeeds below,
    // it fully overrides this with fresh data.  When no baseline match
    // exists, this is identical to the pre-A2 path.
    let preparedGame =
      materializedLookup.get(game.normalizedGame.game_id) ??
      prepareGameInputs(mergedCanonical);
    // Track which canonical is authoritative for this game. Starts as
    // mergedCanonical (merge-law result). Updated to reconcileCanonical when
    // boxscore enrichment runs — that version back-fills numeric starter IDs
    // and patches actual starters from live data.
    let liveCanonical: CanonicalGame = mergedCanonical;

    if (fetchedBoxscore.success) {
      const extracted = extractPreparedGameDataFromBoxscore(
        fetchedBoxscore.data,
        game.normalizedGame
      );

      if (extracted.success) {
        const season = game.parsedGame.gameDate.slice(0, 4);
        const awayTeamId = readNullableNumber(game.parsedGame.teams.away.team.id);
        const homeTeamId = readNullableNumber(game.parsedGame.teams.home.team.id);
        const awayProbableNumericId =
          extracted.data.away_starter === null
            ? readNullableNumber(game.parsedGame.teams.away.probablePitcher?.id) ??
              findBoxscorePlayerNumericId(
                fetchedBoxscore.data,
                "away",
                mergedCanonical.away.probable_pitcher?.player_id ?? null
              )
            : null;
        const homeProbableNumericId =
          extracted.data.home_starter === null
            ? readNullableNumber(game.parsedGame.teams.home.probablePitcher?.id) ??
              findBoxscorePlayerNumericId(
                fetchedBoxscore.data,
                "home",
                mergedCanonical.home.probable_pitcher?.player_id ?? null
              )
            : null;

        const [
          awaySeasonHitting,
          homeSeasonHitting,
          awayReliefPitching,
          homeReliefPitching,
          awayPitcherStats,
          homePitcherStats
        ] = await Promise.all([
          awayTeamId !== null
            ? fetchMlbStatsApiTeamSeasonHitting(awayTeamId, season)
            : Promise.resolve({ success: false as const, error: "no away team id" }),
          homeTeamId !== null
            ? fetchMlbStatsApiTeamSeasonHitting(homeTeamId, season)
            : Promise.resolve({ success: false as const, error: "no home team id" }),
          awayTeamId !== null
            ? fetchMlbStatsApiTeamReliefPitching(awayTeamId, season)
            : Promise.resolve({ success: false as const, error: "no away team id" }),
          homeTeamId !== null
            ? fetchMlbStatsApiTeamReliefPitching(homeTeamId, season)
            : Promise.resolve({ success: false as const, error: "no home team id" }),
          awayProbableNumericId !== null
            ? fetchMlbStatsApiPitcherSeasonStats(awayProbableNumericId, season)
            : Promise.resolve({ success: false as const, error: "away starter already extracted" }),
          homeProbableNumericId !== null
            ? fetchMlbStatsApiPitcherSeasonStats(homeProbableNumericId, season)
            : Promise.resolve({ success: false as const, error: "home starter already extracted" })
        ]);

        // Use mergedCanonical for starter identity: when a non-official tier
        // won the merge, mergedCanonical.probable_pitcher reflects that winner.
        const awayStarterFromStats =
          awayPitcherStats.success && mergedCanonical.away.probable_pitcher !== null
            ? buildPreparedStarterFromPeopleStats(
                mergedCanonical.away.probable_pitcher.player_id,
                mergedCanonical.away.team.team_id,
                awayPitcherStats.data,
                mergedCanonical.away.probable_pitcher.mlb_stats_api_id
              )
            : null;

        const homeStarterFromStats =
          homePitcherStats.success && mergedCanonical.home.probable_pitcher !== null
            ? buildPreparedStarterFromPeopleStats(
                mergedCanonical.home.probable_pitcher.player_id,
                mergedCanonical.home.team.team_id,
                homePitcherStats.data,
                mergedCanonical.home.probable_pitcher.mlb_stats_api_id
              )
            : null;

        // Fall back to projected lineup entries when the boxscore has no
        // batting-order data (pre-game state).  When the boxscore already
        // carries batters, those always win — they are higher fidelity.
        const awayBattersForEnrich =
          extracted.data.away_batters.length > 0
            ? extracted.data.away_batters
            : (merged.away.lineup?.entries.map(buildProjectedBatterInputs) ?? []);
        const homeBattersForEnrich =
          extracted.data.home_batters.length > 0
            ? extracted.data.home_batters
            : (merged.home.lineup?.entries.map(buildProjectedBatterInputs) ?? []);

        // Enrich projected-lineup batters (identified by null season_avg) with
        // real season batting stats from the MLB Stats API.  Numeric player IDs
        // are resolved from the pre-game boxscore roster, which carries player
        // entries even before batting-order data exists.  Fails closed: batters
        // whose IDs cannot be resolved or whose stat fetch fails remain as-is.
        const enrichSide = async (
          batters: readonly PreparedBatterInputs[],
          side: "away" | "home"
        ): Promise<readonly PreparedBatterInputs[]> => {
          if (!batters.some(b => b.season_avg === null)) return batters;
          return Promise.all(
            batters.map(async b => {
              if (b.season_avg !== null) return b;
              const numericId = findBoxscorePlayerNumericId(fetchedBoxscore.data, side, b.player_id);
              if (numericId === null) return b;
              const result = await fetchMlbStatsApiBatterSeasonStats(numericId, season);
              return result.success ? buildPreparedBatterFromPeopleStats(b, result.data, numericId) : b;
            })
          );
        };

        const [enrichedAwayBatters, enrichedHomeBatters] = await Promise.all([
          enrichSide(awayBattersForEnrich, "away"),
          enrichSide(homeBattersForEnrich, "home")
        ]);

        const enrichedData: GamePreparationData = {
          ...extracted.data,
          away_starter: extracted.data.away_starter ?? awayStarterFromStats,
          home_starter: extracted.data.home_starter ?? homeStarterFromStats,
          away_batters: enrichedAwayBatters,
          home_batters: enrichedHomeBatters,
          ...(awaySeasonHitting.success
            ? { away_team_season_hitting: awaySeasonHitting.data }
            : {}),
          ...(homeSeasonHitting.success
            ? { home_team_season_hitting: homeSeasonHitting.data }
            : {}),
          ...(awayReliefPitching.success
            ? { away_team_relief_pitching: awayReliefPitching.data }
            : {}),
          ...(homeReliefPitching.success
            ? { home_team_relief_pitching: homeReliefPitching.data }
            : {})
        };

        // Back-fill mlb_stats_api_id on the merged canonical probable pitchers
        // when a non-official tier won and left the field null (slug-only ID
        // from Rotowire/inferred source).  findBoxscorePlayerNumericId resolves
        // the slug → numeric mapping via slugifyPlayerName(fullName) so the
        // reconciliation check in prepareGameInputs can compare on a shared key.
        // This is read-only enrichment — it does not change the winning tier or
        // the player_id; it only fills a missing numeric cross-reference.
        let reconcileCanonical = applyRuntimeActualStarterPatch(mergedCanonical, extracted.data);
        const awayNeedsNumericId =
          mergedCanonical.away.probable_pitcher !== null &&
          reconcileCanonical.away.probable_pitcher !== null &&
          reconcileCanonical.away.probable_pitcher.mlb_stats_api_id === null;
        const homeNeedsNumericId =
          mergedCanonical.home.probable_pitcher !== null &&
          reconcileCanonical.home.probable_pitcher !== null &&
          reconcileCanonical.home.probable_pitcher.mlb_stats_api_id === null;
        if (awayNeedsNumericId || homeNeedsNumericId) {
          const awayNumericId = awayNeedsNumericId
            ? findBoxscorePlayerNumericId(
                fetchedBoxscore.data,
                "away",
                reconcileCanonical.away.probable_pitcher!.player_id
              )
            : null;
          const homeNumericId = homeNeedsNumericId
            ? findBoxscorePlayerNumericId(
                fetchedBoxscore.data,
                "home",
                reconcileCanonical.home.probable_pitcher!.player_id
              )
            : null;
          if (awayNumericId !== null || homeNumericId !== null) {
            const patchedAway =
              awayNumericId !== null && reconcileCanonical.away.probable_pitcher !== null
                ? {
                    ...reconcileCanonical.away,
                    probable_pitcher: {
                      ...reconcileCanonical.away.probable_pitcher,
                      mlb_stats_api_id: String(awayNumericId)
                    }
                  }
                : reconcileCanonical.away;
            const patchedHome =
              homeNumericId !== null && reconcileCanonical.home.probable_pitcher !== null
                ? {
                    ...reconcileCanonical.home,
                    probable_pitcher: {
                      ...reconcileCanonical.home.probable_pitcher,
                      mlb_stats_api_id: String(homeNumericId)
                    }
                  }
                : reconcileCanonical.home;
            reconcileCanonical = {
              ...reconcileCanonical,
              away: patchedAway,
              home: patchedHome
            };
          }
        }
        preparedGame = prepareGameInputs(reconcileCanonical, enrichedData);
        liveCanonical = reconcileCanonical;
        boxscoreEnriched++;
      }
    }

    liveGames.push({
      parsedGame: game.parsedGame,
      canonicalGame: liveCanonical,
      preparedGame,
      playerIdentities,
      liveScoreState
    });
  }

  return ok({
    source: "mlb-statsapi-live",
    date,
    generated_at: generatedAt,
    counts: {
      fetched_raw: rawGames.length,
      parsed: parsedGames.length,
      normalized: normalizedGames.length,
      prepared: liveGames.length,
      boxscore_enriched: boxscoreEnriched
    },
    note: null,
    games: liveGames
  });
};
