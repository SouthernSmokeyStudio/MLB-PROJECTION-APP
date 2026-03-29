# SSS MLB Projections — Phase 1 Plugin Pack

This is the Phase 1 WordPress plugin shell for the Southern Smokey Studio MLB Projection App.

## What is included

- WordPress plugin bootstrap
- MariaDB/MySQL custom table schema via `dbDelta()`
- seeded reference rows for MLB + DraftKings core markets
- Phase 1 formula classes:
  - F001
  - F002
  - F003
  - F004
  - F005
  - F007
- release manager with Phase 1 block / publish logic
- cron hooks and WP-CLI runner
- REST read endpoint for published slate rows

## What is not included

- external provider adapters
- full DraftKings normalization pipeline
- F006, F008, F009, F010
- F011/F012 full maturity
- public front-end integration
- backtest engine

## Install

1. Copy `sss-mlb-projections` into `wp-content/plugins/`
2. Activate the plugin
3. Confirm custom tables were created
4. Use WP-CLI:
   - `wp sss-mlb run --job=full`
   - `wp sss-mlb run --job=ingest`
   - `wp sss-mlb run --job=results`

## Production cron recommendation

Prefer Hostinger real cron to call WP-CLI or a secured internal runner.
Do not rely on traffic-only WP-Cron for production-critical projection jobs.
