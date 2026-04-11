/**
 * seed-crosswalk.ts — Seed the player identity crosswalk from MLB Stats API.
 *
 * Usage:
 *   npx tsx scripts/seed-crosswalk.ts                  # current season
 *   npx tsx scripts/seed-crosswalk.ts 2026             # explicit season
 *   npx tsx scripts/seed-crosswalk.ts --dry-run        # log stats, don't write
 *
 * Fetches the active player roster from MLB Stats API and writes a crosswalk
 * JSON file to data/crosswalk/player-crosswalk.json.
 *
 * This script is idempotent: re-running it overwrites the crosswalk with
 * fresh data. Vendor linkage fields (dk_player_id, rotowire_slug, etc.)
 * from the existing file are preserved if the player still appears in the
 * new roster.
 *
 * Exit codes:
 *   0 — success
 *   1 — fetch or write failure
 */

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { PlayerCrosswalk, PlayerCrosswalkEntry } from "../lib/contracts/player-crosswalk";
import { buildCanonicalPlayerId } from "../lib/contracts/player-crosswalk";
import { normalizeNameForJoin } from "../lib/crosswalk/normalize";

const MLB_STATS_API_SPORTS_PLAYERS = "https://statsapi.mlb.com/api/v1/sports/1/players";
const CROSSWALK_PATH = join(process.cwd(), "data", "crosswalk", "player-crosswalk.json");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

interface ParsedRosterPlayer {
  readonly id: number;
  readonly fullName: string;
  readonly primaryPosition: string;
  readonly pitchHand: string;
  readonly currentTeamAbbreviation: string;
}

const parseRosterPlayer = (value: unknown): ParsedRosterPlayer | null => {
  if (!isRecord(value)) return null;

  const id = typeof value.id === "number" ? value.id : null;
  const fullName = typeof value.fullName === "string" ? value.fullName : null;

  if (id === null || fullName === null) return null;

  const primaryPosition = isRecord(value.primaryPosition)
    ? (typeof value.primaryPosition.abbreviation === "string"
      ? value.primaryPosition.abbreviation
      : "unknown")
    : "unknown";

  const pitchHand = isRecord(value.pitchHand)
    ? (typeof value.pitchHand.code === "string"
      ? value.pitchHand.code
      : "unknown")
    : "unknown";

  const currentTeam = isRecord(value.currentTeam)
    ? value.currentTeam
    : null;
  const currentTeamAbbreviation = currentTeam !== null && typeof currentTeam.abbreviation === "string"
    ? currentTeam.abbreviation
    : "UNK";

  return { id, fullName, primaryPosition, pitchHand, currentTeamAbbreviation };
};

const normalizeThrows = (code: string): PlayerCrosswalkEntry["throws"] => {
  const upper = code.toUpperCase();
  if (upper === "L") return "L";
  if (upper === "R") return "R";
  if (upper === "S") return "S";
  return "unknown";
};

const loadExistingLinkages = (): Map<string, Pick<
  PlayerCrosswalkEntry,
  "dk_player_id" | "dk_player_dk_id" | "rotowire_slug" | "linked_at" | "linked_via"
>> => {
  const linkages = new Map<string, Pick<
    PlayerCrosswalkEntry,
    "dk_player_id" | "dk_player_dk_id" | "rotowire_slug" | "linked_at" | "linked_via"
  >>();

  if (!existsSync(CROSSWALK_PATH)) return linkages;

  try {
    const raw = readFileSync(CROSSWALK_PATH, "utf-8");
    const existing = JSON.parse(raw) as PlayerCrosswalk;

    if (existing.version !== 1 || !Array.isArray(existing.entries)) return linkages;

    for (const entry of existing.entries) {
      if (
        entry.dk_player_id !== null ||
        entry.dk_player_dk_id !== null ||
        entry.rotowire_slug !== null
      ) {
        linkages.set(entry.mlb_stats_api_id, {
          dk_player_id: entry.dk_player_id,
          dk_player_dk_id: entry.dk_player_dk_id,
          rotowire_slug: entry.rotowire_slug,
          linked_at: entry.linked_at,
          linked_via: entry.linked_via
        });
      }
    }
  } catch {
    // Existing file corrupt or unreadable — proceed without linkages
  }

  return linkages;
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const seasonArg = args.find((a) => /^\d{4}$/.test(a));
  const season = seasonArg ?? String(new Date().getFullYear());

  console.log(`[seed-crosswalk] season=${season} dryRun=${dryRun}`);

  const url = `${MLB_STATS_API_SPORTS_PLAYERS}?season=${season}`;
  console.log(`[seed-crosswalk] fetching ${url}`);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" }
    });
  } catch (fetchErr) {
    console.error("[seed-crosswalk] fetch failed:", fetchErr);
    process.exit(1);
  }

  if (!response.ok) {
    console.error(`[seed-crosswalk] HTTP ${response.status}`);
    process.exit(1);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    console.error("[seed-crosswalk] invalid JSON response");
    process.exit(1);
  }

  if (!isRecord(payload) || !Array.isArray(payload.people)) {
    console.error("[seed-crosswalk] unexpected response shape — missing people array");
    process.exit(1);
  }

  const existingLinkages = loadExistingLinkages();
  const now = new Date().toISOString();
  const entries: PlayerCrosswalkEntry[] = [];

  for (const person of payload.people) {
    const parsed = parseRosterPlayer(person);
    if (!parsed) continue;

    const mlbId = String(parsed.id);
    const linkage = existingLinkages.get(mlbId);

    entries.push({
      canonical_player_id: buildCanonicalPlayerId(mlbId),
      mlb_stats_api_id: mlbId,
      display_name: parsed.fullName,
      normalized_name: normalizeNameForJoin(parsed.fullName),
      team_abbreviation: parsed.currentTeamAbbreviation,
      position: parsed.primaryPosition,
      throws: normalizeThrows(parsed.pitchHand),
      seeded_at: now,
      dk_player_id: linkage?.dk_player_id ?? null,
      dk_player_dk_id: linkage?.dk_player_dk_id ?? null,
      rotowire_slug: linkage?.rotowire_slug ?? null,
      linked_at: linkage?.linked_at ?? null,
      linked_via: linkage?.linked_via ?? null
    });
  }

  // Sort by canonical_player_id for deterministic output
  entries.sort((a, b) => a.canonical_player_id.localeCompare(b.canonical_player_id));

  const crosswalk: PlayerCrosswalk = {
    version: 1,
    generated_at: now,
    entry_count: entries.length,
    entries
  };

  console.log(`[seed-crosswalk] parsed ${entries.length} players from MLB Stats API`);

  if (dryRun) {
    console.log("[seed-crosswalk] dry run — not writing file");
    const preserved = entries.filter((e) => e.dk_player_id !== null || e.rotowire_slug !== null).length;
    console.log(`[seed-crosswalk] would preserve ${preserved} existing vendor linkages`);
    return;
  }

  const json = JSON.stringify(crosswalk, null, 2) + "\n";
  writeFileSync(CROSSWALK_PATH, json, "utf-8");
  console.log(`[seed-crosswalk] wrote ${CROSSWALK_PATH} (${entries.length} entries, ${json.length} bytes)`);
};

main().catch((err) => {
  console.error("[seed-crosswalk] unhandled error:", err);
  process.exit(1);
});
