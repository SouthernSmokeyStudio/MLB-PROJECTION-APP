/**
 * resolveStarterIntelligenceForDate.ts — CLI for manual resolve/proof lane.
 *
 * Reads stored starter intelligence rows for a date, runs canonical
 * current-row resolution per game, and upserts the resolved rows back.
 *
 * Usage:
 *   npx tsx scripts/resolveStarterIntelligenceForDate.ts 2026-04-13
 *
 * Environment:
 *   NEXT_PUBLIC_SUPABASE_URL   — required
 *   SUPABASE_SERVICE_ROLE_KEY  — required
 *
 * Exit codes:
 *   0 — lane succeeded (per-game errors logged as warnings)
 *   1 — date argument invalid, read failure, or lane-level failure
 */

import { pathToFileURL } from "node:url";
import { resolveStarterIntelligenceForDate } from "../lib/starters/resolveStarterIntelligenceForDate";
import { createStarterIntelligenceRepository } from "../lib/starters/repository";
import { getSupabaseWriteClient } from "../lib/supabase/writeClient";

const isValidDate = (value: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

export const runResolveStarterIntelligenceForDateCli = async (
  args: readonly string[],
  io: {
    readonly log: (message: string) => void;
    readonly error: (message: string) => void;
  } = { log: console.log, error: console.error }
): Promise<number> => {
  const date = args[0];

  if (!date || !isValidDate(date)) {
    io.error("[resolve-starters] usage: npx tsx scripts/resolveStarterIntelligenceForDate.ts YYYY-MM-DD");
    return 1;
  }

  io.log(`[resolve-starters] date=${date}`);

  const client = getSupabaseWriteClient();
  const repository = createStarterIntelligenceRepository(client);

  const result = await resolveStarterIntelligenceForDate(date, repository);

  if (!result.success) {
    io.error(`[resolve-starters] LANE FAILURE: ${result.error}`);
    return 1;
  }

  io.log(`[resolve-starters] resolved=${result.data.resolved} skipped=${result.data.skipped} errors=${result.data.errors.length}`);

  for (const e of result.data.errors) {
    io.error(`[resolve-starters] GAME WARNING: ${e}`);
  }

  return 0;
};

const main = async (): Promise<void> => {
  const code = await runResolveStarterIntelligenceForDateCli(process.argv.slice(2));
  process.exit(code);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error("[resolve-starters] unhandled error:", error);
    process.exit(1);
  });
}
