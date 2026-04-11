/**
 * Canonical Player Identity Crosswalk contract.
 *
 * Each entry represents a resolved player: a real person with a confirmed
 * MLB Stats API person.id. Unresolved players do NOT appear in the
 * crosswalk — they carry `canonical_player_id: null` at the consumer site.
 *
 * The crosswalk has two field categories:
 *  1. Seeded official fields — populated by seed script from MLB Stats API
 *     roster endpoint. These are the baseball-truth anchor.
 *  2. Runtime vendor linkage fields — populated by linking scripts that
 *     match DraftKings/Rotowire data to existing crosswalk entries.
 */

export interface PlayerCrosswalkEntry {
  // ── Seeded official fields ──

  /** Canonical ID: "mlb-{mlb_stats_api_numeric_id}". Always present. */
  readonly canonical_player_id: string;

  /** MLB Stats API person.id (numeric string). The baseball-truth anchor. */
  readonly mlb_stats_api_id: string;

  /** Canonical display name from MLB Stats API (e.g. "Gerrit Cole"). */
  readonly display_name: string;

  /** Normalized name key for fallback matching (e.g. "gerritcole"). */
  readonly normalized_name: string;

  /** Current team abbreviation in canonical format (e.g. "NYY"). */
  readonly team_abbreviation: string;

  /** Primary defensive position (e.g. "P", "SS", "CF"). */
  readonly position: string;

  /** Throwing hand. */
  readonly throws: "L" | "R" | "S" | "unknown";

  /** ISO timestamp when this entry was seeded or last re-seeded. */
  readonly seeded_at: string;

  // ── Runtime vendor linkage fields ──

  /** DraftKings player_id (numeric string from DK API). Null until linked. */
  readonly dk_player_id: string | null;

  /** DraftKings player_dk_id (secondary DK identifier). Null until linked. */
  readonly dk_player_dk_id: string | null;

  /** Rotowire slug (e.g. "gerrit-cole"). Null until linked. */
  readonly rotowire_slug: string | null;

  /** ISO timestamp when vendor linkage fields were last updated. Null if never linked. */
  readonly linked_at: string | null;

  /** How vendor linkages were established. Null if never linked. */
  readonly linked_via: "script-dk-salary-match" | "script-rotowire-slug-match" | "manual" | null;
}

export interface PlayerCrosswalk {
  readonly version: 1;
  readonly generated_at: string;
  readonly entry_count: number;
  readonly entries: readonly PlayerCrosswalkEntry[];
}

/**
 * Build a canonical_player_id from an MLB Stats API numeric person.id.
 *
 * Format: "mlb-{numeric_id}"
 * Example: buildCanonicalPlayerId("543037") → "mlb-543037"
 */
export const buildCanonicalPlayerId = (mlbStatsApiId: string): string =>
  `mlb-${mlbStatsApiId}`;

/**
 * Extract the MLB Stats API numeric ID from a canonical_player_id.
 * Returns null if the format is invalid.
 */
export const parseCanonicalPlayerId = (canonicalId: string): string | null => {
  if (!canonicalId.startsWith("mlb-")) return null;
  const numericPart = canonicalId.slice(4);
  if (numericPart.length === 0 || !/^\d+$/.test(numericPart)) return null;
  return numericPart;
};
