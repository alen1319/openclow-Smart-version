# OpenClaw Stage 6 Candidate Snapshot

Date: 2026-04-08
Status: Candidate (ready for stage-level freeze snapshot)

## Scope

- Shared authorization identity seam stabilized for `authorizationSubjectKey` and `approverIdentityKey`.
- Command auth, gateway HTTP invoke, and OpenAI-compatible chat now use the same identity resolution behavior.
- Non-approver callers no longer propagate `approverIdentityKey` even when explicitly provided.
- Privileged tool boundaries (`sessions_spawn`, `gateway`, `nodes`, `cron`) are locked with focused level-difference regression coverage.

## Files finalized in this freeze candidate

- `src/shared/authorization-identity.ts`
- `src/auto-reply/command-auth.ts`
- `src/gateway/http-utils.ts`
- `src/shared/authorization-identity.test.ts`
- `src/auto-reply/command-auth.owner-default.test.ts`
- `src/gateway/tools-invoke-http.test.ts`
- `src/agents/tool-policy.test.ts`

## Verification set (all green)

- `corepack pnpm vitest src/shared/authorization-identity.test.ts src/auto-reply/command-auth.owner-default.test.ts`
- `corepack pnpm vitest --config vitest.gateway.config.ts src/gateway/tools-invoke-http.test.ts src/gateway/tools-invoke-http.cron-regression.test.ts`
- `corepack pnpm vitest src/agents/tool-policy.test.ts`
- `corepack pnpm vitest src/agents/tool-policy.test.ts src/agents/pi-tools.whatsapp-login-gating.test.ts src/agents/openclaw-tools.plugin-context.test.ts`
- `corepack pnpm vitest --config vitest.extension-telegram.config.ts extensions/telegram/src/bot.test.ts extensions/telegram/src/bot-native-commands.session-meta.test.ts extensions/telegram/src/exec-approvals.test.ts extensions/telegram/src/exec-approval-resolver.test.ts`
- `corepack pnpm vitest --config vitest.extension-memory.config.ts extensions/memory-core/src/tools.test.ts`
- `corepack pnpm vitest packages/memory-host-sdk/src/host/qmd-scope.test.ts`
- `corepack pnpm tsgo`
- `corepack pnpm build`

## Known remaining gaps (explicitly accepted for this candidate)

- No live-network Telegram E2E in this freeze set; coverage is integration-heavy and deterministic.
