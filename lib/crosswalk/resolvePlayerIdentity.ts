/**
 * Deterministic player identity resolver.
 *
 * Given a loaded crosswalk, builds ephemeral in-memory indexes and resolves
 * a player to their canonical_player_id using a strict cascade:
 *
 *   1. Direct MLB Stats API ID lookup (highest confidence)
 *   2. DraftKings player_id lookup (if linked in crosswalk)
 *   3. Rotowire slug lookup (if linked in crosswalk)
 *   4. Composite name+team fallback (normalized name + team abbreviation)
 *   5. Unresolved → null (fail closed)
 *
 * Ambiguity at any step → null. The resolver never guesses.
 */

import type { PlayerCrosswalk, PlayerCrosswalkEntry } from "@lib/contracts/player-crosswalk";
import { normalizeNameForJoin } from "./normalize";

// ---------------------------------------------------------------------------
// Indexed crosswalk (ephemeral, never persisted)
// ---------------------------------------------------------------------------

export interface IndexedCrosswalk {
  readonly entry_count: number;
  /** Null value = ambiguous duplicate key (fail closed). */
  readonly byMlbStatsApiId: ReadonlyMap<string, PlayerCrosswalkEntry | null>;
  /** Null value = ambiguous duplicate key (fail closed). */
  readonly byDkPlayerId: ReadonlyMap<string, PlayerCrosswalkEntry | null>;
  /** Null value = ambiguous duplicate key (fail closed). */
  readonly byRotowireSlug: ReadonlyMap<string, PlayerCrosswalkEntry | null>;
  /** Null value = ambiguous duplicate key (fail closed). */
  readonly byNameAndTeam: ReadonlyMap<string, PlayerCrosswalkEntry | null>;
}

const AMBIGUOUS_SENTINEL = null;

const buildNameTeamKey = (normalizedName: string, teamAbbreviation: string): string =>
  `${normalizedName}::${teamAbbreviation}`;

export const indexCrosswalk = (crosswalk: PlayerCrosswalk): IndexedCrosswalk => {
  const byMlbStatsApiId = new Map<string, PlayerCrosswalkEntry | null>();
  const byDkPlayerId = new Map<string, PlayerCrosswalkEntry | null>();
  const byRotowireSlug = new Map<string, PlayerCrosswalkEntry | null>();
  const byNameAndTeam = new Map<string, PlayerCrosswalkEntry | null>();

  const setOrAmbiguate = (
    map: Map<string, PlayerCrosswalkEntry | null>,
    key: string,
    entry: PlayerCrosswalkEntry
  ): void => {
    if (map.has(key)) {
      map.set(key, AMBIGUOUS_SENTINEL);
    } else {
      map.set(key, entry);
    }
  };

  for (const entry of crosswalk.entries) {
    setOrAmbiguate(byMlbStatsApiId, entry.mlb_stats_api_id, entry);

    if (entry.dk_player_id !== null) {
      setOrAmbiguate(byDkPlayerId, entry.dk_player_id, entry);
    }

    if (entry.rotowire_slug !== null) {
      setOrAmbiguate(byRotowireSlug, entry.rotowire_slug, entry);
    }

    const nameTeamKey = buildNameTeamKey(entry.normalized_name, entry.team_abbreviation);
    if (nameTeamKey && entry.normalized_name.length > 0 && entry.team_abbreviation.length > 0) {
      setOrAmbiguate(byNameAndTeam, nameTeamKey, entry);
    }
  }

  return {
    entry_count: crosswalk.entries.length,
    byMlbStatsApiId,
    byDkPlayerId,
    byRotowireSlug,
    byNameAndTeam
  };
};

// ---------------------------------------------------------------------------
// Name+team composite lookup
// ---------------------------------------------------------------------------

export const lookupByNameAndTeam = (
  indexed: IndexedCrosswalk,
  normalizedName: string,
  teamAbbreviation: string
): PlayerCrosswalkEntry | null => {
  if (!normalizedName || !teamAbbreviation) {
    return null;
  }
  const entry = indexed.byNameAndTeam.get(buildNameTeamKey(normalizedName, teamAbbreviation));
  // undefined (no key) or null (ambiguous) both return null
  return entry ?? null;
};

// ---------------------------------------------------------------------------
// Resolution result
// ---------------------------------------------------------------------------

export interface PlayerIdentityResolution {
  /** "mlb-{numeric}" or null if unresolved. */
  readonly canonical_player_id: string | null;
  /** Which step resolved the identity, or null if unresolved. */
  readonly resolved_via:
    | "mlb_stats_api_id"
    | "dk_player_id"
    | "rotowire_slug"
    | "name_and_team"
    | null;
}

const UNRESOLVED: PlayerIdentityResolution = {
  canonical_player_id: null,
  resolved_via: null
};

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

export interface ResolvePlayerIdentityInput {
  /** MLB Stats API numeric ID (string). Null if unavailable. */
  readonly mlb_stats_api_id: string | null;
  /** Player ID as used in the projection pipeline (may be a slug or numeric string). */
  readonly player_id: string;
  /** Team abbreviation (e.g. "NYY"). */
  readonly team_abbreviation: string;
}

/**
 * Resolve a single player against the indexed crosswalk.
 *
 * Cascade order:
 *   1. mlb_stats_api_id → byMlbStatsApiId
 *   2. player_id → byDkPlayerId (covers DK numeric IDs flowing through player_id)
 *   3. player_id → byRotowireSlug (covers Rotowire slug flowing through player_id)
 *   4. normalizeNameForJoin(player_id) + team_abbreviation → byNameAndTeam
 *   5. null (fail closed)
 */
export const resolvePlayerIdentity = (
  indexed: IndexedCrosswalk,
  input: ResolvePlayerIdentityInput
): PlayerIdentityResolution => {
  // Step 1: Direct MLB Stats API ID
  if (input.mlb_stats_api_id !== null) {
    const entry = indexed.byMlbStatsApiId.get(input.mlb_stats_api_id);
    if (entry) {
      return {
        canonical_player_id: entry.canonical_player_id,
        resolved_via: "mlb_stats_api_id"
      };
    }
  }

  // Step 2: DK player_id lookup (player_id may carry a DK numeric ID)
  {
    const entry = indexed.byDkPlayerId.get(input.player_id);
    if (entry) {
      return {
        canonical_player_id: entry.canonical_player_id,
        resolved_via: "dk_player_id"
      };
    }
  }

  // Step 3: Rotowire slug lookup (player_id may be a Rotowire slug)
  {
    const entry = indexed.byRotowireSlug.get(input.player_id);
    if (entry) {
      return {
        canonical_player_id: entry.canonical_player_id,
        resolved_via: "rotowire_slug"
      };
    }
  }

  // Step 4: Composite name+team fallback
  {
    const normalizedName = normalizeNameForJoin(input.player_id);
    const entry = lookupByNameAndTeam(indexed, normalizedName, input.team_abbreviation);
    if (entry) {
      return {
        canonical_player_id: entry.canonical_player_id,
        resolved_via: "name_and_team"
      };
    }
  }

  // Step 5: Unresolved
  return UNRESOLVED;
};
