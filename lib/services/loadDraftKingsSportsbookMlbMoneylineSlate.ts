import { fetchDraftKingsSportsbookMlbMoneylineSlate } from "@lib/adapters/draftKingsSportsbook";
import type { DraftKingsSportsbookMlbMoneylineSlate } from "@lib/contracts/draftkings-sportsbook-mlb-moneyline";
import { err, ok, type Result } from "@lib/contracts/types";

export interface LoadedDraftKingsSportsbookMlbMoneylineSlate {
  readonly source: "draftkings-sportsbook-mlb-moneyline-live";
  readonly date: string;
  readonly generated_at: string;
  readonly moneyline_slate: DraftKingsSportsbookMlbMoneylineSlate | null;
  readonly note: string | null;
}

export const loadDraftKingsSportsbookMlbMoneylineSlate = async ({
  date
}: {
  readonly date: string;
}): Promise<Result<LoadedDraftKingsSportsbookMlbMoneylineSlate, string>> => {
  const generatedAt = new Date().toISOString();
  const fetched = await fetchDraftKingsSportsbookMlbMoneylineSlate();

  if (!fetched.success) {
    return err(fetched.error);
  }

  const filteredEntries = fetched.data.entries.filter(
    (entry) => entry.start_time.slice(0, 10) === date
  );

  if (filteredEntries.length === 0) {
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
