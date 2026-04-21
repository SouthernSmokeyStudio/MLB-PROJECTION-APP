import { getSupabaseWriteClient } from "./writeClient";

const TABLE = "game_projections";

export interface GameProjectionUpsertRow {
  readonly projection_date: string;
  readonly game_id: string;
  readonly sport_id: string;
  readonly away_team_id: string;
  readonly home_team_id: string;
  readonly run_id: string | null;
  readonly scheduled_start: string | null;
  readonly projected_away_runs: number | null;
  readonly projected_home_runs: number | null;
  readonly projected_total_runs: number | null;
  readonly projected_away_win_probability: number | null;
  readonly projected_home_win_probability: number | null;
  readonly is_blocked: boolean;
  readonly blocked_reason: string | null;
  readonly is_stale: boolean;
  readonly source_run_key: string | null;
  readonly source_generated_at: string | null;
}

export type UpsertGameProjectionsResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string };

export const upsertGameProjections = async (
  rows: readonly GameProjectionUpsertRow[]
): Promise<UpsertGameProjectionsResult> => {
  if (rows.length === 0) return { ok: true };
  try {
    const client = getSupabaseWriteClient();
    const { error } = await client
      .from(TABLE)
      .upsert(rows as unknown as Record<string, unknown>[], {
        onConflict: "projection_date,game_id"
      });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
};
