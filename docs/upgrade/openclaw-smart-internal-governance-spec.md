# OpenClaw 智慧版：架构治理与开发约束（对内版）

日期：2026-04-09  
状态：Active（执行基线）  
适用范围：`openclaw-full` 仓库内智慧版相关功能（runtime / channels / services / observability）

---

## 1. 文档定位

本文件是智慧版工程的“对内执行宪法”，用于约束：

1. 架构分层与依赖边界
2. 术语一致性与领域模型单点真相（SSOT）
3. 重构迁移节奏与回滚边界
4. 测试回归门禁与发布验收标准

若其他文档与本文件冲突，以本文件为准；如需变更本文件，必须走 ADR 流程。

---

## 2. 7 层架构与依赖约束（强制）

| 层级          | 目录                 | 职责                                         | 允许依赖           | 禁止依赖                      |
| ------------- | -------------------- | -------------------------------------------- | ------------------ | ----------------------------- |
| L1 Core       | `src/core/`          | Outcome、错误模型、基础常量与基础类型        | 无                 | L2-L7                         |
| L2 Domain     | `src/domain/`        | Subject/Intent/Scope/Parcel 等领域对象与规则 | L1                 | L3-L7                         |
| L3 Services   | `src/services/`      | 授权判定、记忆解析、投递分发、策略编排       | L1-L2              | L4-L7                         |
| L4 Runtime    | `src/runtime/`       | 网关执行管线、会话生命周期、任务编排         | L1-L3              | 直接依赖 L5 渠道实现细节      |
| L5 Channels   | `src/channels/`      | Telegram/Web 等协议适配与 I/O 转换           | L1-L3              | 业务判定逻辑（审批/授权策略） |
| L6 Surfaces   | `src/surfaces/`      | 管理界面/API/CLI 只读与运维入口              | L1-L3、L7 暴露视图 | 直接读写底层存储实现          |
| L7 Governance | `src/observability/` | Trace/Audit/Replay/Telemetry                 | L1-L3              | 反向驱动主业务决策            |

### 2.1 硬规则

1. `runtime` 不得直接 `import` 具体渠道 SDK（如 Telegram Bot 实例）。
2. `channels` 不得出现审批授权业务判断（如 `if user is admin then approve`）。
3. 所有跨层调用必须通过稳定接口，不允许“临时穿透导入”。
4. 新增模块必须声明所属层级，未声明视为不合规。

---

## 3. 统一术语（必须统一命名）

1. `AuthorizationSubject`：唯一主体身份模型（发起者身份）。
2. `ApproverIdentity`：审批行为身份（审批者身份）。
3. `TaskIntent`：动作意图（工具名、参数、风险等级）。
4. `SessionContext`：会话上下文（session/group/user/trace 关联）。
5. `DeliveryParcel`：统一投递载体（协议无关）。
6. `MemoryScopeType`：记忆作用域分层（GLOBAL/GROUP/USER/SESSION）。
7. `Outcome<T>`：统一返回模型（成功/失败+时间戳）。

### 3.1 命名收敛规则

1. `AuthSubject` 仅允许作为兼容输入别名，不允许作为新代码输出字段。
2. 新代码必须以 `AuthorizationSubject` 为主字段与主类型。
3. 对外接口返回体不得新增 `AuthSubject` 字段。

---

## 4. 六个重点面的治理约束（执行级）

## 4.1 Authorization / Approval

### 必须

1. 所有授权入口统一走 `IAuthorizer.authorize(subject, intent)`。
2. 审批链必须通过 `IApprovalBridge` 解耦，不得在授权服务中直接调用渠道 SDK。
3. 每个审批动作必须带 `approvalId + sessionId + traceId`，并记录审计事件。
4. 审批点击必须幂等（同一 `approvalId` 重复点击不得重复执行）。

### 禁止

1. 在 channel 层硬编码授权规则（如 `ADMIN_ID` 直接放行）。
2. 未经授权直接执行高风险工具。

### 验收

1. 非 approver 身份不能伪造 approver identity。
2. 策略拒绝、人工审批、自动放行三条路径均有测试覆盖。

## 4.2 Session / Context

### 必须

1. 所有入口上下文先归一化为 `SessionContext` 再进入 runtime。
2. route 合并优先级固定：`turn-source > explicit > session`。
3. `sessionId`、`authorizationSubjectKey`、`traceId` 在执行链路全程可追踪。

### 禁止

1. 以 ad-hoc 字段直接拼装跨模块上下文（绕过 domain/service）。
2. 在不同入口定义互不兼容的 session shape。

### 验收

1. 多入口同会话主线连续。
2. topic/thread 识别不丢失、不串路由。

## 4.3 Delivery / Target Routing

### 必须

1. 统一使用 `DeliveryParcel` 作为投递标准模型。
2. 业务层只能调用 dispatcher/message 层，不直接调用底层 `deliverOutboundPayloads`。
3. 投递失败需返回 `Outcome`，`urgent` 失败必须触发诊断钩子。

### 禁止

1. 在业务逻辑中直接拼接 Telegram/Web SDK 参数格式。
2. 继续新增直连渠道发送入口。

### 验收

1. 关键入口（gateway send/cron/isolated-agent）发送链路统一收口。
2. 协议适配只在 provider 中处理，不外溢。

## 4.4 Memory / Inheritance

### 必须

1. 记忆解析采用固定继承顺序：`Session > User > Group > Global`（高层覆盖低层）。
2. AI 默认写入 `SESSION` 作用域；写入高层需显式策略允许。
3. `SESSION` 作用域必须具备 TTL 或生命周期清理机制。
4. 内存存储必须可观测（条目数、清理耗时、锁等待等指标）。

### 禁止

1. 执行过程直接改全局记忆存储（绕过 orchestrator）。
2. 临时任务状态永久化。

### 验收

1. 无跨 session/group 污染。
2. cleanup 行为可审计、可查询。

## 4.5 Tool Policy / Runtime Binding

### 必须

1. 工具权限判定输入必须是明确类型对象，禁止宽泛参数包。
2. runtime 只消费 service 暴露接口，不反向依赖具体 adapter/channel。
3. 高风险工具需明确 `riskLevel` 与审批策略绑定。

### 禁止

1. 以“是否来自某入口”替代权限判断。
2. 直接在 tool 执行器里绕过授权层。

### 验收

1. 高风险工具全部在授权前置拦截。
2. 工具拒绝原因可结构化追踪。

## 4.6 Diagnostics / Observability

### 必须

1. 每个请求生成 `traceId`，并在关键节点记录 trace event。
2. 审批、记忆变更、投递必须写审计事件（失败不阻断主业务）。
3. replay 查询支持按 `traceId/sessionId` 一键回放。
4. 查询权限遵循 operator identity + scope（最小权限原则）。

### 禁止

1. observability 写入失败导致主业务失败。
2. 管理查询接口无权限隔离直接开放全量数据。

### 验收

1. 能从日志与查询还原完整执行链路。
2. operator 非 admin 时仅可见其权限范围内数据。

---

## 5. 目录治理与搬迁纪律

1. 禁止继续向 `src/shared/` 增加智慧版业务逻辑。
2. 每迁移一个模块，必须在同批次删除或降级旧路径实现。
3. 搬迁顺序：先建新契约与适配层，再迁调用方，最后删旧实现。
4. 禁止“先删旧实现再全仓修编译”式大爆炸迁移。

---

## 6. 测试与回归门禁（质量闸门）

## 6.1 单批次最小门禁

1. 触达模块对应单测/集成测试必须全绿。
2. `pnpm tsgo` 通过。
3. `pnpm build:strict-smoke` 通过。

## 6.2 回归矩阵（必须维护）

1. Auth：主体解析、审批判定、审批幂等。
2. Session：多入口上下文一致性、thread/topic 保真。
3. Delivery：目标解析、dispatcher 路由、失败回路。
4. Memory：继承解析、防污染写入、TTL 清理。
5. Observability：trace 传播、audit 落盘、replay 权限。

## 6.3 覆盖率要求

1. 新增或重构的 `src/services/*` 模块目标覆盖率不低于 80% 路径覆盖。
2. 对安全边界变更必须附带负向测试（拒绝路径）。

---

## 7. 变更流程与发布纪律

1. 涉及跨层依赖变更必须附带 ADR（放在 `docs/upgrade/`）。
2. 每个重构切片必须可独立回滚（提交粒度可审查）。
3. 合并前必须附“风险点 + 回滚策略 + 验证命令”。
4. 禁止将架构迁移与业务功能大改混在同一批次。

---

## 8. 验收标准（DoD）

满足以下全部条件方可认定“治理重构批次完成”：

1. 目录与依赖不违反 7 层约束。
2. 六个重点面的对应门禁测试全部通过。
3. 新增路径已使用统一术语（无新双轨命名）。
4. replay 可按 `traceId/sessionId` 复盘关键链路。
5. 文档、代码、测试三者一致，无“文档已迁移但代码未接入”情况。

---

## 9. 当前执行重点（2026-04-09 版本）

1. 继续收口非 cron 路径中的直接发送调用到 dispatcher/message 抽象。
2. 完成 `AuthSubject -> AuthorizationSubject` 兼容层的最终下线计划。
3. 将 memory 指标与 replay 视图进一步联动，形成统一诊断视图。
4. 推进审批审计从服务层扩展到 runtime invoke 全链路。

---

## 10. 附：推荐审查清单（PR 模板可复用）

1. 这个改动属于哪一层？是否违反依赖边界？
2. 是否引入了新的术语或重复语义字段？
3. 是否绕过了 AuthorizationService / DeliveryDispatcher / MemoryOrchestrator？
4. 是否新增了直连渠道发送路径？
5. 是否带了拒绝路径与异常路径测试？
6. 是否提供了 traceId/sessionId/approvalId 关联信息？
7. 是否可在不迁移数据结构的前提下快速回滚？
