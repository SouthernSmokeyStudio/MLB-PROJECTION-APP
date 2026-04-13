/**
 * ingestRotowireProjectedStarters.ts — CLI entry point for RotoWire
 * projected starter ingest.
 *
 * Usage:
 *   npx tsx scripts/ingestRotowireProjectedStarters.ts
 *   npx tsx scripts/ingestRotowireProjectedStarters.ts 2026-04-13
 *
 * Environment:
 *   ROTOWIRE_ENDPOINT_URL      — required
 *   ROTOWIRE_TIMEOUT_MS        — optional
 *   NEXT_PUBLIC_SUPABASE_URL   — required
 *   SUPABASE_SERVICE_ROLE_KEY  — required
 *
 * Exit codes:
 *   0 — success (per-game errors logged as warnings; ingested count logged)
 *   1 — config, fetch, or ingest failure
 */

import { pathToFileURL } from "node:url";
import { buildMaterializerConfig } from "../lib/materializer/buildMaterializerConfig";
import { getDateInScheduleTimezone } from "../lib/materializer/schedule";
import { ingestRotowireProjectedStarters } from "../lib/starters/ingestRotowireProjectedStarters";
import { createStarterIntelligenceRepository } from "../lib/starters/repository";
import { getSupabaseWriteClient } from "../lib/supabase/writeClient";

export const runIngestRotowireProjectedStartersCli = async (
  args: readonly string[],
  io: {
    readonly log: (message: string) => void;
    readonly error: (message: string) => void;
  } = { log: console.log, error: console.error }
): Promise<number> => {
  const dateArg = args.find((a) => !a.startsWith("--"));
  const date = dateArg ?? getDateInScheduleTimezone();

  io.log(`[ingest-rotowire-starters] date=${date}`);

  const config = buildMaterializerConfig(
    {
      ROTOWIRE_ENDPOINT_URL: process.env.ROTOWIRE_ENDPOINT_URL,
      ROTOWIRE_TIMEOUT_MS: process.env.ROTOWIRE_TIMEOUT_MS
    },
    { officialOnly: false }
  );

  if (!config.success) {
    io.error(`[ingest-rotowire-starters] CONFIG ERROR: ${config.error}`);
    return 1;
  }

  if (!config.data.projectedAdapter) {
    io.error("[ingest-rotowire-starters] no projected adapter available — check ROTOWIRE_ENDPOINT_URL");
    return 1;
  }

  const fetched = await config.data.projectedAdapter.fetchProjectedData(date);
  if (!fetched.success) {
    io.error(`[ingest-rotowire-starters] FETCH ERROR: ${fetched.error}`);
    return 1;
  }

  const client = getSupabaseWriteClient();
  const repository = createStarterIntelligenceRepository(client);

  const result = await ingestRotowireProjectedStarters(fetched.data, repository);

  if (!result.success) {
    io.error(`[ingest-rotowire-starters] INGEST ERROR: ${result.error}`);
    return 1;
  }

  io.log(`[ingest-rotowire-starters] ingested=${result.data.ingested} errors=${result.data.errors.length}`);

  for (const e of result.data.errors) {
    io.error(`[ingest-rotowire-starters] GAME WARNING: ${e}`);
  }

  return 0;
};

const main = async (): Promise<void> => {
  const code = await runIngestRotowireProjectedStartersCli(process.argv.slice(2));
  process.exit(code);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error("[ingest-rotowire-starters] unhandled error:", error);
    process.exit(1);
  });
}
