# OpenClaw Architecture Governance Plan

Date: 2026-04-09  
Scope: Stage 6 candidate baseline and post-upgrade stabilization

## 1. Current-State Audit

### 1.1 Problem taxonomy (by impact)

1. Authorization and approval identity seams are partially unified but still duplicated in channel-specific flows.
2. Session context is represented in overlapping shapes (`origin`, `deliveryContext`, `last*` fields), which increases drift risk.
3. Delivery target parsing and normalization are spread across core outbound routing, channel plugins, and approval routing helpers.
4. Memory and inheritance keys (`parentSessionKey`, `memoryRootSessionKey`) are widely consumed but not governed by one domain surface.
5. Tool policy and runtime binding are strongly coupled through broad argument bags instead of stable domain request objects.
6. Diagnostics and observability are subsystem-rich but correlation-poor for approval/session/target incident triage.

### 1.2 Evidence map (high-signal modules)

- Authorization and approval:
  - `src/domain/auth/authorization-identity.ts`
  - `src/auto-reply/command-auth.ts`
  - `src/gateway/http-utils.ts`
  - `extensions/telegram/src/exec-approval-resolver.ts`
- Session and context:
  - `src/config/sessions/types.ts`
  - `src/config/sessions/metadata.ts`
  - `src/utils/delivery-context.ts`
  - `src/auto-reply/reply/session.ts`
- Delivery and target routing:
  - `src/channels/plugins/target-parsing.ts`
  - `src/infra/outbound/targets-session.ts`
  - `src/infra/outbound/target-resolver.ts`
  - `src/infra/exec-approval-session-target.ts`
- Tool policy and runtime binding:
  - `src/agents/tool-policy.ts`
  - `src/gateway/tool-resolution.ts`
- Observability:
  - `src/logging/subsystem.ts`
  - `src/infra/exec-approval-forwarder.ts`
  - `src/infra/outbound/*`

### 1.3 Priority matrix

- P0: Authorization/approval correctness, session-target integrity, approval routing safety.
- P1: Delivery target normalization convergence and route determinism.
- P1: Session context canonicalization and inheritance boundary clarity.
- P2: Tool policy/runtime binding decomposition.
- P2: Diagnostics correlation and incident-level observability.

## 2. Target Architecture (Layered Governance Model)

## 2.1 Layer model

1. Domain Contracts  
   Immutable value objects and invariants for identity, session context, delivery target, and tool authorization context.
2. Application Services  
   Orchestration logic for approvals, routing decisions, session inheritance, and policy evaluation.
3. Interface Adapters  
   Gateway, CLI, auto-reply, and channel plugins. Adapters map external input to domain contracts.
4. Infrastructure  
   Persistence, transport, logging sinks, and plugin runtime wiring.

## 2.2 Ubiquitous language (canonical terms)

- Authorization Subject: stable sender-scoped identity key used for authorization checks.
- Approver Identity: audit identity for approval decisions; must never be broader than sender authorization semantics.
- Session Root: stable conversation-root key for memory inheritance.
- Session Route Snapshot: normalized `{channel,to,accountId,threadId}` route state.
- Delivery Target: canonical destination for outbound and approval delivery.
- Thread Binding: thread/topic identity attached to a delivery route.
- Tool Authorization Context: resolved sender authorization state (`guest`/`allowed`/`approver`/`owner`).
- Runtime Binding: adapter-scoped mapping from domain context to runtime/plugin APIs.
- Diagnostic Event: structured incident log record with shared correlation keys.

## 2.3 Architecture guardrails

1. Domain logic does not depend on transport-specific shapes.
2. Channel adapters can enrich routing, but canonical target normalization remains core-owned.
3. Approval identity cannot drift from sender-derived authorization identity unless an explicit policy contract allows it.
4. Session inheritance semantics must be deterministic and test-backed for cross-channel concurrency.
5. New routing and policy features require contract tests before adapter-specific tests.

## 3. Directory Reorganization Proposal (Incremental, Non-Big-Bang)

## 3.1 Proposed target structure

- `src/domain/authorization/*`
- `src/domain/session-context/*`
- `src/domain/delivery-target/*`
- `src/domain/tool-policy/*`
- `src/application/approvals/*`
- `src/application/routing/*`
- `src/application/runtime-binding/*`
- `src/adapters/gateway/*`
- `src/adapters/auto-reply/*`
- `src/adapters/channels/*`

## 3.2 Migration strategy for directories

1. Keep existing entrypoints stable.
2. Introduce domain/application modules first, then re-export from legacy paths.
3. Move call sites by feature slices, not by filesystem-only churn.
4. Remove legacy wrappers only after contract tests are green and usage is eliminated.

## 4. Governance Controls

## 4.1 Change governance

1. Require ADR-style design notes for cross-domain refactors in `docs/upgrade/`.
2. Add boundary tests to prevent cross-layer deep imports.
3. Enforce naming and term consistency in new domain contracts.
4. Introduce per-domain ownership map in CODEOWNERS after initial refactor waves.

## 4.2 Verification governance

1. Contract tests for identity, session routing, and target normalization are mandatory for boundary changes.
2. Adapter tests verify channel-specific parsing and delivery behavior.
3. Approval and delivery regressions must include explicit stale-context race scenarios.
4. Keep a targeted smoke set for approval + outbound routing before broad suite execution.

## 5. Phased Migration Overview

Detailed sequence lives in `docs/upgrade/architecture-refactor-roadmap.md`.

- Phase 0: Baseline and first safety refactors.
- Phase 1: Authorization + session context domain stabilization.
- Phase 2: Delivery target and routing convergence.
- Phase 3: Memory inheritance and runtime binding decomposition.
- Phase 4: Observability convergence and cleanup.

## 6. Test and Regression Strategy

1. Contract-first tests for:
   - authorization subject and approver identity rules
   - session route snapshots and thread-id fidelity
   - comparable target matching semantics
2. Integration tests for:
   - approval request routing (exec + plugin approvals)
   - gateway + auto-reply shared identity behavior
3. Adapter regression tests for:
   - Telegram/Slack/Discord target parsing and approval callbacks
4. Safety gates:
   - targeted Vitest suites per touched domain
   - `pnpm tsgo` for type contract drift
   - `pnpm build` when moving boundaries or runtime imports

## 7. Stability and Observability Governance

## 7.1 Stability practices

1. Prefer additive seams and compatibility wrappers over in-place rewrites.
2. Keep route and identity normalization deterministic and idempotent.
3. Keep rollback points per phase (feature-flag or compatibility-path fallback).

## 7.2 Observability practices

1. Add shared correlation keys: `approvalId`, `sessionKey`, `authorizationSubjectKey`, route hash.
2. Emit structured route resolution outcomes (turn-source, session, fallback source).
3. Record mismatch suppression reasons explicitly (for example turn-source vs session conflict).
4. Build an approval-routing incident checklist tied to deterministic logs.

## 8. Immediate next actions

1. Finish Phase 0 refactors (thread-id fidelity + Telegram approval identity lock).
2. Add domain wrappers for session route normalization and approval identity resolution.
3. Land boundary and contract tests before directory movement.

## 9. Execution Status (2026-04-09)

### 9.1 Completed in this batch

1. Governance docs created and kept in `docs/upgrade/`.
2. Identity seam moved from `shared` to domain:
   - Added `src/domain/auth/authorization-identity.ts`
   - Deleted `src/shared/authorization-identity.ts` and `src/shared/authorization-identity.test.ts`
   - Updated call sites:
     - `src/auto-reply/command-auth.ts`
     - `src/gateway/http-utils.ts`
3. Core/Domain/Services/Runtime/Channels/Surfaces/Observability scaffolding landed:
   - `src/core/outcome.ts`
   - `src/domain/auth|delivery|memory|session/*`
   - `src/services/authorization|delivery|memory/*`
   - `src/runtime/gateway/InvokePipeline.ts`
   - `src/channels/telegram/TelegramProvider.ts`
   - `src/surfaces/common/SystemState.ts`
   - `src/surfaces/admin/api.ts`
   - `src/observability/tracing/TraceProvider.ts`
   - `src/observability/audit/AuditService.ts`
4. Low-risk trace propagation wired through first critical path:
   - Gateway invoke pipeline -> Authorization service -> Delivery dispatcher.
5. Additional low-risk convergence landed:
   - Gateway startup delivery recovery now routes through `sendReplyPayloads` (message-layer entrypoint) instead of directly binding `deliverOutboundPayloads`.
   - Legacy inbound `AuthSubject` is now synchronized into canonical `AuthorizationSubject` during context finalization, with key backfill.
   - Legacy runtime exports that encouraged direct `deliverOutboundPayloads` entry usage were removed from:
     - `src/gateway/server-node-events.runtime.ts`
     - `src/infra/exec-approval-forwarder.runtime.ts`

### 9.2 Verification snapshot

Targeted suites pass (103 tests across 15 files), including:

1. authorization identity and gateway HTTP auth propagation
2. inbound auth subject convergence and command auth behavior
3. authorization service, delivery dispatcher/provider, memory resolver/orchestrator
4. trace provider, audit service, runtime invoke pipeline

### 9.3 Known follow-up items

1. Continue “move then delete” for remaining `shared/*` identity/session-adjacent helpers.
2. Replace direct channel send calls with `DeliveryDispatcher` in phased slices (approval flows first).
3. Unify `AuthSubject` and `AuthorizationSubject` terminology into a single domain contract.
4. Continue converging non-Telegram direct delivery fallbacks toward dispatcher-compatible providers.
