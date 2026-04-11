/**
 * Shared name normalization utility for player identity matching.
 *
 * Used by:
 *  - Crosswalk seed script (to populate normalized_name on entries)
 *  - Crosswalk resolver step 3 (composite name+team fallback)
 *  - DFS salary join fallback (legacy, until crosswalk cutover)
 *
 * Normalization: NFD decompose → strip combining marks → strip all
 * non-ASCII-letter characters → lowercase.
 *
 * Examples:
 *   "Gerrit Cole"         → "gerritcole"
 *   "gerrit-cole"         → "gerritcole"
 *   "Ronald Acuña Jr."    → "ronaldacunajr"
 *   "A.J. Minter"         → "ajminter"
 *   ""                    → ""
 */
export const normalizeNameForJoin = (name: string): string =>
  name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z]/g, "")
    .toLowerCase();
