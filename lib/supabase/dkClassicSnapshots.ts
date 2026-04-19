import { getSupabaseWriteClient } from "./writeClient";

const TABLE = "dk_classic_snapshots";

export interface DkClassicSnapshot {
  readonly date: string;
  readonly captured_at: string;
  readonly slate_count: number;
  readonly payload: unknown;
}

export const loadSupabaseDkClassicSnapshot = async (
  date: string
): Promise<DkClassicSnapshot | null> => {
  try {
    const client = getSupabaseWriteClient();
    const { data, error } = await client
      .from(TABLE)
      .select("date, captured_at, slate_count, payload")
      .eq("date", date)
      .maybeSingle();

    if (error || !data) return null;
    return data as DkClassicSnapshot;
  } catch {
    return null;
  }
};

export const storeSupabaseDkClassicSnapshot = async (
  date: string,
  slates: unknown,
  slateCount: number
): Promise<void> => {
  try {
    const client = getSupabaseWriteClient();
    await client.from(TABLE).upsert(
      {
        date,
        captured_at: new Date().toISOString(),
        slate_count: slateCount,
        payload: slates as Record<string, unknown>[]
      },
      { onConflict: "date" }
    );
  } catch {
    // Non-fatal: live data still serves the request if Supabase is unavailable.
  }
};
