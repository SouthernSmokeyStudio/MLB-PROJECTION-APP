# Phase 1 Implementation Overlay

This folder is the repo-facing handoff for Codex.

## Immediate target

Bring the public repo from:
- contracts
- checks
- fixtures
- tests
- minimal Next.js shell

to a real Phase 1 live core engine that integrates a WordPress plugin shell for production deployment and keeps the Next.js repo as the engine-side planning/testing root.

## Recommended repo actions

1. Add `/wordpress-plugin/sss-mlb-projections/`
2. Add `/docs/phase1/`
3. Add `AGENTS.md` updates that lock:
   - WordPress plugin shell is deployment target
   - MariaDB/MySQL is DB target
   - F001/F002/F003/F004/F005/F007 only in Phase 1
   - only game core markets live
4. Add continuity files from the continuity pack
5. Build adapters and normalization into plugin-side services or a parallel engine package

## Phase 1 stop boundary

Stop after:
- plugin installs cleanly
- schema migrates
- cron jobs exist
- formula runs persist projections
- public read endpoint serves publish-safe rows
- Schedule + Game Projections + limited Player Opportunity + limited Betting Core view can be rendered
