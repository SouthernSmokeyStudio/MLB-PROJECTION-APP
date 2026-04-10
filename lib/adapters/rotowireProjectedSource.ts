/**
 * rotowireProjectedSource.ts
 *
 * First real projected-source provider adapter, implementing the A3
 * ProjectedSourceAdapter contract for Rotowire-shaped projected lineups.
 *
 * Provider choice rationale:
 * - Rotowire is the industry-standard projected lineup source in the
 *   MLB DFS ecosystem, widely consumed by DraftKings, FanDuel, and
 *   most projection model pipelines.
 * - Their daily lineup data includes projected batting orders, positions,
 *   and starting pitchers — the exact shape our contract requires.
 *
 * Legal/operational note:
 * - All provider-specific parsing is isolated inside this adapter.
 * - The endpoint URL is configurable (injected at construction time),
 *   so the adapter can be pointed at any Rotowire-compatible feed
 *   (official API, licensed data proxy, or local fixture file).
 * - No Rotowire-specific types or field names leak past the adapter
 *   boundary into canonical contracts.
 *
 * Provider response shape (expected):
 * The adapter expects a JSON array of game objects from the provider.
 * Each game object has Rotowire-specific field names that are normalized
 * at the adapter boundary.  See parseRotowirePayload for the exact shape.
 */

import type {
  ProjectedGameData,
  ProjectedLineupEntry,
  ProjectedSourceAdapter,
  ProjectedSourceResult,
  ProjectedStarter
} from "@lib/contracts/projected-source";
import {
  asGameId,
  asISOTimestamp,
  asPlayerId,
  asTeamId,
  err,
  ok,
  type GameId,
  type Handedness,
  type PlayerPosition,
  type Result,
  type StartingStatus,
  type TeamId
} from "@lib/contracts/types";
import { fetchWithTimeout } from "./fetchWithTimeout";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface RotowireProjectedSourceOptions {
  /**
   * Full URL to fetch the projected lineup JSON from.
   * This is injected so the adapter works with any Rotowire-compatible
   * feed — official API, licensed proxy, or local test server.
   */
  readonly endpointUrl: string;
  /** Optional fetch timeout override (default: 15s via fetchWithTimeout). */
  readonly timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Provider-specific types (NEVER exported — stay inside the adapter)
// ---------------------------------------------------------------------------

/** A single player entry in Rotowire's lineup array. */
interface RwLineupPlayer {
  readonly name: string;
  readonly batting_order: number;
  readonly position: string;
  readonly hand: string;
}

/** A single game from the Rotowire response. */
interface RwGame {
  readonly away_team: string;
  readonly home_team: string;
  readonly game_date: string;
  readonly away_starter: RwStarter | null;
  readonly home_starter: RwStarter | null;
  readonly away_lineup: readonly RwLineupPlayer[] | null;
  readonly home_lineup: readonly RwLineupPlayer[] | null;
}

/** A starter entry from the Rotowire response. */
interface RwStarter {
  readonly name: string;
  readonly hand: string;
  readonly status: string;
}

// ---------------------------------------------------------------------------
// Team abbreviation normalization (Rotowire → canonical)
// ---------------------------------------------------------------------------

/**
 * Known Rotowire abbreviation divergences mapped to our canonical set.
 * Rotowire typically uses standard abbreviations, but a few drift:
 *   WSH/WAS divergence, OAK → ATH (name change), etc.
 */
const RW_ABBREVIATION_TO_CANONICAL: Readonly<Record<string, string>> = {
  WAS: "WSH",
  OAK: "ATH",
  SFG: "SF",
  TBR: "TB",
  KCR: "KC",
  SDG: "SD",
  ANA: "LAA",
  CHW: "CWS",
  WSN: "WSH"
};

const CANONICAL_ABBREVIATIONS: ReadonlySet<string> = new Set([
  "LAA", "ARI", "BAL", "BOS", "CHC", "CIN", "CLE", "COL",
  "DET", "HOU", "KC", "LAD", "WSH", "NYM", "ATH", "PIT",
  "SD", "SEA", "SF", "STL", "TB", "TEX", "TOR", "MIN",
  "PHI", "ATL", "CWS", "MIA", "NYY", "MIL"
]);

/**
 * Lowercase canonical abbreviation → TeamId mapping.
 * This mirrors TEAM_METADATA.team_id_raw from the normalizer.
 */
const ABBREVIATION_TO_TEAM_ID: Readonly<Record<string, string>> = {
  LAA: "laa", ARI: "ari", BAL: "bal", BOS: "bos", CHC: "chc",
  CIN: "cin", CLE: "cle", COL: "col", DET: "det", HOU: "hou",
  KC: "kc", LAD: "lad", WSH: "wsh", NYM: "nym", ATH: "ath",
  PIT: "pit", SD: "sd", SEA: "sea", SF: "sf", STL: "stl",
  TB: "tb", TEX: "tex", TOR: "tor", MIN: "min", PHI: "phi",
  ATL: "atl", CWS: "cws", MIA: "mia", NYY: "nyy", MIL: "mil"
};

const normalizeTeamAbbreviation = (
  raw: string
): { canonical: string; teamId: TeamId } | null => {
  const upper = raw.trim().toUpperCase();
  const mapped = RW_ABBREVIATION_TO_CANONICAL[upper] ?? upper;

  if (!CANONICAL_ABBREVIATIONS.has(mapped)) {
    return null;
  }

  const teamIdRaw = ABBREVIATION_TO_TEAM_ID[mapped];
  if (!teamIdRaw) return null;

  return { canonical: mapped, teamId: asTeamId(teamIdRaw) };
};

// ---------------------------------------------------------------------------
// Field normalization helpers
// ---------------------------------------------------------------------------

const slugifyPlayerName = (name: string): string =>
  name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const normalizeHandedness = (hand: string): Handedness => {
  const h = hand.trim().toUpperCase();
  if (h === "L" || h === "LEFT") return "L";
  if (h === "R" || h === "RIGHT") return "R";
  if (h === "S" || h === "SWITCH") return "S";
  return "unknown";
};

const normalizeStartingStatus = (status: string): StartingStatus => {
  const s = status.trim().toLowerCase();
  if (s === "confirmed" || s === "official") return "confirmed";
  if (s === "expected" || s === "likely") return "expected";
  if (s === "probable") return "probable";
  return "unknown";
};

const VALID_POSITIONS: ReadonlySet<string> = new Set([
  "P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "DH", "UTIL"
]);

const normalizePosition = (pos: string): PlayerPosition => {
  const p = pos.trim().toUpperCase();
  if (VALID_POSITIONS.has(p)) return p as PlayerPosition;
  return "unknown";
};

const buildGameId = (date: string, awayAbbr: string, homeAbbr: string): GameId =>
  asGameId(`mlb-${date}-${awayAbbr.toLowerCase()}-${homeAbbr.toLowerCase()}`);

// ---------------------------------------------------------------------------
// Payload parsing — PROVIDER-SPECIFIC, isolated to this module
// ---------------------------------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const readNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const parseRwStarter = (raw: unknown): RwStarter | null => {
  if (!isRecord(raw)) return null;
  const name = readString(raw.name);
  const hand = readString(raw.hand);
  const status = readString(raw.status);
  if (!name || !hand || !status) return null;
  return { name, hand, status };
};

const parseRwLineupPlayer = (raw: unknown): RwLineupPlayer | null => {
  if (!isRecord(raw)) return null;
  const name = readString(raw.name);
  const battingOrder = readNumber(raw.batting_order);
  const position = readString(raw.position);
  const hand = readString(raw.hand);
  if (!name || battingOrder === null || !position || !hand) return null;
  return { name, batting_order: battingOrder, position, hand };
};

/**
 * Parse a single Rotowire game entry.
 * Returns err if the entry or any of its lineup players are malformed.
 * Fail-closed: one bad field → entire entry rejected → entire payload rejected.
 */
const parseRwGame = (raw: unknown, index: number): Result<RwGame, string> => {
  if (!isRecord(raw)) return err(`Game entry at index ${index} is not an object`);
  const awayTeam = readString(raw.away_team);
  const homeTeam = readString(raw.home_team);
  const gameDate = readString(raw.game_date);
  if (!awayTeam || !homeTeam || !gameDate)
    return err(`Game entry at index ${index} missing required fields (away_team, home_team, game_date)`);

  const awayStarter = parseRwStarter(raw.away_starter);
  const homeStarter = parseRwStarter(raw.home_starter);

  const rawAwayLineup = Array.isArray(raw.away_lineup) ? raw.away_lineup : null;
  const rawHomeLineup = Array.isArray(raw.home_lineup) ? raw.home_lineup : null;

  // Strict: every lineup player must parse cleanly
  let awayLineup: readonly RwLineupPlayer[] | null = null;
  if (rawAwayLineup) {
    const parsed: RwLineupPlayer[] = [];
    for (let j = 0; j < rawAwayLineup.length; j++) {
      const player = parseRwLineupPlayer(rawAwayLineup[j]);
      if (!player)
        return err(`Game at index ${index}: away_lineup player at index ${j} is malformed`);
      parsed.push(player);
    }
    awayLineup = parsed.length > 0 ? parsed : null;
  }

  let homeLineup: readonly RwLineupPlayer[] | null = null;
  if (rawHomeLineup) {
    const parsed: RwLineupPlayer[] = [];
    for (let j = 0; j < rawHomeLineup.length; j++) {
      const player = parseRwLineupPlayer(rawHomeLineup[j]);
      if (!player)
        return err(`Game at index ${index}: home_lineup player at index ${j} is malformed`);
      parsed.push(player);
    }
    homeLineup = parsed.length > 0 ? parsed : null;
  }

  return ok({
    away_team: awayTeam,
    home_team: homeTeam,
    game_date: gameDate,
    away_starter: awayStarter,
    home_starter: homeStarter,
    away_lineup: awayLineup,
    home_lineup: homeLineup
  });
};

/**
 * Parse the full Rotowire response payload into validated RwGame[].
 *
 * Fail-closed: if ANY game entry is malformed (missing required fields,
 * non-object entry, or malformed lineup player), the entire payload is
 * rejected with err.  The adapter does not silently skip bad entries.
 */
export const parseRotowirePayload = (
  payload: unknown
): Result<readonly RwGame[], string> => {
  if (!Array.isArray(payload)) {
    return err("Rotowire response must be a JSON array of games");
  }

  const games: RwGame[] = [];
  for (let i = 0; i < payload.length; i++) {
    const parsed = parseRwGame(payload[i], i);
    if (!parsed.success) {
      return err(parsed.error);
    }
    games.push(parsed.data);
  }

  return ok(games);
};

// ---------------------------------------------------------------------------
// Normalization — RwGame → ProjectedGameData
// ---------------------------------------------------------------------------

const normalizeRwStarter = (
  rwStarter: RwStarter,
  teamId: TeamId
): ProjectedStarter => ({
  player_id: asPlayerId(slugifyPlayerName(rwStarter.name)),
  team_id: teamId,
  handedness: normalizeHandedness(rwStarter.hand),
  starting_status: normalizeStartingStatus(rwStarter.status),
  confidence: rwStarter.status.toLowerCase() === "confirmed" ? "high" : "medium"
});

const normalizeRwLineup = (
  rwLineup: readonly RwLineupPlayer[],
  teamId: TeamId
): readonly ProjectedLineupEntry[] =>
  rwLineup.map((player) => ({
    player_id: asPlayerId(slugifyPlayerName(player.name)),
    team_id: teamId,
    batting_order: player.batting_order,
    position: normalizePosition(player.position),
    starting_status: "expected" as StartingStatus
  }));

const normalizeRwGame = (
  rwGame: RwGame,
  index: number
): Result<ProjectedGameData, string> => {
  const awayNorm = normalizeTeamAbbreviation(rwGame.away_team);
  const homeNorm = normalizeTeamAbbreviation(rwGame.home_team);

  if (!awayNorm)
    return err(`Game at index ${index}: unrecognized away team abbreviation "${rwGame.away_team}"`);
  if (!homeNorm)
    return err(`Game at index ${index}: unrecognized home team abbreviation "${rwGame.home_team}"`);

  return ok({
    game_id: buildGameId(rwGame.game_date, awayNorm.canonical, homeNorm.canonical),
    away_starter: rwGame.away_starter
      ? normalizeRwStarter(rwGame.away_starter, awayNorm.teamId)
      : null,
    home_starter: rwGame.home_starter
      ? normalizeRwStarter(rwGame.home_starter, homeNorm.teamId)
      : null,
    away_lineup: rwGame.away_lineup
      ? normalizeRwLineup(rwGame.away_lineup, awayNorm.teamId)
      : null,
    home_lineup: rwGame.home_lineup
      ? normalizeRwLineup(rwGame.home_lineup, homeNorm.teamId)
      : null
  });
};

// ---------------------------------------------------------------------------
// Public adapter factory
// ---------------------------------------------------------------------------

export const createRotowireProjectedSourceAdapter = (
  options: RotowireProjectedSourceOptions
): ProjectedSourceAdapter => ({
  source: "rotowire",

  async fetchProjectedData(
    date: string
  ): Promise<Result<ProjectedSourceResult, string>> {
    const fetchedAt = asISOTimestamp(new Date().toISOString());

    const { response, error: fetchError } = await fetchWithTimeout(
      options.endpointUrl,
      {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
        ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {})
      }
    );

    if (!response) {
      return err(`Rotowire projected lineups fetch failed: ${fetchError}`);
    }

    if (!response.ok) {
      return err(
        `Rotowire projected lineups returned HTTP ${response.status}`
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return err("Rotowire projected lineups response was not valid JSON");
    }

    const parsed = parseRotowirePayload(payload);
    if (!parsed.success) {
      return err(parsed.error);
    }

    const games: ProjectedGameData[] = [];
    for (let i = 0; i < parsed.data.length; i++) {
      const normalized = normalizeRwGame(parsed.data[i]!, i);
      if (!normalized.success) {
        return err(normalized.error);
      }
      games.push(normalized.data);
    }

    return ok({
      provider_meta: {
        provider: "rotowire",
        fetched_at: fetchedAt,
        source_url: options.endpointUrl
      },
      date,
      generated_at: fetchedAt,
      games
    });
  }
});
