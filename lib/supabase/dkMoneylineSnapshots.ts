import type { DraftKingsSportsbookMlbMoneylineSlate } from "@lib/contracts/draftkings-sportsbook-mlb-moneyline";
import { getSupabaseWriteClient } from "./writeClient";

const TABLE = "dk_sportsbook_moneyline_snapshots";

export interface DkMoneylineSnapshot {
  readonly date: string;
  readonly captured_at: string;
  readonly entry_count: number;
  readonly payload: DraftKingsSportsbookMlbMoneylineSlate;
}

export const loadSupabaseDkMoneylineSnapshot = async (
  date: string
): Promise<DkMoneylineSnapshot | null> => {
  try {
    const client = getSupabaseWriteClient();
    const { data, error } = await client
      .from(TABLE)
      .select("date, captured_at, entry_count, payload")
      .eq("date", date)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    return data as DkMoneylineSnapshot;
  } catch {
    return null;
  }
};

export const storeSupabaseDkMoneylineSnapshot = async (
  date: string,
  slate: DraftKingsSportsbookMlbMoneylineSlate
): Promise<void> => {
  try {
    const client = getSupabaseWriteClient();
    await client.from(TABLE).upsert(
      {
        date,
        captured_at: new Date().toISOString(),
        entry_count: slate.entries.length,
        payload: slate as unknown as Record<string, unknown>
      },
      { onConflict: "date" }
    );
  } catch {
    // Non-fatal: if Supabase is unavailable, live data still serves the request.
  }
};
