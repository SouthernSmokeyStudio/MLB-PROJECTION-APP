/**
 * Load and validate the player identity crosswalk from the committed JSON file.
 *
 * This module does ONLY:
 *  1. Read the file from disk
 *  2. Parse as JSON
 *  3. Validate structural shape (version, entries array)
 *  4. Return the parsed PlayerCrosswalk or null on failure
 *
 * It does NOT build indexes, resolve identities, or perform lookups.
 * Those concerns belong to the resolver (S2).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PlayerCrosswalk } from "@lib/contracts/player-crosswalk";

/** Default path to the committed crosswalk file. */
const DEFAULT_CROSSWALK_PATH = join(
  process.cwd(),
  "data",
  "crosswalk",
  "player-crosswalk.json"
);

/**
 * Load and validate the crosswalk JSON file.
 *
 * Fails closed: returns null if the file is missing, unparseable, or
 * structurally invalid (wrong version, missing entries array, entry_count
 * mismatch).
 */
export const loadCrosswalk = (
  filePath: string = DEFAULT_CROSSWALK_PATH
): PlayerCrosswalk | null => {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("version" in parsed) ||
    !("entries" in parsed) ||
    !("entry_count" in parsed) ||
    !("generated_at" in parsed)
  ) {
    return null;
  }

  const candidate = parsed as Record<string, unknown>;

  if (candidate.version !== 1) {
    return null;
  }

  if (!Array.isArray(candidate.entries)) {
    return null;
  }

  if (typeof candidate.entry_count !== "number" || candidate.entry_count !== candidate.entries.length) {
    return null;
  }

  if (typeof candidate.generated_at !== "string" || candidate.generated_at.length === 0) {
    return null;
  }

  return parsed as PlayerCrosswalk;
};
