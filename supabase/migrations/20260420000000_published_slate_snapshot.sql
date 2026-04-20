-- App-facing published slate snapshot.
-- Written once per day by the morning-capture cron after the full pipeline runs.
-- GET /api/slate-snapshot reads from this table instead of recomputing on request.
-- The payload column stores the complete SlateSnapshotPayload JSON so the route
-- is truly display-only: no MLB Stats API calls, no projection computation.
CREATE TABLE IF NOT EXISTS public.published_slate_snapshot (
  date              TEXT        NOT NULL PRIMARY KEY,
  run_id            UUID        REFERENCES public.projection_run(run_id) ON DELETE SET NULL,
  generated_at      TIMESTAMPTZ NOT NULL,
  publication_state TEXT        NOT NULL DEFAULT 'valid',
  degradation       JSONB,
  payload           JSONB       NOT NULL
);

ALTER TABLE public.published_slate_snapshot ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_write_published_slate"
  ON public.published_slate_snapshot
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "anon_read_published_slate"
  ON public.published_slate_snapshot
  FOR SELECT TO anon
  USING (true);

CREATE POLICY "authenticated_read_published_slate"
  ON public.published_slate_snapshot
  FOR SELECT TO authenticated
  USING (true);
