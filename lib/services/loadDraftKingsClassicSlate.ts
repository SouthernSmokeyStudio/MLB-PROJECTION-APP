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
import { getDateInScheduleTimezone } from "@lib/materializer/schedule";
import {
  loadSupabaseDkClassicSnapshot,
  storeSupabaseDkClassicSnapshot
} from "@lib/supabase/dkClassicSnapshots";

const MLB_SPORT_ID = 2;
const DRAFTKINGS_CLASSIC_CONTEST_TYPE_ID = 28;
const DRAFTKINGS_CLASSIC_GAME_TYPE_ID = 2;
const PERSISTED_DK_CLASSIC_VERSION = 2;
const DEFAULT_ARTIFACT_DIR = join(process.cwd(), "data", "draftkings-classic");

/** One salary slate with its draft group metadata. */
export interface LoadedDraftKingsClassicSlateItem {
  readonly draft_group_id: string;
  readonly label: string;
  readonly min_start_time: string;
  readonly max_start_time: string;
  readonly salary_slate: DraftKingsClassicSalarySlate;
}

export interface LoadedDraftKingsClassicSlate {
  readonly source: "draftkings-classic-live" | "draftkings-classic-supabase" | "draftkings-classic-persisted";
  readonly date: string;
  readonly generated_at: string;
  /** All same-date Classic slates discovered. Empty when none matched. */
  readonly slates: readonly LoadedDraftKingsClassicSlateItem[];
  readonly note: string | null;
}

export interface LoadDraftKingsClassicSlateOptions {
  readonly date: string;
  readonly draftGroupId?: string;
  readonly artifactDir?: string;
}

/** One entry inside the version-2 persisted artifact. */
interface PersistedDraftKingsClassicSlateEntry {
  readonly draft_group: DraftKingsClassicDraftGroup;
  readonly label: string;
  readonly salary_slate: DraftKingsClassicSalarySlate;
}

/**
 * Version 2 ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â multi-slate artifact.  All same-date Classic slates are stored
 * in a `slates` array so that the fallback path can reconstruct the full
 * same-date inventory when the live upstream has rotated away.
 *
 * Version 1 (single-slate) is still accepted on read for backward compat.
 */
interface PersistedDraftKingsClassicSlate {
  readonly version: 2;
  readonly date: string;
  readonly persisted_at: string;
  readonly source: "draftkings-classic-upcoming";
  readonly slates: readonly PersistedDraftKingsClassicSlateEntry[];
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

/**
 * Validates a persisted artifact and returns a normalised array of slate
 * entries regardless of the on-disk version.
 *
 * Version 1 (single draft_group / salary_slate at root) is accepted for
 * backward compat and promoted to a one-element array.
 * Version 2 (slates[] array) is the current format.
 */
const parsePersistedDraftKingsClassicSlate = (
  parsed: unknown,
  expectedDate: string
): Result<readonly PersistedDraftKingsClassicSlateEntry[], string> => {
  if (!isRecord(parsed)) {
    return err("DraftKings Classic artifact root is not an object");
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

  // ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ Version 1 (single-slate, backward compat) ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬
  if (parsed.version === 1) {
    if (!isDraftGroup(parsed.draft_group)) {
      return err("DraftKings Classic artifact (v1) has invalid draft_group");
    }

    if (typeof parsed.label !== "string" || parsed.label.length === 0) {
      return err("DraftKings Classic artifact (v1) has invalid label");
    }

    if (!isSalarySlate(parsed.salary_slate)) {
      return err("DraftKings Classic artifact (v1) has invalid salary_slate");
    }

    if (parsed.salary_slate.draft_group_id !== parsed.draft_group.draft_group_id) {
      return err("DraftKings Classic artifact (v1) draft_group_id mismatch");
    }

    return ok([
      {
        draft_group: parsed.draft_group as DraftKingsClassicDraftGroup,
        label: parsed.label as string,
        salary_slate: parsed.salary_slate as DraftKingsClassicSalarySlate
      }
    ]);
  }

  // ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ Version 2 (multi-slate array) ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬
  if (parsed.version !== PERSISTED_DK_CLASSIC_VERSION) {
    return err(`Unsupported DraftKings Classic artifact version: ${String(parsed.version)}`);
  }

  if (!Array.isArray(parsed.slates) || parsed.slates.length === 0) {
    return err("DraftKings Classic artifact (v2) missing or empty slates array");
  }

  const entries: PersistedDraftKingsClassicSlateEntry[] = [];

  for (const raw of parsed.slates as unknown[]) {
    if (!isRecord(raw)) {
      return err("DraftKings Classic artifact (v2) slates entry is not an object");
    }

    if (!isDraftGroup(raw.draft_group)) {
      return err("DraftKings Classic artifact (v2) slates entry has invalid draft_group");
    }

    if (typeof raw.label !== "string" || raw.label.length === 0) {
      return err("DraftKings Classic artifact (v2) slates entry has invalid label");
    }

    if (!isSalarySlate(raw.salary_slate)) {
      return err("DraftKings Classic artifact (v2) slates entry has invalid salary_slate");
    }

    if (raw.salary_slate.draft_group_id !== raw.draft_group.draft_group_id) {
      return err("DraftKings Classic artifact (v2) slates entry draft_group_id mismatch");
    }

    entries.push({
      draft_group: raw.draft_group as DraftKingsClassicDraftGroup,
      label: raw.label as string,
      salary_slate: raw.salary_slate as DraftKingsClassicSalarySlate
    });
  }

  return ok(entries);
};

const loadPersistedDraftKingsClassicSlate = async ({
  date,
  artifactDir
}: {
  readonly date: string;
  readonly artifactDir: string;
}): Promise<Result<readonly LoadedDraftKingsClassicSlateItem[] | null, string>> => {
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

  const result = parsePersistedDraftKingsClassicSlate(parsed, date);
  if (!result.success) {
    return result;
  }

  return ok(
    result.data.map((entry) => ({
      draft_group_id: entry.draft_group.draft_group_id,
      label: entry.label,
      min_start_time: entry.draft_group.min_start_time,
      max_start_time: entry.draft_group.max_start_time,
      salary_slate: entry.salary_slate
    }))
  );
};

const persistDraftKingsClassicSlate = async ({
  date,
  artifactDir,
  slates
}: {
  readonly date: string;
  readonly artifactDir: string;
  /** All successfully fetched same-date slates ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â the full inventory is persisted
   *  so the fallback path can reconstruct a complete salary_slate_inventory. */
  readonly slates: ReadonlyArray<{
    readonly draftGroup: DraftKingsClassicDraftGroup;
    readonly label: string;
    readonly salarySlate: DraftKingsClassicSalarySlate;
  }>;
}): Promise<Result<string, string>> => {
  const artifactPath = getArtifactPath(date, artifactDir);
  const artifact: PersistedDraftKingsClassicSlate = {
    version: PERSISTED_DK_CLASSIC_VERSION,
    date,
    persisted_at: asISOTimestamp(new Date().toISOString()),
    source: "draftkings-classic-upcoming",
    slates: slates.map(({ draftGroup, label, salarySlate }) => ({
      draft_group: draftGroup,
      label,
      salary_slate: salarySlate
    }))
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

/** When draftGroupId is provided, selects that single group. Otherwise, selects ALL
 *  same-date MLB Classic groups sorted by sort_order then min_start_time. */
const selectDraftKingsClassicGroups = ({
  date,
  draftGroupId,
  groups
}: {
  readonly date: string;
  readonly draftGroupId?: string;
  readonly groups: readonly DraftKingsClassicDraftGroup[];
}): readonly DraftKingsClassicDraftGroup[] => {
  if (draftGroupId) {
    const found = groups.find(
      (group) =>
        group.draft_group_id === draftGroupId &&
        isDraftKingsClassicGroup(group) &&
        group.min_start_time.slice(0, 10) === date
    );
    return found ? [found] : [];
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
    });
};

const upcomingDiscoveryHasRotatedPastDate = ({
  date
}: {
  readonly date: string;
}): boolean => date < getDateInScheduleTimezone();


const buildUncapturedPastDateMessage = ({
  date,
  artifactDir
}: {
  readonly date: string;
  readonly artifactDir: string;
}): string =>
  `DraftKings Classic upcoming capture no longer includes ${date}; replay requires a previously captured artifact at ${getArtifactPath(date, artifactDir)}.`;

export const backfillDraftKingsClassicSlate = async ({
  date,
  artifactDir = DEFAULT_ARTIFACT_DIR
}: Pick<LoadDraftKingsClassicSlateOptions, "date" | "artifactDir">): Promise<
  Result<
    {
      /** Filesystem artifact path if written; null on environments where the
       *  filesystem is read-only (e.g. Vercel Lambda). Supabase is the
       *  authoritative persistence path — this is a local-dev convenience. */
      readonly artifactPath: string | null;
      readonly slates: readonly LoadedDraftKingsClassicSlateItem[];
    },
    string
  >
> => {
  const fetchedGroups = await fetchUpcomingDraftKingsClassicDraftGroups();

  if (!fetchedGroups.success) {
    return err(fetchedGroups.error);
  }

  const selectedGroups = selectDraftKingsClassicGroups({
    date,
    groups: fetchedGroups.data
  });

  if (selectedGroups.length === 0) {
    return err(
      upcomingDiscoveryHasRotatedPastDate({ date })
        ? buildUncapturedPastDateMessage({ date, artifactDir })
        : "No DraftKings Classic salary slate matched the requested date."
    );
  }

  const fetchedSlates = await Promise.all(
    selectedGroups.map((group) => fetchDraftKingsClassicSalarySlate(group.draft_group_id))
  );

  const slates: LoadedDraftKingsClassicSlateItem[] = [];
  const persistEntries: Array<{
    readonly draftGroup: DraftKingsClassicDraftGroup;
    readonly label: string;
    readonly salarySlate: DraftKingsClassicSalarySlate;
  }> = [];

  for (let i = 0; i < selectedGroups.length; i++) {
    const group = selectedGroups[i];
    const result = fetchedSlates[i];
    if (!group || !result) continue;
    if (!result.success) continue;
    const label = buildDraftKingsClassicLabel(group);
    slates.push({
      draft_group_id: group.draft_group_id,
      label,
      min_start_time: group.min_start_time,
      max_start_time: group.max_start_time,
      salary_slate: result.data
    });
    persistEntries.push({ draftGroup: group, label, salarySlate: result.data });
  }

  if (slates.length === 0) {
    return err("All DraftKings Classic salary slate fetches failed");
  }

  // Write to Supabase (survives Lambda restarts) — this is the authoritative
  // production persistence path.
  await storeSupabaseDkClassicSnapshot(date, slates, slates.length);

  // Write to local filesystem for local-dev replay convenience.
  // This write is non-fatal: Vercel's /var/task is read-only and will produce
  // ENOENT on mkdir. Production runs on Supabase only.
  const persistResult = await persistDraftKingsClassicSlate({
    date,
    artifactDir,
    slates: persistEntries
  });

  const artifactPath = persistResult.success ? persistResult.data : null;

  return ok({
    artifactPath,
    slates
  });
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

    if (persisted.success && persisted.data && persisted.data.length > 0) {
      const filteredSlates = draftGroupId
        ? persisted.data.filter((s) => s.draft_group_id === draftGroupId)
        : persisted.data;

      if (filteredSlates.length > 0) {
        return ok({
          source: "draftkings-classic-persisted",
          date,
          generated_at: generatedAt,
          slates: filteredSlates,
          note: null
        });
      }
    }

    const persistedNote = persisted.success ? null : persisted.error;
    if (persistedNote) {
      return err(`${persistedNote}; live DraftKings Classic discovery failed: ${fetchedGroups.error}`);
    }

    return err(fetchedGroups.error);
  }

  const selectedGroups = selectDraftKingsClassicGroups(
    draftGroupId
      ? { date, draftGroupId, groups: fetchedGroups.data }
      : { date, groups: fetchedGroups.data }
  );

  if (selectedGroups.length === 0) {
    // Try Supabase first — survives Lambda restarts unlike the filesystem artifact.
    const snapshot = await loadSupabaseDkClassicSnapshot(date);
    if (snapshot && snapshot.slate_count > 0) {
      const storedSlates = snapshot.payload as LoadedDraftKingsClassicSlateItem[];
      const filteredSlates = draftGroupId
        ? storedSlates.filter((s) => s.draft_group_id === draftGroupId)
        : storedSlates;
      if (filteredSlates.length > 0) {
        return ok({
          source: "draftkings-classic-supabase",
          date,
          generated_at: generatedAt,
          slates: filteredSlates,
          note: null
        });
      }
    }

    const persisted = await loadPersistedDraftKingsClassicSlate({ date, artifactDir });

    if (persisted.success && persisted.data && persisted.data.length > 0) {
      const filteredSlates = draftGroupId
        ? persisted.data.filter((s) => s.draft_group_id === draftGroupId)
        : persisted.data;

      if (filteredSlates.length > 0) {
        return ok({
          source: "draftkings-classic-persisted",
          date,
          generated_at: generatedAt,
          slates: filteredSlates,
          note: null
        });
      }
    }

    const persistedNote = persisted.success ? null : persisted.error;

    if (upcomingDiscoveryHasRotatedPastDate({ date })) {
      return err(buildUncapturedPastDateMessage({ date, artifactDir }));
    }

    return ok({
      source: "draftkings-classic-live",
      date,
      generated_at: generatedAt,
      slates: [],
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

  // Fetch all selected groups in parallel
  // Fetch all selected groups in parallel
  const fetchedSlates = await Promise.all(
    selectedGroups.map((group) => fetchDraftKingsClassicSalarySlate(group.draft_group_id))
  );

  const slates: LoadedDraftKingsClassicSlateItem[] = [];
  /** Parallel array carrying the full DraftGroup for each successfully fetched
   *  slate ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â needed to persist group metadata alongside the salary data. */
  const persistEntries: Array<{
    readonly draftGroup: DraftKingsClassicDraftGroup;
    readonly label: string;
    readonly salarySlate: DraftKingsClassicSalarySlate;
  }> = [];

  for (let i = 0; i < selectedGroups.length; i++) {
    const group = selectedGroups[i];
    const result = fetchedSlates[i];
    if (!group || !result) continue;
    if (!result.success) continue;
    const label = buildDraftKingsClassicLabel(group);
    slates.push({
      draft_group_id: group.draft_group_id,
      label,
      min_start_time: group.min_start_time,
      max_start_time: group.max_start_time,
      salary_slate: result.data
    });
    persistEntries.push({ draftGroup: group, label, salarySlate: result.data });
  }

  if (slates.length === 0) {
    return err("All DraftKings Classic salary slate fetches failed");
  }

  // Persist ALL successfully fetched same-date slates as the date-keyed fallback.
  // The full inventory is needed so the fallback path can reconstruct the complete
  // salary_slate_inventory when the live upcoming API rotates away from today's groups.
  // Supabase is the primary fallback (survives Lambda restarts); filesystem is secondary.
  await storeSupabaseDkClassicSnapshot(date, slates, slates.length);

  const persistResult = await persistDraftKingsClassicSlate({
    date,
    artifactDir,
    slates: persistEntries
  });

  return ok({
    source: "draftkings-classic-live",
    date,
    generated_at: generatedAt,
    slates,
    note: persistResult.success
      ? null
      : `DraftKings Classic salary slate loaded live but persistence failed: ${persistResult.error}`
  });
};
