import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fetchDraftKingsSportsbookMlbMoneylineSlate } from "@lib/adapters/draftKingsSportsbook";
import type { DraftKingsSportsbookMlbMoneylineSlate } from "@lib/contracts/draftkings-sportsbook-mlb-moneyline";
import { asISOTimestamp, err, ok, type Result } from "@lib/contracts/types";
import { getDateInScheduleTimezone } from "@lib/materializer/schedule";

const PERSISTED_VERSION = 1 as const;
const DEFAULT_ARTIFACT_DIR = join(process.cwd(), "data", "draftkings-sportsbook-moneyline");

export interface LoadedDraftKingsSportsbookMlbMoneylineSlate {
  readonly source:
    | "draftkings-sportsbook-mlb-moneyline-live"
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
    (entry) => entry.start_time.slice(0, 10) === date
  );

  if (filteredEntries.length === 0) {
    return err(
      date < getDateInScheduleTimezone()
        ? buildMissedWindowMessage({ date, artifactDir })
        : "No DraftKings Sportsbook MLB pregame moneyline rows matched the requested date."
    );
  }

  const slate: DraftKingsSportsbookMlbMoneylineSlate = {
    ...fetched.data,
    entries: filteredEntries
  };

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
  const fetched = await fetchDraftKingsSportsbookMlbMoneylineSlate();

  if (!fetched.success) {
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
    (entry) => entry.start_time.slice(0, 10) === date
  );

  if (filteredEntries.length === 0) {
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