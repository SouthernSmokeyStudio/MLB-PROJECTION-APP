import type { SlateSnapshotPayload } from "@lib/contracts/slate-snapshot";
import { getSupabaseWriteClient } from "./writeClient";

const TABLE = "published_slate_snapshot";

export interface PublishedSlateSnapshotRow {
  readonly date: string;
  readonly run_id: string | null;
  readonly generated_at: string;
  readonly publication_state: "valid" | "degraded";
  readonly degradation: unknown;
  readonly payload: SlateSnapshotPayload;
}

export const loadPublishedSlateSnapshot = async (
  date: string
): Promise<PublishedSlateSnapshotRow | null> => {
  try {
    const client = getSupabaseWriteClient();
    const { data, error } = await client
      .from(TABLE)
      .select("date, run_id, generated_at, publication_state, degradation, payload")
      .eq("date", date)
      .maybeSingle();

    if (error || !data) return null;
    return data as PublishedSlateSnapshotRow;
  } catch {
    return null;
  }
};

export type StoreSnapshotResult =
  | { ok: true }
  | { ok: false; error: string };

export const storePublishedSlateSnapshot = async (
  row: PublishedSlateSnapshotRow
): Promise<StoreSnapshotResult> => {
  try {
    const client = getSupabaseWriteClient();
    const { error } = await client.from(TABLE).upsert(
      {
        date: row.date,
        run_id: row.run_id,
        generated_at: row.generated_at,
        publication_state: row.publication_state,
        degradation: row.degradation as Record<string, unknown> | null,
        payload: row.payload as unknown as Record<string, unknown>
      },
      { onConflict: "date" }
    );
    if (error) {
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
};
