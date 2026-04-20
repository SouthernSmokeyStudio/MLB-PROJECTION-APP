-- Activate game_projections as the row-level parent truth for game-level
-- projection facts.  Extends the schema.sql baseline with:
--   run_id            — links each projection row back to the projection_run
--                       that produced it, enabling lineage queries.
--   projected_away/home_win_probability — simulation-derived win probs required
--                       by the betting edge board and downstream consumers.
--   scheduled_start   — game start timestamp for chronological ordering without
--                       a secondary join to the schedule source.
ALTER TABLE public.game_projections
  ADD COLUMN IF NOT EXISTS run_id                         UUID        REFERENCES public.projection_run(run_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS projected_away_win_probability NUMERIC,
  ADD COLUMN IF NOT EXISTS projected_home_win_probability NUMERIC,
  ADD COLUMN IF NOT EXISTS scheduled_start               TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_game_projections_run_id
  ON public.game_projections(run_id);

CREATE INDEX IF NOT EXISTS idx_game_projections_date_start
  ON public.game_projections(projection_date, scheduled_start);
