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

export const upsertGameProjections = async (
  rows: readonly GameProjectionUpsertRow[]
): Promise<void> => {
  if (rows.length === 0) return;
  try {
    const client = getSupabaseWriteClient();
    await client
      .from(TABLE)
      .upsert(rows as unknown as Record<string, unknown>[], {
        onConflict: "projection_date,game_id"
      });
  } catch {
    // Non-fatal: missing game_projections rows don't block the publish pipeline.
    // The published_slate_snapshot is the primary app-facing surface.
  }
};
