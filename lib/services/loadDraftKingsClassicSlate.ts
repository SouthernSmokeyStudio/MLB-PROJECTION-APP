import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  fetchDraftKingsClassicSalarySlate,
  fetchUpcomingDraftKingsClassicDraftGroups
} from "@lib/adapters/draftKings";
import type {
  DraftKingsClassicDraftGroup,
  DraftKingsClassicSalarySlate
} from "@lib/contracts/draftkings-classic";
import { asISOTimestamp, ok, err, type Result } from "@lib/contracts/types";

const MLB_SPORT_ID = 2;
const DRAFTKINGS_CLASSIC_CONTEST_TYPE_ID = 28;
const DRAFTKINGS_CLASSIC_GAME_TYPE_ID = 2;
const PERSISTED_DK_CLASSIC_VERSION = 1;
const DEFAULT_ARTIFACT_DIR = join(process.cwd(), "data", "draftkings-classic");

export interface LoadedDraftKingsClassicSlate {
  readonly source: "draftkings-classic-live" | "draftkings-classic-persisted";
  readonly date: string;
  readonly generated_at: string;
  readonly draft_group: DraftKingsClassicDraftGroup | null;
  readonly label: string | null;
  readonly salary_slate: DraftKingsClassicSalarySlate | null;
  readonly note: string | null;
}

export interface LoadDraftKingsClassicSlateOptions {
  readonly date: string;
  readonly draftGroupId?: string;
  readonly artifactDir?: string;
}

interface PersistedDraftKingsClassicSlate {
  readonly version: 1;
  readonly date: string;
  readonly persisted_at: string;
  readonly source: "draftkings-classic-upcoming";
  readonly draft_group: DraftKingsClassicDraftGroup;
  readonly label: string;
  readonly salary_slate: DraftKingsClassicSalarySlate;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const getArtifactPath = (date: string, artifactDir: string): string =>
  join(artifactDir, `${date}.json`);

const isDraftGroup = (value: unknown): value is DraftKingsClassicDraftGroup =>
  isRecord(value) &&
  typeof value.draft_group_id === "string" &&
  typeof value.sport_id === "number" &&
  typeof value.contest_type_id === "number" &&
  typeof value.game_type_id === "number" &&
  typeof value.draft_group_state === "string" &&
  typeof value.sort_order === "number" &&
  (typeof value.start_time_suffix === "string" || value.start_time_suffix === null) &&
  typeof value.min_start_time === "string" &&
  typeof value.max_start_time === "string" &&
  typeof value.allow_lineup_creation === "boolean" &&
  Array.isArray(value.all_tags) &&
  value.all_tags.every((tag) => typeof tag === "string") &&
  Array.isArray(value.competition_ids) &&
  value.competition_ids.every((competitionId) => typeof competitionId === "string");

const isSalarySlate = (value: unknown): value is DraftKingsClassicSalarySlate =>
  isRecord(value) &&
  value.provider === "draftkings" &&
  value.contest_type === "classic" &&
  typeof value.draft_group_id === "string" &&
  isRecord(value.source) &&
  Array.isArray(value.salaries);

const parsePersistedDraftKingsClassicSlate = (
  parsed: unknown,
  expectedDate: string
): Result<PersistedDraftKingsClassicSlate, string> => {
  if (!isRecord(parsed)) {
    return err("DraftKings Classic artifact root is not an object");
  }

  if (parsed.version !== PERSISTED_DK_CLASSIC_VERSION) {
    return err(`Unsupported DraftKings Classic artifact version: ${String(parsed.version)}`);
  }

  if (parsed.date !== expectedDate) {
    return err(
      `DraftKings Classic artifact date mismatch: expected ${expectedDate}, got ${String(parsed.date)}`
    );
  }

  if (typeof parsed.persisted_at !== "string") {
    return err("DraftKings Classic artifact missing persisted_at");
  }

  if (parsed.source !== "draftkings-classic-upcoming") {
    return err("DraftKings Classic artifact has unsupported source");
  }

  if (!isDraftGroup(parsed.draft_group)) {
    return err("DraftKings Classic artifact has invalid draft_group");
  }

  if (typeof parsed.label !== "string" || parsed.label.length === 0) {
    return err("DraftKings Classic artifact has invalid label");
  }

  if (!isSalarySlate(parsed.salary_slate)) {
    return err("DraftKings Classic artifact has invalid salary_slate");
  }

  if (parsed.salary_slate.draft_group_id !== parsed.draft_group.draft_group_id) {
    return err("DraftKings Classic artifact draft_group_id mismatch");
  }

  return ok(parsed as unknown as PersistedDraftKingsClassicSlate);
};

const loadPersistedDraftKingsClassicSlate = async ({
  date,
  artifactDir
}: {
  readonly date: string;
  readonly artifactDir: string;
}): Promise<Result<PersistedDraftKingsClassicSlate | null, string>> => {
  const artifactPath = getArtifactPath(date, artifactDir);
  let raw: string;

  try {
    raw = await readFile(artifactPath, "utf-8");
  } catch (cause: unknown) {
    const code = isRecord(cause) ? (cause as { code?: string }).code : undefined;
    if (code === "ENOENT") {
      return ok(null);
    }

    return err(`Failed to read DraftKings Classic artifact: ${String(cause)}`);
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return err(`DraftKings Classic artifact is not valid JSON: ${artifactPath}`);
  }

  return parsePersistedDraftKingsClassicSlate(parsed, date);
};

const persistDraftKingsClassicSlate = async ({
  date,
  artifactDir,
  draftGroup,
  label,
  salarySlate
}: {
  readonly date: string;
  readonly artifactDir: string;
  readonly draftGroup: DraftKingsClassicDraftGroup;
  readonly label: string;
  readonly salarySlate: DraftKingsClassicSalarySlate;
}): Promise<Result<string, string>> => {
  const artifactPath = getArtifactPath(date, artifactDir);
  const artifact: PersistedDraftKingsClassicSlate = {
    version: PERSISTED_DK_CLASSIC_VERSION,
    date,
    persisted_at: asISOTimestamp(new Date().toISOString()),
    source: "draftkings-classic-upcoming",
    draft_group: draftGroup,
    label,
    salary_slate: salarySlate
  };

  try {
    await mkdir(dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, JSON.stringify(artifact, null, 2), "utf-8");
  } catch (cause: unknown) {
    return err(`Failed to write DraftKings Classic artifact: ${String(cause)}`);
  }

  return ok(artifactPath);
};

const isDraftKingsClassicGroup = (group: DraftKingsClassicDraftGroup): boolean =>
  group.sport_id === MLB_SPORT_ID &&
  group.contest_type_id === DRAFTKINGS_CLASSIC_CONTEST_TYPE_ID &&
  group.game_type_id === DRAFTKINGS_CLASSIC_GAME_TYPE_ID &&
  group.allow_lineup_creation;

const buildDraftKingsClassicLabel = (
  draftGroup: DraftKingsClassicDraftGroup
): string => {
  const featuredPrefix = draftGroup.all_tags.includes("Featured") ? "Featured " : "";
  const suffix = draftGroup.start_time_suffix ?? "";
  return `${featuredPrefix}DraftKings Classic${suffix}`;
};

const selectDraftKingsClassicGroup = ({
  date,
  draftGroupId,
  groups
}: {
  readonly date: string;
  readonly draftGroupId?: string;
  readonly groups: readonly DraftKingsClassicDraftGroup[];
}): DraftKingsClassicDraftGroup | null => {
  if (draftGroupId) {
    return (
      groups.find(
        (group) =>
          group.draft_group_id === draftGroupId &&
          isDraftKingsClassicGroup(group) &&
          group.min_start_time.slice(0, 10) === date
      ) ?? null
    );
  }

  return [...groups]
    .filter(
      (group) =>
        isDraftKingsClassicGroup(group) &&
        group.min_start_time.slice(0, 10) === date
    )
    .sort((left, right) => {
      if (left.sort_order !== right.sort_order) {
        return left.sort_order - right.sort_order;
      }

      return left.min_start_time.localeCompare(right.min_start_time);
    })[0] ?? null;
};

export const loadDraftKingsClassicSlate = async ({
  date,
  draftGroupId,
  artifactDir = DEFAULT_ARTIFACT_DIR
}: LoadDraftKingsClassicSlateOptions): Promise<Result<LoadedDraftKingsClassicSlate, string>> => {
  const generatedAt = new Date().toISOString();
  const fetchedGroups = await fetchUpcomingDraftKingsClassicDraftGroups();

  if (!fetchedGroups.success) {
    const persisted = await loadPersistedDraftKingsClassicSlate({ date, artifactDir });

    if (
      persisted.success &&
      persisted.data &&
      (!draftGroupId || persisted.data.draft_group.draft_group_id === draftGroupId)
    ) {
      return ok({
        source: "draftkings-classic-persisted",
        date,
        generated_at: generatedAt,
        draft_group: persisted.data.draft_group,
        label: persisted.data.label,
        salary_slate: persisted.data.salary_slate,
        note: null
      });
    }

    const persistedNote = persisted.success ? null : persisted.error;
    if (persistedNote) {
      return err(`${persistedNote}; live DraftKings Classic discovery failed: ${fetchedGroups.error}`);
    }

    return err(fetchedGroups.error);
  }

  const selectedGroup = selectDraftKingsClassicGroup(
    draftGroupId
      ? {
          date,
          draftGroupId,
          groups: fetchedGroups.data
        }
      : {
          date,
          groups: fetchedGroups.data
        }
  );

  if (!selectedGroup) {
    const persisted = await loadPersistedDraftKingsClassicSlate({ date, artifactDir });

    if (
      persisted.success &&
      persisted.data &&
      (!draftGroupId || persisted.data.draft_group.draft_group_id === draftGroupId)
    ) {
      return ok({
        source: "draftkings-classic-persisted",
        date,
        generated_at: generatedAt,
        draft_group: persisted.data.draft_group,
        label: persisted.data.label,
        salary_slate: persisted.data.salary_slate,
        note: null
      });
    }

    const persistedNote = persisted.success ? null : persisted.error;

    return ok({
      source: "draftkings-classic-live",
      date,
      generated_at: generatedAt,
      draft_group: null,
      label: null,
      salary_slate: null,
      note: [
        draftGroupId
          ? `DraftKings Classic draft group ${draftGroupId} was not available.`
          : "No DraftKings Classic salary slate matched the requested date.",
        persistedNote ? `Persisted fallback unavailable: ${persistedNote}` : null
      ]
        .filter((note): note is string => note !== null)
        .join(" ")
    });
  }

  const fetchedSlate = await fetchDraftKingsClassicSalarySlate(
    selectedGroup.draft_group_id
  );

  if (!fetchedSlate.success) {
    return err(fetchedSlate.error);
  }

  const label = buildDraftKingsClassicLabel(selectedGroup);
  const persistedLiveSlate = await persistDraftKingsClassicSlate({
    date,
    artifactDir,
    draftGroup: selectedGroup,
    label,
    salarySlate: fetchedSlate.data
  });

  return ok({
    source: "draftkings-classic-live",
    date,
    generated_at: generatedAt,
    draft_group: selectedGroup,
    label,
    salary_slate: fetchedSlate.data,
    note: persistedLiveSlate.success
      ? null
      : `DraftKings Classic salary slate loaded live but persistence failed: ${persistedLiveSlate.error}`
  });
};
