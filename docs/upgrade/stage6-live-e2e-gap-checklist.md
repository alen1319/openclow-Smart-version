# Stage 6 Live E2E 保留缺口执行条件与最小上线检查单（一页版）

Date: 2026-04-09  
Status: 可直接照单执行（当前阶段允许不引入 Telegram live-network E2E）

## 1) 结论与范围

- 当前允许把 Telegram **live-network E2E** 作为保留缺口，不阻塞候选版上线。
- 前提是：本清单中的“最小上线检查”全部通过，且未触发“必须补 live E2E”的条件。
- 本页只覆盖与以下链路相关的风险：`入站身份 -> 审批 -> 工具执行放行/拒绝 -> HTTP 兼容入口身份一致性`。

## 2) 何时“必须补 live E2E”再放行

满足任意一条，即转为必做 live E2E：

1. 修改了 Telegram 回调/命令/审批主链实现（`bot*`, `exec-approval*`, `delivery*`）。
2. 修改了授权主体透传关键字段或解析规则（`authorizationSubjectKey`, `approverIdentityKey`, sender scopes）。
3. 修改了 `/tools/invoke` 与 `/v1/chat/completions` 的身份入口解析或共享鉴权逻辑。
4. 上线环境切换了 Bot Token、目标账号体系、网关鉴权模式或反向代理拓扑。
5. 最近 7 天内出现过审批身份错配、误放行、误拒绝、或 Telegram 回调 4xx/5xx 异常峰值。

## 3) 最小上线检查（可替代本阶段 live E2E）

按顺序执行，任一步失败即停止放行。

1. 运行态一致性
   - `openclaw --version`
   - `openclaw status --all`
   - `openclaw gateway probe`
   - `openclaw channels status --probe`

2. 安全边界
   - `openclaw security audit --deep`
   - 要求：`0 critical`、`0 warn`（允许 `info`）。

3. 构建与主门禁
   - `pnpm check`
   - `pnpm build:strict-smoke`

4. 关键回归（身份/审批/入口一致性）
   - `corepack pnpm vitest --config vitest.extension-telegram.config.ts extensions/telegram/src/bot.test.ts extensions/telegram/src/bot-native-commands.session-meta.test.ts extensions/telegram/src/exec-approvals.test.ts extensions/telegram/src/exec-approval-resolver.test.ts`
   - `corepack pnpm vitest --config vitest.gateway.config.ts src/gateway/tools-invoke-http.test.ts src/gateway/openai-http.test.ts`
   - `corepack pnpm vitest packages/memory-host-sdk/src/host/qmd-scope.test.ts`

5. 生产候选判定
   - 允许上线：以上全绿，且未命中“第 2 节必须补 live E2E”条件。
   - 暂缓上线：任一失败，或命中第 2 节任一条件。

## 4) 执行记录模板（每次发布填一次）

- Candidate 版本/提交：
- 执行人：
- 时间（本地时区）：
- `openclaw status --all`：通过 / 失败
- `openclaw security audit --deep`：通过 / 失败
- `pnpm check`：通过 / 失败
- `pnpm build:strict-smoke`：通过 / 失败
- Telegram/审批/入口关键回归：通过 / 失败
- 是否命中“必须补 live E2E”条件：是 / 否
- 最终结论：放行 / 暂缓
