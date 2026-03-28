# Data Pipeline

The full system is designed around three data states.

## 1. Raw

Untouched provider payloads stored for audit trail and debugging.

## 2. Normalized

Provider data mapped into canonical MLB structures with explicit field names and preserved nulls.

## 3. Prepared

Model-ready inputs generated only after checks pass.

## Rule

No direct jump from raw payloads to projections.

The later pipeline target is:

`fetchRawSlate -> validateRawPayload -> normalizeSlate -> runNormalizationChecks -> prepareGameInputs -> runPreparedInputChecks -> projectGames -> projectPlayers -> scorePlayers -> extractActuals -> evaluateRun`
