# OpenClaw Architecture Refactor Roadmap

Date: 2026-04-09  
Objective: architecture governance and systemized refactor without breaking core delivery paths

## 1. Execution principles

1. No big-bang rewrite.
2. Keep compatibility shims while migrating call sites.
3. Land tests with each refactor batch.
4. Prioritize security and route correctness before structural cosmetics.
5. Every phase must have explicit rollback boundaries.

## 2. Audit-based backlog (ranked)

### P0 (immediate)

1. Approval/session target integrity:
   - preserve non-integer thread identifiers (Slack/Discord-style thread ids).
   - prevent approval identity drift in channel approval callbacks.
2. Shared route snapshot normalization:
   - align approval routing and outbound routing thread-id handling.

### P1

1. Delivery target convergence:
   - unify `parseExplicitTarget` usage across outbound/session/approval paths.
   - centralize comparable-target match semantics and source attribution.
2. Session context convergence:
   - define canonical route snapshot contract and eliminate duplicated ad hoc normalization.

### P2

1. Tool policy/runtime binding decomposition:
   - replace broad argument bags with explicit policy context objects.
2. Memory inheritance governance:
   - unify parent/root inheritance rules with deterministic fork semantics.

### P3

1. Diagnostics and observability convergence:
   - structured routing/approval logs with correlation ids and mismatch reason codes.

## 3. Phased migration plan

## Phase 0: Baseline and first safety refactors (current)

Deliverables:

1. Governance docs:
   - `docs/upgrade/architecture-governance-plan.md`
   - `docs/upgrade/architecture-refactor-roadmap.md`
2. First batch code changes:
   - `src/infra/exec-approval-session-target.ts`
   - `extensions/telegram/src/exec-approval-resolver.ts`
3. First batch tests:
   - `src/infra/exec-approval-session-target.test.ts`
   - `extensions/telegram/src/exec-approval-resolver.test.ts`

Acceptance criteria:

1. Approval routing preserves thread-id fidelity for non-integer thread values.
2. Telegram approval callback identity remains sender-scoped even with mismatched explicit overrides.
3. Targeted test suites pass.

Risk and rollback:

1. Risk: adapter expectations around numeric thread ids.
2. Mitigation: keep integer-like thread ids normalized as numbers; preserve non-integer values as strings.
3. Rollback: revert Phase 0 files only; no schema migration required.

## Phase 1: Authorization + session context domain stabilization

Tasks:

1. Introduce domain contracts for:
   - authorization identity
   - session route snapshot
2. Replace duplicated adapter-level identity assembly with domain service calls.
3. Centralize session context merge precedence (`turn-source > explicit > session` with documented rules).

Acceptance criteria:

1. No adapter-specific authorization drift.
2. Session route resolution is deterministic and test-matrix covered.

## Phase 2: Delivery target and routing convergence

Tasks:

1. Build a single delivery-target normalization API for outbound + approval paths.
2. Move comparable-target semantics into a shared contract module.
3. Tag route resolution source (`turn-source`, `session`, `fallback`, `explicit`) in structured logs.

Acceptance criteria:

1. Route parity between approval forwarding and outbound message actions.
2. No duplicated target parsing logic in core routing paths.

## Phase 3: Memory inheritance and runtime binding decomposition

Tasks:

1. Normalize parent/root session inheritance decisions into domain logic.
2. Decompose runtime binding into typed context objects for gateway/auto-reply/channel adapters.
3. Add guard tests for cross-channel concurrency and stale context races.

Acceptance criteria:

1. Memory inheritance behavior matches documented policy under stress scenarios.
2. Runtime binding signatures shrink and become domain-first.

## Phase 4: Observability convergence and cleanup

Tasks:

1. Add structured diagnostics envelope for routing/approval decisions.
2. Standardize correlation keys across gateway, auto-reply, and channel adapters.
3. Remove temporary compatibility wrappers after migration completion.

Acceptance criteria:

1. Approval and delivery incidents are traceable end-to-end from logs only.
2. Legacy wrappers are removed with no contract regressions.

## 4. Test and regression strategy by phase

1. Contract tests:
   - authorization identity
   - session route snapshot
   - delivery target parser behavior
2. Integration tests:
   - gateway approval request and resolution paths
   - auto-reply + outbound route alignment
3. Adapter tests:
   - Telegram, Slack, Discord, Matrix approval-native and target parsing behavior
4. Minimal mandatory gate per batch:
   - touched contract tests
   - touched adapter tests
   - type checks for changed signatures

## 5. Delivery slices for reviewability

1. Slice A: identity and approval hardening (no directory moves).
2. Slice B: session route contract extraction (re-exports only).
3. Slice C: target parsing convergence (core + adapter call site updates).
4. Slice D: runtime binding object model.
5. Slice E: observability envelope and cleanup.

Each slice should stay small enough for focused review and independent rollback.

## 6. Current phase status

### Phase 0

Completed:

1. Governance docs landed.
2. First safety refactors landed (thread-id fidelity + Telegram approval identity hardening).
3. Shared identity seam migrated to domain and old `shared` implementation deleted.

### Phase 1 (partially started)

Completed:

1. Core outcome model (`src/core/outcome.ts`).
2. Domain auth/session/memory/delivery contracts.
3. Authorization service interface and implementation with approval idempotency.

Remaining:

1. Replace remaining legacy identity/session helper usage with domain services.
2. Consolidate dual naming (`AuthSubject` vs `AuthorizationSubject`).

### Phase 2 (partially started)

Completed:

1. Delivery parcel model and dispatcher/provider abstraction.
2. Dispatcher normalization + urgent-failure diagnostics hook.

Remaining:

1. Migrate direct channel send call sites to dispatcher in reviewable slices.
2. Add parity tests for approval forwarding via dispatcher.

### Phase 3 (partially started)

Completed:

1. Memory scope model and resolver/orchestrator with anti-pollution write policy.
2. SESSION TTL metadata and cleanup hooks in orchestrator.

Remaining:

1. Wire resolver/orchestrator into active runtime session manager path.
2. Deprecate mixed memory logic currently outside service boundary.

### Phase 4 (partially started)

Completed:

1. Trace provider + audit service scaffolding.
2. Runtime invoke pipeline trace propagation.
3. Surface API for trace diagnostics lookup by `traceId`.

Remaining:

1. End-to-end trace correlation across legacy runtime entrypoints.
2. Structured sink integration for audit/trace persistence.
