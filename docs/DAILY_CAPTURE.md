# Daily Capture Runbook

## When to run

Both commands must run **before** the live DraftKings source rotates away from
the requested game date. Once the upstream feed no longer carries that date's
entries no fresh capture is possible and the honest failure message is returned.

Typical safe window: any time on game day before first pitch of the last game
(America/Chicago). Running in the morning is safest.

## Commands

### DraftKings Classic salary slate

```
npm run capture:dk-classic -- YYYY-MM-DD
```

Example:
```
npm run capture:dk-classic -- 2026-04-13
```

On success the artifact is written to `data/draftkings-classic/YYYY-MM-DD.json`
and the loader falls back to it automatically after the upcoming feed rotates.

### DraftKings Sportsbook MLB pregame moneyline

```
npm run capture:dk-sportsbook -- YYYY-MM-DD
```

Example:
```
npm run capture:dk-sportsbook -- 2026-04-13
```

On success the artifact is written to
`data/draftkings-sportsbook-moneyline/YYYY-MM-DD.json` and the loader falls
back to it automatically after pregame markets rotate away.

## What happens when the window is already missed

Both commands fail explicitly with an honest message and write nothing:

- `FAILED: ... same-day capture may already be too late ...`
- `FAILED: DraftKings Classic upcoming capture no longer includes <date>; replay requires a previously captured artifact at ...`

No magical recovery is implied. If an artifact was already captured on that date
the loader will use it automatically without rerunning the capture command.

## Scheduled automation

Not yet in place. This runbook is the operator-facing daily path until a
scheduled capture layer is added.