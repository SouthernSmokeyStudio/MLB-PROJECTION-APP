-- Stores captured DraftKings Sportsbook MLB pregame moneyline slates.
-- Solves the Vercel read-only filesystem problem: the previous file-based
-- artifact system silently failed in production, so games whose moneylines
-- were only available before first pitch were permanently lost once they started.
-- Now the captured slate survives Lambda restarts and is preferred over the
-- live feed whenever it has more entries (i.e., it captured games that have
-- since started and rotated out of the DK NOT_STARTED feed).

CREATE TABLE IF NOT EXISTS public.dk_sportsbook_moneyline_snapshots (
  date         TEXT        NOT NULL PRIMARY KEY,
  captured_at  TIMESTAMPTZ NOT NULL,
  entry_count  INT         NOT NULL,
  payload      JSONB       NOT NULL
);

-- Service role bypasses RLS; anon/authenticated keys have no access.
ALTER TABLE public.dk_sportsbook_moneyline_snapshots ENABLE ROW LEVEL SECURITY;
