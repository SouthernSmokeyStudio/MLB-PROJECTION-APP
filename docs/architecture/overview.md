# Architecture Overview

This repository is intentionally locked to the first two build phases.

## Core rule

`lib/` is the product. `app/` is the shell.

## Active scope

- contracts
- checks
- fixtures
- tests
- minimal compile-safe Next.js shell

## Inactive scope

The following layers are explicitly out of scope until Phase 1–2 is accepted:

- adapters
- normalization
- preparation pipeline implementation
- projection math
- scoring engine implementation
- actuals extraction engine
- backtesting engine
- API service logic
- expanded UI

## Design law

The system must fail closed, remain deterministic, preserve nulls where truth is unknown, and avoid fabricated defaults.
