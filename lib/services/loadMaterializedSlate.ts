import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  LoadedMaterializedSlate,
  MaterializedSlate
} from "@lib/contracts/materialized-slate";
import { asISOTimestamp, err, ok, type Result } from "@lib/contracts/types";

/** Artifacts older than 24 hours are considered stale. */
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/** Default directory relative to the project root. */
const DEFAULT_ARTIFACT_DIR = join(process.cwd(), "data", "materialized");

export interface LoadMaterializedSlateOptions {
  readonly artifactDir?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Validates the minimal shape of a parsed JSON blob as a MaterializedSlate.
 * Does NOT deep-validate each PreparedGameInputs — the projection pipeline
 * handles null/missing fields gracefully downstream.
 */
const validateShape = (
  parsed: unknown,
  expectedDate: string
): Result<MaterializedSlate, string> => {
  if (!isRecord(parsed)) {
    return err("Materialized slate root is not an object");
  }

  if (parsed.version !== 1) {
    return err(`Unsupported materialized slate version: ${String(parsed.version)}`);
  }

  if (typeof parsed.date !== "string") {
    return err("Materialized slate missing 'date' field");
  }

  if (parsed.date !== expectedDate) {
    return err(
      `Materialized slate date mismatch: expected ${expectedDate}, got ${parsed.date}`
    );
  }

  if (typeof parsed.generated_at !== "string") {
    return err("Materialized slate missing 'generated_at' field");
  }

  if (typeof parsed.source !== "string") {
    return err("Materialized slate missing 'source' field");
  }

  if (!Array.isArray(parsed.games)) {
    return err("Materialized slate missing 'games' array");
  }

  for (let i = 0; i < parsed.games.length; i++) {
    const entry = parsed.games[i];
    if (!isRecord(entry)) {
      return err(`Materialized slate games[${i}] is not an object`);
    }
    if (typeof entry.game_id !== "string") {
      return err(`Materialized slate games[${i}] missing 'game_id'`);
    }
    if (!isRecord(entry.prepared)) {
      return err(`Materialized slate games[${i}] missing 'prepared' object`);
    }
    if (typeof (entry.prepared as Record<string, unknown>).game_id !== "string") {
      return err(`Materialized slate games[${i}].prepared missing 'game_id'`);
    }
  }

  return ok(parsed as unknown as MaterializedSlate);
};

/**
 * Loads a materialized slate artifact from disk for the given date.
 *
 * Returns `err` (not throws) for every failure mode:
 * - file missing
 * - file unreadable
 * - JSON parse failure
 * - schema validation failure
 *
 * The caller decides whether to fall back to live-only.
 */
export const loadMaterializedSlate = async (
  date: string,
  options?: LoadMaterializedSlateOptions
): Promise<Result<LoadedMaterializedSlate, string>> => {
  const artifactDir = options?.artifactDir ?? DEFAULT_ARTIFACT_DIR;
  const artifactPath = join(artifactDir, `${date}.json`);
  const loadedAt = asISOTimestamp(new Date().toISOString());

  let raw: string;

  try {
    raw = await readFile(artifactPath, "utf-8");
  } catch (cause: unknown) {
    const code = isRecord(cause) ? (cause as { code?: string }).code : undefined;

    if (code === "ENOENT") {
      return err(`No materialized slate artifact found at ${artifactPath}`);
    }

    return err(`Failed to read materialized slate artifact: ${String(cause)}`);
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return err(`Materialized slate artifact is not valid JSON: ${artifactPath}`);
  }

  const validated = validateShape(parsed, date);

  if (!validated.success) {
    return err(validated.error);
  }

  const slate = validated.data;
  const generatedAtMs = new Date(slate.generated_at).getTime();
  const nowMs = Date.now();
  const ageMs = Math.max(0, nowMs - generatedAtMs);
  const isStale = ageMs > STALE_THRESHOLD_MS;

  return ok({
    slate,
    metadata: {
      artifact_path: artifactPath,
      loaded_at: loadedAt,
      is_stale: isStale,
      stale_reason: isStale
        ? `Materialized slate is ${Math.round(ageMs / 3_600_000)}h old (threshold: 24h)`
        : null,
      age_ms: ageMs,
      games_available: slate.games.length
    }
  });
};
