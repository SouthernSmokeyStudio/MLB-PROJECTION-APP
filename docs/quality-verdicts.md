# SSS Top 1% Quality Verdicts

Session: Phase 1–7 completion (park factors, parent truth, honesty labels, regression tests)

---

## Game Projections — PASSING

**Status: Structurally sound. Not fully calibrated.**

What is now true:
- 30-park venue table with real run factors (Coors 1.17, SF/MIA 0.93, Fenway 1.04, etc.)
- Unknown venue falls back to 1.0 via `mapVenue` — not guessed, not blocked
- `team_woba` computed from component stats (BB, HBP, 1B, 2B, 3B, HR) with 2024 linear weights; falls back to OBP when component stats are absent
- `team_k_rate` and `team_bb_rate` computed from plateAppearances when available (not always null)
- `lineup_avg_woba` computed from ≥5 confirmed-order batters; blended into offense factor when present
- Home field advantage: +2.5% for home team, symmetric (total not inflated)
- Park factor capped at [0.85, 1.20] inside `projectTeamRuns` to prevent extreme outliers from dominating

What remains unverified:
- Model coefficients not calibrated against historical game totals
- No backtesting run yet — accuracy vs. Vegas totals is unknown
- Coors clamp (1.20) vs real 1.17 factor — clamp is above the real factor, does not constrain it

**Verdict**: Inputs are real and grounded. Model is a credible first-pass multiplicative approach. Calling it "calibrated" or "validated" would be false. Calling it "structurally sound" is earned.

---

## Player Projections — STRUCTURALLY SOUND

**Status: Consuming parent truth. Blending is real, not cosmetic.**

What is now true:
- `blendRecentForm`: 70% matchup wOBA + 30% recent wOBA when ≥5 recent games; clamped ±25% vs matchup wOBA
- Insufficient recent sample (< 5 games) falls back to season/matchup baseline — not used
- Null `recent_woba` ignored cleanly — no silent zeros
- Parent game projection pre-computed once per slate; all boards read from the same map (no recomputation drift)

What remains unverified:
- No calibration of the 70/30 blend weights or the ±25% clamp against historical batter performance data
- `vs_rhp_woba` / `vs_lhp_woba` only used when `season_woba` is also null — limits split usage for most batters

**Verdict**: Better than before. Inputs are being used. Weights are educated guesses, not proven coefficients.

---

## Betting Edge — TRANSITIONAL, LABELED

**Status: Directional only. Model-implied edge with no historical calibration.**

What is now true:
- Board note is explicit: "Betting edge is model-implied only. No calibration against historical results. Use as directional input — not a validated edge signal."
- Parent game projection pre-computed once; both `buildGameCard` calls in moneyline join use the same assembled projection

What remains unverified:
- Edge calculation: `model_probability - implied_probability`. Neither input has been validated against closing lines or historical outcomes.
- No backtesting of edge predictions vs. actual moneyline results

**Verdict**: Honest about what it is. Cannot be more until backtesting is complete.

---

## DFS Edge — TRANSITIONAL, LABELED

**Status: Salary join works. Ownership is a heuristic, not a model.**

What is now true:
- Board note is explicit: "projected_ownership values are rule-based heuristics (salary rank + position). Not a calibrated model. ownership_source: `placeholder` on every row."
- `ownership_source: "placeholder"` set on every row — contract is not hiding it
- Parent game projection consumed from pre-computed map

What remains unverified:
- Ownership heuristics not validated against DraftKings actual ownership results
- No calibrated model exists yet for ownership prediction

**Verdict**: Honest. Salary join is real. Ownership values exist only for form, not for decision use.

---

## Smoke Signal — LABELED

**Status: Snapshot synthesis. Not trend intelligence.**

What is now true:
- Board note is explicit: "Smoke Signal is a current-snapshot synthesis of model outputs. It reflects no trend, line movement, or real-time intelligence. Values are deterministic from the latest projection run."
- Pulls from player board, schedule board, DFS edge, betting edge, live scoreboard
- When signals are missing, note includes the missing signal keys

What remains unverified:
- "Top" selections are first-pass sorts (highest total, highest projected points, best value ratio). Not weighted by confidence.

**Verdict**: Structurally useful. Honest about its limitations. Not calling it more than it is.

---

## Parent Truth Boundary — ENFORCED

**Status: Single source of truth per snapshot.**

What is now true:
- `buildSlateSnapshot` pre-computes one `AssembledGameProjection` per game
- All boards (schedule, player, DFS edge, betting edge) consume from the same `ReadonlyMap<string, AssembledGameProjection>`
- No board recomputes the game projection independently
- Type system enforces the contract: `preassembled` is optional; fallback is `assembleGameProjection(...)` at each call site if no map provided

What was wrong before:
- `joinDraftKingsSportsbookMoneylines` called `buildGameCard` twice per game, each doing an independent `assembleGameProjection` — game card could differ from betting edge card
- DFS edge board computed game projections in `buildDraftKingsClassicPlayerCards` independently from the schedule board

**Verdict**: Enforced. The drift path is closed.

---

## Test Coverage

- 720 tests passing (61 test files)
- 11 new regression tests covering: park factors (Coors, Fenway, pitcher-friendly, null-blocks), home field advantage, lineup_avg_woba effect, blendRecentForm (hot/cold in same game, insufficient sample, clamp behavior)
- All existing 709 tests continue to pass after all changes

---

## Remaining Honest Gaps (Not Hidden, Not Renamed Done)

1. **No backtesting run** — cannot validate model accuracy against real outcomes until 2026 season games are in
2. **wOBA weights are 2024 standard** — not derived from this dataset; may drift slightly year to year
3. **Coors Factor (1.17)** — based on multi-year Baseball Reference park factor averages; will shift with roster changes
4. **Sacramento/Athletics (venue ID 2529, Sutter Health Park)** — limited MLB data; factor is 0.97 conservative estimate
5. **`vs_rhp_woba` / `vs_lhp_woba` underutilized** — only used when `season_woba` is null; most batters have season stats so splits are bypassed
6. **Ownership model** — placeholder heuristic only; no calibrated model exists
7. **Weather model** — temperature and wind factors are first-pass estimates; not validated

None of these are hidden. All are either labeled in board payloads or documented here.
