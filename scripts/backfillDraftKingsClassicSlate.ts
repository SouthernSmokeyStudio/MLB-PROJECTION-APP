import { pathToFileURL } from "node:url";
import { backfillDraftKingsClassicSlate } from "../lib/services/loadDraftKingsClassicSlate";

const isValidDate = (value: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

export const runBackfillDraftKingsClassicSlateCli = async (
  args: readonly string[],
  io: {
    readonly log: (message: string) => void;
    readonly error: (message: string) => void;
  } = {
    log: console.log,
    error: console.error
  }
): Promise<number> => {
  const date = args[0];

  if (args.length !== 1 || !date || !isValidDate(date)) {
    io.error("[dk-classic-backfill] usage: tsx scripts/backfillDraftKingsClassicSlate.ts YYYY-MM-DD");
    return 1;
  }

  const result = await backfillDraftKingsClassicSlate({ date });

  if (!result.success) {
    io.error(`[dk-classic-backfill] FAILED: ${result.error}`);
    return 1;
  }

  io.log(`[dk-classic-backfill] SUCCESS date=${date}`);
  io.log(`[dk-classic-backfill] artifact: ${result.data.artifactPath}`);
  io.log(`[dk-classic-backfill] slates: ${result.data.slates.length}`);
  return 0;
};

const main = async (): Promise<void> => {
  const code = await runBackfillDraftKingsClassicSlateCli(process.argv.slice(2));
  process.exit(code);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error("[dk-classic-backfill] unhandled error:", error);
    process.exit(1);
  });
}