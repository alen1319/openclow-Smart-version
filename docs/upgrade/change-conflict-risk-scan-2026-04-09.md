# OpenClaw Smart Refactor Conflict Risk Scan

Date: 2026-04-09  
Scope: architecture-governance batch (docs + low-risk identity/routing hardening)

## 1) Scan Summary

This batch is mostly additive (`src/domain/*`, `src/services/*`, `src/observability/*`) and has low structural risk, but there are merge hotspots in gateway and approval flows where existing parallel work is active.

## 2) Hotspot Risk Map

| Area                            | Files                                                                                                                                  | Risk   | Why                                                                                                                                          |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Gateway request parsing         | `src/gateway/http-utils.ts`, `src/gateway/tools-invoke-http.ts`, `src/gateway/openresponses-http.ts`, `src/gateway/tool-resolution.ts` | High   | Same entrypoints often change with auth headers and delivery headers; signature widened (`agentThreadId: string \| number`) affects callers. |
| Approval routing                | `src/infra/exec-approval-session-target.ts`, `extensions/telegram/src/exec-approval-resolver.ts`                                       | High   | Approval identity and thread-id handling are safety critical and easy to regress with channel-specific patches.                              |
| Auto-reply identity convergence | `src/auto-reply/command-auth.ts`, `src/auto-reply/reply/inbound-context.ts`, `src/auto-reply/templating.ts`                            | Medium | Added `AuthSubject` fallback path; conflicts likely if command auth logic is edited in parallel.                                             |
| New architecture scaffolding    | `src/core/*`, `src/domain/*`, `src/services/*`, `src/runtime/gateway/InvokePipeline.ts`, `src/observability/*`, `src/surfaces/*`       | Low    | Mostly new files; merge risk mainly from naming drift (`AuthSubject` vs `AuthorizationSubject`).                                             |
| Governance docs                 | `docs/upgrade/architecture-governance-plan.md`, `docs/upgrade/architecture-refactor-roadmap.md`, `docs/upgrade/stage6-candidate.md`    | Low    | Textual collisions only; operational risk is low.                                                                                            |

## 3) Specific Conflict Vectors

1. `AuthorizationSubject` and `AuthSubject` currently coexist; if subsequent PRs standardize only one model, adapters may import the wrong type.
2. `resolveHttpToolDeliveryContext()` centralizes header parsing; any older code reading `x-openclaw-*` headers directly can diverge again.
3. Approval identity hardening now ignores mismatched explicit approver keys in Telegram path; policy updates that expect delegated approver labels must update tests first.
4. Thread id normalization now preserves non-integer ids in approval session targets; downstream code that assumes numeric thread ids may break silently.

## 4) Merge/Release Order Recommendation

1. Merge docs and new domain/service scaffolding first (no runtime behavior switch).
2. Merge identity seam move (`shared` -> `domain/auth/authorization-identity.ts`) with tests.
3. Merge gateway delivery parsing convergence (`resolveHttpToolDeliveryContext`) with gateway tests.
4. Merge approval-target and Telegram approval hardening with extension/infra tests.
5. Enable incremental runtime adoption of `DeliveryDispatcher` and `AuthorizationService`.

## 5) Guardrails For Next Batches

1. Enforce “single parser” rule: all `x-openclaw-message-*` parsing must call `resolveHttpToolDeliveryContext`.
2. Add a lint/import boundary rule to prevent new imports from `src/shared/authorization-*`.
3. Before merging any gateway/auth patch, run:
   - `corepack pnpm vitest src/gateway/http-utils.request-context.test.ts src/gateway/tools-invoke-http.test.ts src/gateway/openresponses-http.test.ts`
   - `corepack pnpm vitest src/infra/exec-approval-session-target.test.ts extensions/telegram/src/exec-approval-resolver.test.ts`
4. Keep approval behavior idempotent by `approvalId`; do not bypass `AuthorizationService`.

## 6) Verification Snapshot

Passed during this scan:

1. `corepack pnpm vitest src/domain/identity/identity-resolver.test.ts src/domain/auth/authorization-identity.test.ts src/services/authorization/AuthorizationService.test.ts src/services/delivery/DeliveryDispatcher.test.ts src/channels/telegram/TelegramProvider.test.ts src/services/memory/MemoryResolver.test.ts src/services/memory/MemoryOrchestrator.test.ts src/observability/tracing/TraceProvider.test.ts src/observability/audit/AuditService.test.ts src/runtime/gateway/InvokePipeline.test.ts src/gateway/http-utils.request-context.test.ts`
2. `corepack pnpm vitest src/gateway/openresponses-http.test.ts src/gateway/tools-invoke-http.test.ts src/infra/exec-approval-session-target.test.ts extensions/telegram/src/exec-approval-resolver.test.ts`

Known limitation:

- `corepack pnpm tsc --noEmit --pretty false` aborted with Node heap OOM in this environment.

## 7) Addendum — This Round Delta (2026-04-09)

### 7.1 Newly touched files

1. `src/gateway/server.impl.ts`
2. `src/gateway/server-node-events.runtime.ts`
3. `src/infra/exec-approval-forwarder.runtime.ts`
4. `src/auto-reply/reply/inbound-context.ts`
5. `src/auto-reply/reply/inbound-context.test.ts`
6. `docs/upgrade/architecture-governance-plan.md`
7. `docs/upgrade/architecture-refactor-roadmap.md`

### 7.2 Conflict risk assessment

1. Gateway recovery wiring (`server.impl.ts`) — **Medium**  
   Startup recovery now depends on `sendReplyPayloads`; parallel edits in recovery retry logic may conflict on the `deliver` adapter signature.
2. Runtime barrel exports cleanup — **Low**  
   Removing `deliverOutboundPayloads` from runtime barrels is low risk internally, but any external/import-by-path consumer will fail fast (desired).
3. Inbound identity convergence (`inbound-context.ts`) — **Medium**  
   `AuthSubject` now syncs into `AuthorizationSubject`; parallel patches that treat these as independent fields can reintroduce drift.

### 7.3 Additional guardrails for follow-up PRs

1. Do not re-export `deliverOutboundPayloads` from runtime adapter barrels; use `sendReplyPayloads` as default integration seam.
2. Treat `AuthSubject` as read-only compatibility input only; write-path must target `AuthorizationSubject`.
3. When touching delivery recovery code, run queue recovery tests plus at least one gateway smoke test before merge.
