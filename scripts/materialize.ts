/**
 * materialize.ts — CLI entry point for scheduled materialization.
 *
 * Usage:
 *   npx tsx scripts/materialize.ts                        # today, full merge
 *   npx tsx scripts/materialize.ts 2026-04-10             # explicit date, full merge
 *   npx tsx scripts/materialize.ts --official-only        # official tier only (no projected/inferred)
 *   npx tsx scripts/materialize.ts --dry-run              # log config, don't write
 *
 * Environment:
 *   ROTOWIRE_ENDPOINT_URL — required unless --official-only is set
 *   ROTOWIRE_TIMEOUT_MS   — optional fetch timeout override
 *
 * Exit codes:
 *   0 — success
 *   1 — materialization failed (config, fetch, merge, or write error)
 */

import { materializeSlate } from "../lib/materializer/materializeSlate";
import { buildMaterializerConfig } from "../lib/materializer/buildMaterializerConfig";
import {
  getDateInScheduleTimezone,
  MATERIALIZATION_SCHEDULE,
  MATERIALIZATION_TIMEZONE
} from "../lib/materializer/schedule";

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const officialOnly = args.includes("--official-only");
  const dateArg = args.find((a) => !a.startsWith("--"));
  const date = dateArg ?? getDateInScheduleTimezone();

  console.log(`[materialize] date=${date} timezone=${MATERIALIZATION_TIMEZONE} dry-run=${dryRun} official-only=${officialOnly}`);
  console.log(`[materialize] schedule: ${MATERIALIZATION_SCHEDULE.map((s) => `${String(s.hour).padStart(2, "0")}:${String(s.minute).padStart(2, "0")} (${s.label})`).join(", ")}`);

  // Build config from env + flags
  const config = buildMaterializerConfig(
    {
      ROTOWIRE_ENDPOINT_URL: process.env.ROTOWIRE_ENDPOINT_URL,
      ROTOWIRE_TIMEOUT_MS: process.env.ROTOWIRE_TIMEOUT_MS
    },
    { officialOnly }
  );
  if (!config.success) {
    console.error(`[materialize] CONFIG ERROR: ${config.error}`);
    process.exit(1);
  }

  const { projectedAdapter, inferenceEngine, officialOnly: isOfficialOnly } = config.data;
  console.log(`[materialize] projected adapter: ${projectedAdapter?.source ?? "none"}`);
  console.log(`[materialize] inference engine: ${inferenceEngine?.engine ?? "none"}`);

  if (dryRun) {
    console.log("[materialize] dry-run mode — no artifact will be written");
    console.log(`[materialize] would materialize date=${date} official-only=${isOfficialOnly}`);
    process.exit(0);
  }

  const result = await materializeSlate({
    date,
    ...(projectedAdapter ? { projectedAdapter } : {}),
    ...(inferenceEngine ? { inferenceEngine } : {})
  });

  if (!result.success) {
    console.error(`[materialize] FAILED: ${result.error}`);
    process.exit(1);
  }

  const { artifactPath, gamesWritten, projectedGamesAvailable, inferredGamesAvailable } = result.data;
  console.log(`[materialize] SUCCESS`);
  console.log(`[materialize]   artifact: ${artifactPath}`);
  console.log(`[materialize]   games: ${gamesWritten}`);
  console.log(`[materialize]   projected available: ${projectedGamesAvailable}`);
  console.log(`[materialize]   inferred available: ${inferredGamesAvailable}`);
};

main().catch((err) => {
  console.error(`[materialize] unhandled error:`, err);
  process.exit(1);
});
