-- Stores captured DraftKings Classic salary slates.
-- Solves the Vercel read-only filesystem problem: persistDraftKingsClassicSlate
-- fails silently on Lambda (ENOENT /var/task/data/draftkings-classic), leaving
-- the DFS Edge board without a fallback once the upcoming endpoint rotates away.
CREATE TABLE IF NOT EXISTS public.dk_classic_snapshots (
  date        TEXT        NOT NULL PRIMARY KEY,
  captured_at TIMESTAMPTZ NOT NULL,
  slate_count INT         NOT NULL,
  payload     JSONB       NOT NULL
);
ALTER TABLE public.dk_classic_snapshots ENABLE ROW LEVEL SECURITY;
