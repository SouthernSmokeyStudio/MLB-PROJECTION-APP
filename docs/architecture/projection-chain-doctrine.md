# Projection Chain Doctrine

## Locked doctrine

The app projection chain is:

`Game Stats Projection -> Player Projections -> DFS/Betting -> Smoke Signal`

This chain is governing architecture doctrine.

Rules:

1. Upstream truth wins.
2. Downstream layers are not allowed to invent a second reality.
3. A downstream layer may derive, rank, filter, score, or package upstream outputs.
4. A downstream layer may not contradict upstream game, team, player, blocked, or version truth.
5. If upstream is blocked, downstream must either remain blocked or explicitly degrade without contradicting blocked state.
6. If reconciliation cannot be proven, the downstream output is invalid.

## Current repo truth

### What is already chained correctly

1. Both live routes now share the same slate source:
   - `app/api/games/route.ts`
   - `app/api/players/route.ts`
   - both load from `lib/services/loadLiveSlate.ts`
2. The shared slate source is grounded in one live preparation path:
   - MLB schedule fetch
   - canonical game normalization
   - boxscore enrichment
   - prepared game inputs
3. Game outputs are upstream of player outputs in model logic:
   - `lib/projections/assembleGameProjection.ts` builds `game_projection`, pitcher projections, and batter projections from the same `PreparedGameInputs`
   - `lib/services/buildGameCard.ts` reads the assembled game projection
   - `lib/services/buildPlayerCard.ts` reads the same assembled game projection and then derives fantasy output from it
4. Player fantasy scoring already respects upstream blocked state:
   - `lib/scoring/projectFantasyPoints.ts` exits blocked if `assembled.game_projection.metadata.blocked.is_blocked` is true
5. Product routes already expose separate product contracts:
   - `schedule-board-v1`
   - `player-board-v1`

### What is still structurally loose

1. The game layer and player layer are chained implicitly, not explicitly.
   - `buildGameCard` and `buildPlayerCards` both call `assembleGameProjection` independently.
   - They derive from the same preparation input shape, but they do not share a single explicit run artifact.
2. Upstream projection lineage is not exposed on product-facing outputs.
   - `run_id`
   - `projected_at`
   - projection version fields
   - upstream blocked ancestry
   are present in `ProjectionMetadata`, but not carried into `GameCard`, `PlayerCard`, `schedule-board-v1`, or `player-board-v1`.
3. There is no reconciliation contract between game and player surfaces.
   - No explicit check proves a player row belongs to the same projection run as its game row.
   - No explicit check proves a downstream consumer is using a consistent game/player snapshot.
4. There is no enforceable downstream handshake yet for DFS/Betting or Smoke Signal.
   - The repo has upstream game and player outputs.
   - It does not yet have a contract that later layers must accept and reconcile against before emitting downstream surfaces.
5. Test coverage is still stronger at the service/board level than at the route-chain discipline level.
   - There are service tests for `buildGameCard`, `buildPlayerCards`, `buildScheduleBoard`, and `buildPlayerBoard`.
   - There is a route test for `/api/players`.
   - There is not yet a dedicated game/player reconciliation test layer.

## Smallest enforceable reconciliation contract

The smallest enforceable discipline layer is not a new modeling system.
It is one shared lineage contract plus one shared reconciliation check package.

### Required lineage contract

Every game-level output and every player-level output must carry a shared upstream lineage block sourced from `ProjectionMetadata`.

Minimal shape:

```ts
interface ProjectionLineage {
  readonly game_id: GameId;
  readonly prepared_at: ISOTimestamp;
  readonly run_id: RunId;
  readonly projected_at: ISOTimestamp;
  readonly model_version: string;
  readonly feature_set_version: string;
  readonly data_version: string;
  readonly blocked: BlockedState;
}
```

Source of truth:

- `lib/projections/assembleGameProjection.ts`
- specifically `game_projection.metadata`

Doctrine:

- This lineage block is the reconciliation identity.
- Downstream outputs must not replace it.
- Downstream outputs may only append their own derived metadata alongside it.

### Required reconciliation check package

The first enforceable check layer should be a pure function over one game output and its player outputs.

Minimal shape:

```ts
interface ProjectionReconciliationResult {
  readonly game_id: GameId;
  readonly passed: boolean;
  readonly checks: {
    readonly lineage_matches: boolean;
    readonly blocked_state_matches: boolean;
    readonly player_game_ids_match: boolean;
    readonly player_team_ids_match: boolean;
    readonly player_count_shape_valid: boolean;
  };
  readonly failures: readonly string[];
}
```

This should live as a small contract/check service, not inside UI code.

## Minimum reconciliation requirements

### Between game layer and player layer

The minimum required checks are:

1. `game_id` must match for the game row and every player row.
2. `run_id` must match between the game lineage and every player lineage row for that game.
3. `projected_at` and version fields must match between the game lineage and every player lineage row for that game.
4. Game blocked state must propagate:
   - if the game layer is blocked, the player layer for that game cannot present itself as fully live or ready
   - player rows may be present for identity/context, but their projection state must reconcile to blocked truth
5. Player team membership must reconcile to the game:
   - every player `team_id` must equal either the away or home team id from the game layer
   - no third-team player may appear inside a game's player output
6. Player role shape must reconcile:
   - unblocked games should not emit more than one away pitcher and one home pitcher
   - batter rows must resolve to away/home team membership and valid `game_id`
7. Product context must reconcile:
   - `scheduled_start`
   - `status`
   - matchup team labels
   must come from the same canonical game truth, not from downstream overrides

### Between player layer and later downstream layers

DFS/Betting and Smoke Signal must reconcile against the player layer at minimum through:

1. Shared upstream lineage:
   - downstream artifact must reference the exact upstream `ProjectionLineage`
2. Referenced player membership:
   - every downstream player reference must exist in reconciled player outputs for the same `game_id` and `run_id`
3. Referenced game membership:
   - every downstream game reference must exist in reconciled game outputs for the same `game_id` and `run_id`
4. Block propagation:
   - blocked player or game truth must remain visible downstream
   - downstream ranking logic may suppress blocked items, but may not silently relabel them as valid
5. No counterfactual metrics:
   - downstream derived fields may transform upstream values
   - downstream may not invent contradictory implied totals, sides, or readiness states
6. Smoke Signal gating:
   - Smoke Signal may only publish from already reconciled upstream game/player outputs
   - if reconciliation fails, signal generation is invalid for that item

## Exact next implementation step

Implement one shared lineage and reconciliation layer in code before any DFS/Betting or Smoke Signal work.

The next step should be:

1. Extend `GameCard` and `PlayerCard` with a shared `projection_lineage` block sourced directly from `assembleGameProjection(...).game_projection.metadata`.
2. Add a small pure check service, for example:
   - `lib/contracts/projection-lineage.ts`
   - `lib/services/checkProjectionReconciliation.ts`
3. Add targeted tests that prove:
   - game and player outputs from the same prepared game share the same lineage
   - blocked state propagates from game projection to player projection
   - invalid player membership fails reconciliation
4. Only after those checks exist should DFS/Betting outputs be allowed to declare themselves live.

That is the smallest structurally correct next step because it turns the current implicit chain into an explicit, testable contract without widening into new product surfaces.
