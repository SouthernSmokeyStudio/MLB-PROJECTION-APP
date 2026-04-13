import { pathToFileURL } from "node:url";
import { captureSportsbookMlbMoneylineSlate } from "../lib/services/loadDraftKingsSportsbookMlbMoneylineSlate";

const isValidDate = (value: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

export const runCaptureSportsbookMlbMoneylineSlateCli = async (
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
    io.error("[dk-sportsbook-capture] usage: npm run capture:dk-sportsbook -- YYYY-MM-DD  (run before DraftKings pregame markets rotate away)");
    return 1;
  }

  const result = await captureSportsbookMlbMoneylineSlate({ date });

  if (!result.success) {
    io.error(`[dk-sportsbook-capture] FAILED: ${result.error}`);
    return 1;
  }

  io.log(`[dk-sportsbook-capture] SUCCESS date=${date}`);
  io.log(`[dk-sportsbook-capture] artifact: ${result.data.artifactPath}`);
  io.log(`[dk-sportsbook-capture] entries: ${result.data.moneyline_slate.entries.length}`);
  return 0;
};

const main = async (): Promise<void> => {
  const code = await runCaptureSportsbookMlbMoneylineSlateCli(process.argv.slice(2));
  process.exitCode = code;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error("[dk-sportsbook-capture] unhandled error:", error);
    process.exitCode = 1;
  });
}
