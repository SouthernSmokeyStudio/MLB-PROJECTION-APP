import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fetchDraftKingsSportsbookMlbMoneylineSlate, normalizeDkTeamAbbreviation } from "@lib/adapters/draftKingsSportsbook";
import type { DraftKingsSportsbookMlbMoneylineEntry, DraftKingsSportsbookMlbMoneylineSlate } from "@lib/contracts/draftkings-sportsbook-mlb-moneyline";
import { asISOTimestamp, err, ok, type Result } from "@lib/contracts/types";
import { getDateInScheduleTimezone, MATERIALIZATION_TIMEZONE } from "@lib/materializer/schedule";
import {
  loadSupabaseDkMoneylineSnapshot,
  storeSupabaseDkMoneylineSnapshot
} from "@lib/supabase/dkMoneylineSnapshots";

const PERSISTED_VERSION = 1 as const;
const DEFAULT_ARTIFACT_DIR = join(process.cwd(), "data", "draftkings-sportsbook-moneyline");

export interface LoadedDraftKingsSportsbookMlbMoneylineSlate {
  readonly source:
    | "draftkings-sportsbook-mlb-moneyline-live"
    | "draftkings-sportsbook-mlb-moneyline-supabase"
    | "draftkings-sportsbook-mlb-moneyline-persisted";
  readonly date: string;
  readonly generated_at: string;
  readonly moneyline_slate: DraftKingsSportsbookMlbMoneylineSlate | null;
  readonly note: string | null;
}

export interface LoadDraftKingsSportsbookMlbMoneylineSlateOptions {
  readonly date: string;
  readonly artifactDir?: string;
}

interface PersistedSportsbookMoneylineArtifact {
  readonly version: 1;
  readonly date: string;
  readonly persisted_at: string;
  readonly moneyline_slate: DraftKingsSportsbookMlbMoneylineSlate;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Convert a UTC ISO timestamp to a YYYY-MM-DD date string in the authoritative
 * schedule timezone (America/Chicago / Central Time).  Night games on the
 * 2026-04-17 Central slate can have UTC timestamps of 2026-04-18T00:xx:00Z;
 * UTC-slice filtering would exclude them — this corrects that.
 */
const toScheduleTimezoneDate = (isoTimestamp: string): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: MATERIALIZATION_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(isoTimestamp));

const getArtifactPath = (date: string, artifactDir: string): string =>
  join(artifactDir, `${date}.json`);

const buildMissedWindowMessage = ({
  date,
  artifactDir
}: {
  readonly date: string;
  readonly artifactDir: string;
}): string =>
  `No DraftKings Sportsbook MLB pregame moneyline rows for ${date}; same-day capture may already be too late. Replay requires a previously captured artifact at ${getArtifactPath(date, artifactDir)}.`;

// ---------------------------------------------------------------------------
// Merge helpers — canonical-key based to prevent abbreviation-variant duplicates
// ---------------------------------------------------------------------------

// Normalize both sides before using as a merge/dedup key.
// Prevents "KC:NY" (pre-fix stored) and "KC:NYY" (post-fix live) from being
// treated as different games, which would create duplicate entries and an
// ambiguous join that permanently holds the game on the board.
const canonicalKey = (entry: DraftKingsSportsbookMlbMoneylineEntry): string => {
  const away = normalizeDkTeamAbbreviation(entry.away_team_abbreviation).canonical;
  const home = normalizeDkTeamAbbreviation(entry.home_team_abbreviation).canonical;
  return `${away}:${home}`;
};

// Merge live entries into stored entries using canonical game keys.
// Live entry wins when present (current odds). Stored entry is kept when the
// game has started and DK has rotated it out of the pregame feed.
// New live entries not yet in stored are appended (late-added games).
const mergeMoneylineEntries = ({
  stored,
  live
}: {
  readonly stored: readonly DraftKingsSportsbookMlbMoneylineEntry[];
  readonly live: readonly DraftKingsSportsbookMlbMoneylineEntry[];
}): readonly DraftKingsSportsbookMlbMoneylineEntry[] => {
  const liveByKey = new Map(live.map((e) => [canonicalKey(e), e]));
  const storedCanonicalKeys = new Set(stored.map(canonicalKey));
  const fromStored = stored.map((s) => liveByKey.get(canonicalKey(s)) ?? s);
  const extraLive = live.filter((e) => !storedCanonicalKeys.has(canonicalKey(e)));
  return [...fromStored, ...extraLive];
};

// Deduplicate entries on canonical key — first occurrence wins.
// Guards against snapshots written before canonical-key merging was in place
// (e.g., both "KC:NY" and "KC:NYY" stored side-by-side). After dedup, the
// join sees exactly one entry per game, eliminating ambiguous-match holds.
const deduplicateOnCanonicalKey = (
  entries: readonly DraftKingsSportsbookMlbMoneylineEntry[]
): readonly DraftKingsSportsbookMlbMoneylineEntry[] => {
  const seen = new Set<string>();
  const result: DraftKingsSportsbookMlbMoneylineEntry[] = [];
  for (const entry of entries) {
    const key = canonicalKey(entry);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(entry);
    }
  }
  return result;
};

const loadPersistedArtifact = async ({
  date,
  artifactDir
}: {
  readonly date: string;
  readonly artifactDir: string;
}): Promise<Result<PersistedSportsbookMoneylineArtifact | null, string>> => {
  const artifactPath = getArtifactPath(date, artifactDir);
  let raw: string;

  try {
    raw = await readFile(artifactPath, "utf-8");
  } catch (cause: unknown) {
    const code = isRecord(cause) ? (cause as { code?: string }).code : undefined;
    if (code === "ENOENT") {
      return ok(null);
    }
    return err(`Failed to read sportsbook moneyline artifact: ${String(cause)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause: unknown) {
    return err(`Sportsbook moneyline artifact is not valid JSON: ${String(cause)}`);
  }

  if (
    !isRecord(parsed) ||
    parsed.version !== PERSISTED_VERSION ||
    parsed.date !== date ||
    !isRecord(parsed.moneyline_slate)
  ) {
    return err(
      `Sportsbook moneyline artifact at ${artifactPath} is malformed or version mismatch`
    );
  }

  return ok(parsed as unknown as PersistedSportsbookMoneylineArtifact);
};

const persistArtifact = async ({
  date,
  artifactDir,
  moneyline_slate
}: {
  readonly date: string;
  readonly artifactDir: string;
  readonly moneyline_slate: DraftKingsSportsbookMlbMoneylineSlate;
}): Promise<Result<string, string>> => {
  const artifactPath = getArtifactPath(date, artifactDir);
  const artifact: PersistedSportsbookMoneylineArtifact = {
    version: PERSISTED_VERSION,
    date,
    persisted_at: asISOTimestamp(new Date().toISOString()),
    moneyline_slate
  };

  try {
    await mkdir(dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, JSON.stringify(artifact, null, 2), "utf-8");
  } catch (cause: unknown) {
    return err(`Failed to write sportsbook moneyline artifact: ${String(cause)}`);
  }

  return ok(artifactPath);
};

export const captureSportsbookMlbMoneylineSlate = async ({
  date,
  artifactDir = DEFAULT_ARTIFACT_DIR
}: {
  readonly date: string;
  readonly artifactDir?: string;
}): Promise<
  Result<
    {
      readonly artifactPath: string;
      readonly moneyline_slate: DraftKingsSportsbookMlbMoneylineSlate;
    },
    string
  >
> => {
  const fetched = await fetchDraftKingsSportsbookMlbMoneylineSlate();

  if (!fetched.success) {
    return err(fetched.error);
  }

  const filteredEntries = fetched.data.entries.filter(
    (entry) => toScheduleTimezoneDate(entry.start_time) === date
  );

  if (filteredEntries.length === 0) {
    return err(
      date < getDateInScheduleTimezone()
        ? buildMissedWindowMessage({ date, artifactDir })
        : "No DraftKings Sportsbook MLB pregame moneyline rows matched the requested date."
    );
  }

  // Merge with any existing snapshot so started games are never overwritten.
  // Live entries provide current odds; stored entries preserve games that have
  // already started and rotated out of the DK live feed.
  const existing = await loadSupabaseDkMoneylineSnapshot(date);
  const storedEntries = existing?.payload.entries ?? [];
  const mergedEntries = mergeMoneylineEntries({ stored: storedEntries, live: filteredEntries });

  const slate: DraftKingsSportsbookMlbMoneylineSlate = {
    ...fetched.data,
    entries: mergedEntries
  };

  // Write to Supabase (survives Lambda restarts) and filesystem (local dev convenience).
  await storeSupabaseDkMoneylineSnapshot(date, slate);
  const persistResult = await persistArtifact({ date, artifactDir, moneyline_slate: slate });
  if (!persistResult.success) {
    return err(persistResult.error);
  }

  return ok({ artifactPath: persistResult.data, moneyline_slate: slate });
};

export const loadDraftKingsSportsbookMlbMoneylineSlate = async ({
  date,
  artifactDir = DEFAULT_ARTIFACT_DIR
}: LoadDraftKingsSportsbookMlbMoneylineSlateOptions): Promise<
  Result<LoadedDraftKingsSportsbookMlbMoneylineSlate, string>
> => {
  const generatedAt = new Date().toISOString();

  // 1. Read locked Supabase truth first. If a snapshot with entries exists,
  //    return it immediately without touching the live DK API. The live feed
  //    is an update source (capture path only), not a render source. This
  //    guarantees started games never disappear when DK rotates them out of
  //    the pregame feed. Deduplication on canonical key heals snapshots that
  //    were written before the canonical-key merge was in place.
  const snapshot = await loadSupabaseDkMoneylineSnapshot(date);
  if (snapshot && snapshot.payload.entries.length > 0) {
    const entries = deduplicateOnCanonicalKey(snapshot.payload.entries);
    return ok({
      source: "draftkings-sportsbook-mlb-moneyline-supabase",
      date,
      generated_at: generatedAt,
      moneyline_slate: { ...snapshot.payload, entries },
      note: null
    });
  }

  // 2. No snapshot yet — attempt live feed to seed the initial capture.
  const fetched = await fetchDraftKingsSportsbookMlbMoneylineSlate();

  if (!fetched.success) {
    // Live also unavailable — try filesystem last.
    const persisted = await loadPersistedArtifact({ date, artifactDir });
    if (persisted.success && persisted.data) {
      return ok({
        source: "draftkings-sportsbook-mlb-moneyline-persisted",
        date,
        generated_at: generatedAt,
        moneyline_slate: persisted.data.moneyline_slate,
        note: "Persisted fallback: live DraftKings Sportsbook feed unavailable."
      });
    }
    return err(fetched.error);
  }

  const filteredEntries = fetched.data.entries.filter(
    (entry) => toScheduleTimezoneDate(entry.start_time) === date
  );

  if (filteredEntries.length === 0) {
    // No live entries and no snapshot — try filesystem.
    const persisted = await loadPersistedArtifact({ date, artifactDir });
    if (persisted.success && persisted.data) {
      return ok({
        source: "draftkings-sportsbook-mlb-moneyline-persisted",
        date,
        generated_at: generatedAt,
        moneyline_slate: persisted.data.moneyline_slate,
        note: "Persisted fallback: live DraftKings Sportsbook pregame moneyline rows have rotated away."
      });
    }
    return ok({
      source: "draftkings-sportsbook-mlb-moneyline-live",
      date,
      generated_at: generatedAt,
      moneyline_slate: null,
      note: "No DraftKings Sportsbook MLB pregame moneyline rows matched the requested date."
    });
  }

  // Seed the snapshot so future requests read locked Supabase truth directly.
  await storeSupabaseDkMoneylineSnapshot(date, { ...fetched.data, entries: filteredEntries });

  return ok({
    source: "draftkings-sportsbook-mlb-moneyline-live",
    date,
    generated_at: generatedAt,
    moneyline_slate: {
      ...fetched.data,
      entries: filteredEntries
    },
    note: null
  });
};
