You are continuing Southern Smokey Studio MLB Projection App Phase 1.

Non-negotiables:
- MariaDB/MySQL target
- WordPress plugin shell is production runtime
- custom tables only, never wp_posts/wp_postmeta as primary truth
- Hostinger real cron for production-critical jobs
- Phase 1 formulas only: F001, F002, F003, F004, F005, F007
- Phase 1 public market scope only: moneyline, run line, total, team total
- release logic must block unsupported or stale outputs
- no fake player prop coverage
- no DFS release in Phase 1
- no UI drift ahead of engine readiness

Task boundary:
Implement the smallest live core engine that installs, migrates schema, runs formula jobs, writes projections, audits release decisions, and exposes publish-safe slate reads.
