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
 *   (official page, licensed data proxy, or local fixture file).
 * - No Rotowire-specific types or field names leak past the adapter
 *   boundary into canonical contracts.
 *
 * Provider response shape (expected):
 * The adapter expects an HTML page from Rotowire's daily lineups page.
 * Each game card is a <div class="lineup is-mlb"> with team abbreviations,
 * pitcher highlights, lineup status, and batting order players.
 * See parseRotowireHtml for the exact extraction logic.
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
   * Full URL to fetch the projected lineups page from.
   * This is injected so the adapter works with any Rotowire-compatible
   * feed — official page, licensed proxy, or local test server.
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

const normalizeHandedness = (hand: string): Result<Handedness, string> => {
  const h = hand.trim().toUpperCase();
  if (h === "" || h === "UNKNOWN") return ok("unknown");
  if (h === "L" || h === "LEFT") return ok("L");
  if (h === "R" || h === "RIGHT") return ok("R");
  if (h === "S" || h === "SWITCH") return ok("S");
  return err(`unrecognized handedness value: "${h}"`);
};

const normalizeStartingStatus = (status: string): Result<StartingStatus, string> => {
  const s = status.trim().toLowerCase();
  if (s === "" || s === "unknown") return ok("unknown");
  if (s === "confirmed" || s === "official") return ok("confirmed");
  if (s === "expected" || s === "likely") return ok("expected");
  if (s === "probable") return ok("probable");
  return err(`unrecognized starting status value: "${s}"`);
};

const VALID_POSITIONS: ReadonlySet<string> = new Set([
  "P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "DH", "UTIL"
]);

const normalizePosition = (pos: string): Result<PlayerPosition, string> => {
  const p = pos.trim().toUpperCase();
  if (p === "" || p === "UNKNOWN") return ok("unknown");
  if (VALID_POSITIONS.has(p)) return ok(p as PlayerPosition);
  return err(`unrecognized position value: "${p}"`);
};

const buildGameId = (date: string, awayAbbr: string, homeAbbr: string): GameId =>
  asGameId(`mlb-${date}-${awayAbbr.toLowerCase()}-${homeAbbr.toLowerCase()}`);

// ---------------------------------------------------------------------------
// HTML parsing helpers — PROVIDER-SPECIFIC, isolated to this module
// ---------------------------------------------------------------------------

/**
 * Extract player name slug from a Rotowire player URL path.
 * e.g., "simeon-woods-richardson-15499" → "simeon-woods-richardson"
 * The trailing number is the Rotowire player ID.
 */
const extractPlayerSlug = (hrefSlug: string): string =>
  hrefSlug.replace(/-\d+$/, "");

/**
 * Convert a slug to a space-separated name.
 * slugifyPlayerName is idempotent on the result:
 *   slugifyPlayerName(slugToName("gerrit-cole")) === "gerrit-cole"
 */
const slugToName = (slug: string): string => slug.replace(/-/g, " ");

/** Extract a lineup list section (visit or home) from a game card HTML. */
const extractListSection = (cardHtml: string, sideClass: string): string | null => {
  const regex = new RegExp(
    `<ul class="lineup__list ${sideClass}">[\\s\\S]*?<\\/ul>`
  );
  const match = cardHtml.match(regex);
  return match ? match[0] : null;
};

/** Parsed data from one side (visit or home) of a lineup card. */
interface ParsedSide {
  readonly starter: RwStarter | null;
  readonly lineup: readonly RwLineupPlayer[] | null;
  /** Non-null when a pitcher highlight block exists but could not be fully parsed. */
  readonly starterParseError: string | null;
}

/**
 * Parse pitcher, lineup status, and batting order from one side's
 * <ul class="lineup__list"> HTML section.
 */
const parseSideFromList = (listHtml: string): ParsedSide => {
  // --- Pitcher ---
  // <div class="lineup__player-highlight-name">
  //   <a href="/baseball/player/SLUG-ID">Display Name</a>
  //   <span class="lineup__throws">R</span>
  // </div>
  const pitcherMatch = listHtml.match(
    /player-highlight-name[\s\S]*?href="\/baseball\/player\/([^"]+)"[\s\S]*?lineup__throws">([^<]+)<\/span>/
  );

  // --- Status ---
  // <li class="lineup__status is-confirmed|is-expected">
  const statusMatch = listHtml.match(/lineup__status\s+is-(\w+)/);
  const statusStr = statusMatch?.[1] ?? "unknown";

  let starter: RwStarter | null = null;
  let starterParseError: string | null = null;
  const hasPitcherBlock = listHtml.includes("player-highlight-name");
  if (pitcherMatch) {
    const hrefSlug = pitcherMatch[1]!;
    const hand = pitcherMatch[2]!.trim();
    const slug = extractPlayerSlug(hrefSlug);

    starter = {
      name: slugToName(slug),
      hand,
      status: statusStr
    };
  } else if (hasPitcherBlock) {
    starterParseError =
      "pitcher highlight block present but could not extract name or handedness" +
      " — possible Rotowire HTML structure change";
  }

  // --- Lineup players ---
  // <li class="lineup__player">
  //   <div class="lineup__pos">CF</div>
  //   <a title="Full Name" href="/baseball/player/SLUG-ID">Display</a>
  //   <span class="lineup__bats">R</span>
  // </li>
  //
  // Use the href slug (not title or display text) for the name field,
  // since display text may be abbreviated ("S. Woods Richardson") while
  // the URL slug always has the full name ("simeon-woods-richardson").
  const playerPattern =
    /lineup__player"[\s\S]*?lineup__pos">([^<]+)<\/div>[\s\S]*?href="\/baseball\/player\/([^"]+)"[\s\S]*?lineup__bats">([^<]+)<\/span>/g;

  const players: RwLineupPlayer[] = [];
  let playerMatch: RegExpExecArray | null;
  while ((playerMatch = playerPattern.exec(listHtml)) !== null) {
    const position = playerMatch[1]!.trim();
    const hrefSlug = playerMatch[2]!;
    const hand = playerMatch[3]!.trim();
    const slug = extractPlayerSlug(hrefSlug);

    players.push({
      name: slugToName(slug),
      batting_order: players.length + 1,
      position,
      hand
    });
  }

  return {
    starter,
    lineup: players.length > 0 ? players : null,
    starterParseError
  };
};

/**
 * Parse the Rotowire daily lineups HTML page into validated RwGame[].
 *
 * Each game card is a <div class="lineup is-mlb"> block containing
 * team abbreviations, pitcher highlights, lineup status, and batters.
 * Games with "not-in-slate" class are still parsed (we want all games,
 * not just DFS slate games).
 *
 * Skip policy:
 * - Cards without two `lineup__abbr` divs are skipped (e.g., the single
 *   Rotowire "is-tools" promotional card at the bottom of the page).
 * - If no `is-mlb` cards exist at all, returns ok([]) — valid empty slate
 *   (off-season, no games today).
 *
 * Fail-closed guard:
 * - If the page contains multiple card sections but ALL of them are
 *   skipped (zero games extracted), the parser returns err — this
 *   indicates a provider HTML structure change, not "no games today."
 *   A legitimate no-games page has zero card sections, not many
 *   unparseable ones.
 */
export const parseRotowireHtml = (
  html: string,
  date: string
): Result<readonly RwGame[], string> => {
  if (typeof html !== "string" || html.trim().length === 0) {
    return err("Rotowire response is empty");
  }

  // Split at each game card boundary.
  // Matches: <div class="lineup is-mlb"> and <div class="lineup is-mlb not-in-slate">
  // Does NOT match: <div class="lineup is-ad hide-until-lg">
  const cardParts = html.split(/<div class="lineup is-mlb[^"]*">/);

  // First element is preamble (everything before first card) — skip it.
  if (cardParts.length <= 1) {
    // No is-mlb lineup cards found. Distinguish a legitimate off-day/off-season
    // Rotowire page (which still carries Rotowire structural class markers like
    // "lineup__list", "lineup__abbr", etc.) from a non-Rotowire response body
    // (CDN challenge page, WAF block, maintenance page) that returned HTTP 200
    // with text/html but contains none of the expected page structure.
    //
    // Inferred: a real Rotowire lineups page always contains "lineup__" class
    // references in its template even when no games are scheduled. A CDN
    // challenge or maintenance page will not.
    if (!html.includes("lineup__")) {
      return err(
        "Rotowire response contains no lineup structure markers — " +
        "possible CDN challenge page, maintenance page, or unexpected response body"
      );
    }
    // Page has Rotowire structure but zero is-mlb cards: legitimate off-day
    // or no games scheduled.
    return ok([]);
  }

  const games: RwGame[] = [];

  for (let i = 1; i < cardParts.length; i++) {
    const section = cardParts[i]!;

    // --- Team abbreviations ---
    // <div class="lineup__abbr">MIN</div>  (first = away, second = home)
    const abbrMatches = [
      ...section.matchAll(/<div class="lineup__abbr">([^<]+)<\/div>/g)
    ];

    // Skip non-game cards (e.g., "is-tools" promotional cards that match
    // the is-mlb split but contain no team abbreviations).
    if (abbrMatches.length < 2) {
      continue;
    }

    const awayTeam = abbrMatches[0]![1]!.trim();
    const homeTeam = abbrMatches[1]![1]!.trim();

    if (!awayTeam || !homeTeam) {
      continue;
    }

    // --- Parse each side ---
    const visitList = extractListSection(section, "is-visit");
    const homeList = extractListSection(section, "is-home");

    const awaySide = visitList
      ? parseSideFromList(visitList)
      : { starter: null, lineup: null, starterParseError: null };
    const homeSide = homeList
      ? parseSideFromList(homeList)
      : { starter: null, lineup: null, starterParseError: null };

    if (awaySide.starterParseError !== null) {
      return err(`Game at index ${games.length} (away side): ${awaySide.starterParseError}`);
    }
    if (homeSide.starterParseError !== null) {
      return err(`Game at index ${games.length} (home side): ${homeSide.starterParseError}`);
    }

    games.push({
      away_team: awayTeam,
      home_team: homeTeam,
      game_date: date,
      away_starter: awaySide.starter,
      home_starter: homeSide.starter,
      away_lineup: awaySide.lineup,
      home_lineup: homeSide.lineup
    });
  }

  // Fail-closed guard: if the page had multiple card sections but we
  // extracted zero games, every card was skipped.  One skipped card is
  // expected (the promotional "is-tools" card).  More than one means the
  // HTML structure changed and real game cards became unparseable.
  const totalCardSections = cardParts.length - 1; // exclude preamble
  const skippedCards = totalCardSections - games.length;
  if (games.length === 0 && skippedCards > 1) {
    return err(
      `Rotowire page contained ${totalCardSections} lineup card sections but ` +
      `none yielded a parseable game — possible HTML structure change`
    );
  }

  return ok(games);
};

// ---------------------------------------------------------------------------
// Normalization — RwGame → ProjectedGameData
// ---------------------------------------------------------------------------

const normalizeRwStarter = (
  rwStarter: RwStarter,
  teamId: TeamId
): Result<ProjectedStarter, string> => {
  const handednessResult = normalizeHandedness(rwStarter.hand);
  if (!handednessResult.success) {
    return err(`starter "${rwStarter.name}": ${handednessResult.error}`);
  }
  const statusResult = normalizeStartingStatus(rwStarter.status);
  if (!statusResult.success) {
    return err(`starter "${rwStarter.name}": ${statusResult.error}`);
  }
  return ok({
    player_id: asPlayerId(slugifyPlayerName(rwStarter.name)),
    full_name: rwStarter.name,
    team_id: teamId,
    handedness: handednessResult.data,
    starting_status: statusResult.data,
    confidence: statusResult.data === "confirmed" ? "high" : "medium"
  });
};

const normalizeRwLineup = (
  rwLineup: readonly RwLineupPlayer[],
  teamId: TeamId
): Result<readonly ProjectedLineupEntry[], string> => {
  const entries: ProjectedLineupEntry[] = [];
  for (const player of rwLineup) {
    const positionResult = normalizePosition(player.position);
    if (!positionResult.success) {
      return err(`lineup player "${player.name}": ${positionResult.error}`);
    }
    entries.push({
      player_id: asPlayerId(slugifyPlayerName(player.name)),
      team_id: teamId,
      batting_order: player.batting_order,
      position: positionResult.data,
      starting_status: "expected"
    });
  }
  return ok(entries);
};

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

  let awayStarter: ProjectedStarter | null = null;
  if (rwGame.away_starter !== null) {
    const r = normalizeRwStarter(rwGame.away_starter, awayNorm.teamId);
    if (!r.success) return err(`Game at index ${index} (away): ${r.error}`);
    awayStarter = r.data;
  }

  let homeStarter: ProjectedStarter | null = null;
  if (rwGame.home_starter !== null) {
    const r = normalizeRwStarter(rwGame.home_starter, homeNorm.teamId);
    if (!r.success) return err(`Game at index ${index} (home): ${r.error}`);
    homeStarter = r.data;
  }

  let awayLineup: readonly ProjectedLineupEntry[] | null = null;
  if (rwGame.away_lineup !== null) {
    const r = normalizeRwLineup(rwGame.away_lineup, awayNorm.teamId);
    if (!r.success) return err(`Game at index ${index} (away lineup): ${r.error}`);
    awayLineup = r.data;
  }

  let homeLineup: readonly ProjectedLineupEntry[] | null = null;
  if (rwGame.home_lineup !== null) {
    const r = normalizeRwLineup(rwGame.home_lineup, homeNorm.teamId);
    if (!r.success) return err(`Game at index ${index} (home lineup): ${r.error}`);
    homeLineup = r.data;
  }

  return ok({
    game_id: buildGameId(rwGame.game_date, awayNorm.canonical, homeNorm.canonical),
    away_starter: awayStarter,
    home_starter: homeStarter,
    away_lineup: awayLineup,
    home_lineup: homeLineup
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
        headers: { Accept: "text/html" },
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

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) {
      return err(
        `Rotowire response has unexpected Content-Type: "${contentType}" — expected text/html`
      );
    }

    let html: string;
    try {
      html = await response.text();
    } catch {
      return err("Rotowire projected lineups response could not be read as text");
    }

    const parsed = parseRotowireHtml(html, date);
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
