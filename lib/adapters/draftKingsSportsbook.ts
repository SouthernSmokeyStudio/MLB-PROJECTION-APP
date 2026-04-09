import type {
  DraftKingsSportsbookMlbMoneylineEntry,
  DraftKingsSportsbookMlbMoneylineSlate
} from "@lib/contracts/draftkings-sportsbook-mlb-moneyline";
import { asISOTimestamp, err, ok, type ISOTimestamp, type Result } from "@lib/contracts/types";

const DRAFTKINGS_SPORTSBOOK_API_HOST = "https://sportsbook-nash.draftkings.com";
const DRAFTKINGS_SPORTSBOOK_SITE = "US-TN-SB" as const;
const MLB_LEAGUE_ID = "84240";
const MONEYLINE_SUBCATEGORY_ID = "4519";

// ---------------------------------------------------------------------------
// BF-004: DraftKings shortName → canonical team abbreviation normalization
// ---------------------------------------------------------------------------
// DraftKings sportsbook participant metadata.shortName uses abbreviations
// that diverge from our canonical TEAM_METADATA for 3 teams:
//   WAS → WSH  (Washington Nationals)
//   A's → ATH  (Athletics)
//   SFG → SF   (San Francisco Giants)
//
// This map is applied at parse time so the internal contract always carries
// canonical abbreviations. The join logic remains strict equality — no
// downstream special-casing.
// ---------------------------------------------------------------------------

const CANONICAL_TEAM_ABBREVIATIONS: ReadonlySet<string> = new Set([
  "LAA", "ARI", "BAL", "BOS", "CHC", "CIN", "CLE", "COL",
  "DET", "HOU", "KC",  "LAD", "WSH", "NYM", "ATH", "PIT",
  "SD",  "SEA", "SF",  "STL", "TB",  "TEX", "TOR", "MIN",
  "PHI", "ATL", "CWS", "MIA", "NYY", "MIL"
]);

const DK_SHORTNAME_TO_CANONICAL: Readonly<Record<string, string>> = {
  "WAS": "WSH",
  "A's": "ATH",
  "SFG": "SF"
};

/**
 * Normalize a DraftKings sportsbook team shortName into our canonical
 * abbreviation. Returns the canonical value and any drift warning.
 *
 * - Known DK divergences (WAS, A's, SFG) are mapped to canonical.
 * - Already-canonical values pass through unchanged.
 * - Unrecognized values pass through with a drift warning so joins
 *   can still attempt a match, but the caller is notified.
 */
export const normalizeDkTeamAbbreviation = (
  rawShortName: string
): { readonly canonical: string; readonly drift_warning: string | null } => {
  const mapped = DK_SHORTNAME_TO_CANONICAL[rawShortName];
  if (mapped) {
    return { canonical: mapped, drift_warning: null };
  }

  if (CANONICAL_TEAM_ABBREVIATIONS.has(rawShortName)) {
    return { canonical: rawShortName, drift_warning: null };
  }

  return {
    canonical: rawShortName,
    drift_warning: `Unrecognized DraftKings team shortName "${rawShortName}" — not in canonical set or known DK mappings`
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null;

const readStringArray = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

const normalizeNumericString = (value: string): string => value.replace(/\u2212/g, "-").trim();

const parseAmericanOdds = (value: unknown): number | null => {
  const normalized = readString(value);
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalizeNumericString(normalized));
  return Number.isInteger(parsed) ? parsed : null;
};

const parseDecimalOdds = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const normalized = readString(value);
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalizeNumericString(normalized));
  return Number.isFinite(parsed) ? parsed : null;
};

const readParticipantSide = (
  participants: readonly unknown[],
  venueRole: "Away" | "Home"
): Record<string, unknown> | null =>
  participants.find(
    (participant): participant is Record<string, unknown> =>
      isRecord(participant) && participant.venueRole === venueRole
  ) ?? null;

const buildDraftKingsSportsbookMlbMoneylineEndpoint = (): string => {
  const searchParams = new URLSearchParams({
    isBatchable: "false",
    templateVars: MLB_LEAGUE_ID,
    eventsQuery:
      "$filter=leagueId eq '84240' AND clientMetadata/Subcategories/any(s: s/Id eq '4519')",
    marketsQuery:
      "$filter=clientMetadata/subCategoryId eq '4519' AND tags/all(t: t ne 'SportcastBetBuilder')",
    include: "Events",
    entity: "events"
  });

  return `${DRAFTKINGS_SPORTSBOOK_API_HOST}/sites/${DRAFTKINGS_SPORTSBOOK_SITE}/api/sportscontent/controldata/league/leagueSubcategory/v1/markets?${searchParams.toString()}`;
};

const buildMoneylineEntry = ({
  event,
  market,
  selections
}: {
  readonly event: Record<string, unknown>;
  readonly market: Record<string, unknown>;
  readonly selections: readonly Record<string, unknown>[];
}): DraftKingsSportsbookMlbMoneylineEntry | null => {
  const eventId = readString(event.id);
  const eventName = readString(event.name);
  const startEventDate = readString(event.startEventDate);
  const eventParticipants = Array.isArray(event.participants) ? event.participants : [];
  const awayParticipant = readParticipantSide(eventParticipants, "Away");
  const homeParticipant = readParticipantSide(eventParticipants, "Home");

  if (!eventId || !eventName || !startEventDate || !awayParticipant || !homeParticipant) {
    return null;
  }

  const marketId = readString(market.id);
  if (!marketId) {
    return null;
  }

  const awaySelection = selections.find(
    (selection) => selection.outcomeType === "Away" && selection.marketId === marketId
  );
  const homeSelection = selections.find(
    (selection) => selection.outcomeType === "Home" && selection.marketId === marketId
  );

  if (!awaySelection || !homeSelection) {
    return null;
  }

  const awayDisplayOdds = isRecord(awaySelection.displayOdds) ? awaySelection.displayOdds : null;
  const homeDisplayOdds = isRecord(homeSelection.displayOdds) ? homeSelection.displayOdds : null;
  const awayMetadata = isRecord(awayParticipant.metadata) ? awayParticipant.metadata : null;
  const homeMetadata = isRecord(homeParticipant.metadata) ? homeParticipant.metadata : null;

  const rawAwayShortName = readString(awayMetadata?.shortName);
  const awayTeamName = readString(awayParticipant.name);
  const rawHomeShortName = readString(homeMetadata?.shortName);
  const homeTeamName = readString(homeParticipant.name);

  // BF-004: normalize DK shortName → canonical abbreviation at parse boundary
  const awayNorm = rawAwayShortName ? normalizeDkTeamAbbreviation(rawAwayShortName) : null;
  const homeNorm = rawHomeShortName ? normalizeDkTeamAbbreviation(rawHomeShortName) : null;
  const awayTeamAbbreviation = awayNorm?.canonical ?? null;
  const homeTeamAbbreviation = homeNorm?.canonical ?? null;

  if (awayNorm?.drift_warning) {
    console.warn(`[BF-004 drift] away: ${awayNorm.drift_warning}`);
  }
  if (homeNorm?.drift_warning) {
    console.warn(`[BF-004 drift] home: ${homeNorm.drift_warning}`);
  }
  const awayAmerican = parseAmericanOdds(awayDisplayOdds?.american);
  const awayDecimal = parseDecimalOdds(awayDisplayOdds?.decimal);
  const homeAmerican = parseAmericanOdds(homeDisplayOdds?.american);
  const homeDecimal = parseDecimalOdds(homeDisplayOdds?.decimal);

  if (
    !awayTeamAbbreviation ||
    !awayTeamName ||
    !homeTeamAbbreviation ||
    !homeTeamName ||
    awayAmerican === null ||
    homeAmerican === null
  ) {
    return null;
  }

  return {
    event_id: eventId,
    market_id: marketId,
    event_name: eventName,
    start_time: asISOTimestamp(startEventDate),
    away_team_abbreviation: awayTeamAbbreviation,
    away_team_name: awayTeamName,
    away_starting_pitcher: readString(awayMetadata?.startingPitcherPlayerName),
    home_team_abbreviation: homeTeamAbbreviation,
    home_team_name: homeTeamName,
    home_starting_pitcher: readString(homeMetadata?.startingPitcherPlayerName),
    away_odds_american: awayAmerican,
    away_odds_decimal: awayDecimal,
    home_odds_american: homeAmerican,
    home_odds_decimal: homeDecimal
  };
};

export const parseDraftKingsSportsbookMlbMoneylineSlate = ({
  fetchedAt,
  payload
}: {
  readonly fetchedAt: ISOTimestamp;
  readonly payload: unknown;
}): Result<DraftKingsSportsbookMlbMoneylineSlate, string> => {
  if (!isRecord(payload)) {
    return err("DraftKings Sportsbook MLB moneyline response must be an object");
  }

  if (!Array.isArray(payload.events) || !Array.isArray(payload.markets) || !Array.isArray(payload.selections)) {
    return err("DraftKings Sportsbook MLB moneyline response missing events, markets, or selections");
  }

  const events = payload.events.filter(isRecord);
  const markets = payload.markets.filter(isRecord);
  const selections = payload.selections.filter(isRecord);
  const entries: DraftKingsSportsbookMlbMoneylineEntry[] = [];

  for (const event of events) {
    const eventStatus = readString(event.status);
    const eventLeagueId = readString(event.leagueId);

    if (eventStatus !== "NOT_STARTED" || eventLeagueId !== MLB_LEAGUE_ID) {
      continue;
    }

    const candidateMarkets = markets.filter((market) => {
      const marketEventId = readString(market.eventId);
      const marketName = readString(market.name);
      const marketSubcategoryId = readString(market.subcategoryId);
      const marketTags = readStringArray(market.tags);

      return (
        marketEventId === readString(event.id) &&
        marketName === "Moneyline" &&
        marketSubcategoryId === MONEYLINE_SUBCATEGORY_ID &&
        marketTags.includes("Default") &&
        marketTags.includes("PrimaryMarket")
      );
    });

    for (const market of candidateMarkets) {
      const entry = buildMoneylineEntry({
        event,
        market,
        selections
      });

      if (entry) {
        entries.push(entry);
      }
    }
  }

  return ok({
    provider: "draftkings-sportsbook",
    sport: "MLB",
    market_type: "moneyline",
    site: DRAFTKINGS_SPORTSBOOK_SITE,
    league_id: MLB_LEAGUE_ID,
    subcategory_id: MONEYLINE_SUBCATEGORY_ID,
    source: {
      provider: "draftkings-sportsbook",
      endpoint: buildDraftKingsSportsbookMlbMoneylineEndpoint(),
      fetched_at: fetchedAt,
      raw_payload_hash: null
    },
    entries
  });
};

export const fetchDraftKingsSportsbookMlbMoneylineSlate = async (): Promise<
  Result<DraftKingsSportsbookMlbMoneylineSlate, string>
> => {
  const endpoint = buildDraftKingsSportsbookMlbMoneylineEndpoint();
  const fetchedAt = asISOTimestamp(new Date().toISOString());
  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      Accept: "application/json"
    },
    cache: "no-store"
  });

  if (!response.ok) {
    return err(
      `DraftKings Sportsbook MLB moneyline request failed with status ${response.status}`
    );
  }

  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    return err("DraftKings Sportsbook MLB moneyline response was not valid JSON");
  }

  return parseDraftKingsSportsbookMlbMoneylineSlate({
    fetchedAt,
    payload
  });
};
