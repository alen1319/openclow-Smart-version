import { html, nothing } from "lit";
import { t, i18n, SUPPORTED_LOCALES, type Locale, isSupportedLocale } from "../../i18n/index.ts";
import type { EventLogEntry } from "../app-events.ts";
import { buildExternalLinkRel, EXTERNAL_LINK_TARGET } from "../external-link.ts";
import { formatRelativeTimestamp, formatDurationHuman } from "../format.ts";
import type { GatewayHelloOk } from "../gateway.ts";
import { icons } from "../icons.ts";
import type { UiSettings } from "../storage.ts";
import type {
  AttentionItem,
  ChannelsStatusSnapshot,
  CronJob,
  CronStatus,
  HealthSummary,
  RuntimeMeta,
  SessionsListResult,
  SessionsUsageResult,
  SkillStatusReport,
  StatusSummary,
} from "../types.ts";
import { renderConnectCommand } from "./connect-command.ts";
import { renderOverviewAttention } from "./overview-attention.ts";
import { renderOverviewCards } from "./overview-cards.ts";
import { renderOverviewEventLog } from "./overview-event-log.ts";
import {
  resolveAuthHintKind,
  shouldShowInsecureContextHint,
  shouldShowPairingHint,
} from "./overview-hints.ts";
import { renderOverviewLogTail } from "./overview-log-tail.ts";

export type OverviewProps = {
  connected: boolean;
  hello: GatewayHelloOk | null;
  settings: UiSettings;
  password: string;
  lastError: string | null;
  lastErrorCode: string | null;
  presenceCount: number;
  sessionsCount: number | null;
  cronEnabled: boolean | null;
  cronNext: number | null;
  lastChannelsRefresh: number | null;
  // New dashboard data
  usageResult: SessionsUsageResult | null;
  sessionsResult: SessionsListResult | null;
  skillsReport: SkillStatusReport | null;
  cronJobs: CronJob[];
  cronStatus: CronStatus | null;
  channelsSnapshot: ChannelsStatusSnapshot | null;
  channelsError: string | null;
  debugStatus: StatusSummary | null;
  debugHealth: HealthSummary | null;
  runtimeMeta: RuntimeMeta | null;
  attentionItems: AttentionItem[];
  eventLog: EventLogEntry[];
  overviewLogLines: string[];
  showGatewayToken: boolean;
  showGatewayPassword: boolean;
  onSettingsChange: (next: UiSettings) => void;
  onPasswordChange: (next: string) => void;
  onSessionKeyChange: (next: string) => void;
  onToggleGatewayTokenVisibility: () => void;
  onToggleGatewayPasswordVisibility: () => void;
  onConnect: () => void;
  onRefresh: () => void;
  onNavigate: (tab: string) => void;
  onRefreshLogs: () => void;
};

type ApprovalInsight = {
  ts: number;
  kind: "exec" | "plugin";
  command: string;
  host: string | null;
  agentId: string | null;
  sessionKey: string | null;
  routeSubject: string | null;
  decision: string | null;
  resolvedBy: string | null;
  ask: string | null;
  security: string | null;
  highRisk: boolean;
  reason: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return value;
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value !== "boolean") {
    return null;
  }
  return value;
}

function formatRelativeOrNa(value: number | null): string {
  return value != null ? formatRelativeTimestamp(value) : t("common.na");
}

function readStatusRuntimeVersion(status: StatusSummary | null): string | null {
  return asString(asRecord(status)?.runtimeVersion);
}

function readCodexRuntimeSummary(status: StatusSummary | null): {
  available: boolean;
  sessions: number | null;
  lastActiveAt: number | null;
  acpRuns: number | null;
} {
  const statusRecord = asRecord(status);
  const sessions = asRecord(statusRecord?.sessions);
  const byAgent = Array.isArray(sessions?.byAgent) ? sessions.byAgent : [];
  const codexAgent = byAgent
    .map((entry) => asRecord(entry))
    .find((entry) => asString(entry?.agentId) === "codex");
  const heartbeatAgents = asRecord(statusRecord?.heartbeat);
  const hasCodexHeartbeat = Array.isArray(heartbeatAgents?.agents)
    ? heartbeatAgents.agents
        .map((entry) => asRecord(entry))
        .some((entry) => asString(entry?.agentId) === "codex")
    : false;
  const recent = Array.isArray(codexAgent?.recent) ? codexAgent.recent : [];
  const firstRecent = asRecord(recent[0]);
  const tasks = asRecord(statusRecord?.tasks);
  const byRuntime = asRecord(tasks?.byRuntime);
  return {
    available: Boolean(codexAgent) || hasCodexHeartbeat,
    sessions: asNumber(codexAgent?.count),
    lastActiveAt: asNumber(firstRecent?.updatedAt),
    acpRuns: asNumber(byRuntime?.acp),
  };
}

function classifyApprovalRisk(command: string, security: string | null): boolean {
  if (security && /high|critical|danger/i.test(security)) {
    return true;
  }
  return /\b(rm\s+-rf|sudo\b|git\s+reset\s+--hard|mkfs\b|dd\s+if=|shutdown\b|reboot\b)/i.test(
    command,
  );
}

function resolveApprovalReason(params: { decision: string | null; ask: string | null }): string {
  if (params.decision === "deny") {
    return "Denied by approver decision.";
  }
  if (params.decision === "allow-once") {
    return "Allowed once by operator approval.";
  }
  if (params.decision === "allow-always") {
    return "Allowed persistently by operator approval.";
  }
  if (params.ask === "always") {
    return "Pending: policy requires explicit approval for each action.";
  }
  return "Pending operator decision.";
}

function parseApprovalInsight(events: EventLogEntry[]): ApprovalInsight | null {
  for (const entry of events) {
    const isExec =
      entry.event === "exec.approval.requested" || entry.event === "exec.approval.resolved";
    const isPlugin =
      entry.event === "plugin.approval.requested" || entry.event === "plugin.approval.resolved";
    if (!isExec && !isPlugin) {
      continue;
    }
    const payload = asRecord(entry.payload);
    const request = asRecord(payload?.request);
    const command =
      asString(request?.command) ?? asString(request?.title) ?? asString(payload?.id) ?? "unknown";
    const routeParts = [
      asString(request?.turnSourceChannel),
      asString(request?.turnSourceAccountId),
      asString(request?.turnSourceTo),
      asString(request?.turnSourceThreadId),
    ].filter((value): value is string => Boolean(value));
    const ask = asString(request?.ask);
    const security = asString(request?.security);
    const decision = asString(payload?.decision);
    return {
      ts: entry.ts,
      kind: isPlugin ? "plugin" : "exec",
      command,
      host: asString(request?.host),
      agentId: asString(request?.agentId),
      sessionKey: asString(request?.sessionKey),
      routeSubject: routeParts.length > 0 ? routeParts.join(" · ") : null,
      decision,
      resolvedBy: asString(payload?.resolvedBy),
      ask,
      security,
      highRisk: classifyApprovalRisk(command, security),
      reason: resolveApprovalReason({ decision, ask }),
    };
  }
  return null;
}

export function renderOverview(props: OverviewProps) {
  const snapshot = props.hello?.snapshot as
    | {
        uptimeMs?: number;
        authMode?: "none" | "token" | "password" | "trusted-proxy";
      }
    | undefined;
  const uptime = snapshot?.uptimeMs ? formatDurationHuman(snapshot.uptimeMs) : t("common.na");
  const tickIntervalMs = props.hello?.policy?.tickIntervalMs;
  const tick = tickIntervalMs
    ? `${(tickIntervalMs / 1000).toFixed(tickIntervalMs % 1000 === 0 ? 0 : 1)}s`
    : t("common.na");
  const authMode = snapshot?.authMode;
  const isTrustedProxy = authMode === "trusted-proxy";
  const statusRuntimeVersion = readStatusRuntimeVersion(props.debugStatus);
  const runtimeVersion =
    props.runtimeMeta?.runtimeVersion ?? statusRuntimeVersion ?? props.hello?.server?.version ?? t("common.na");
  const runtimeCommit = props.runtimeMeta?.commit ?? t("common.na");
  const runtimeRef =
    [props.runtimeMeta?.branch, props.runtimeMeta?.tag].filter((value): value is string => Boolean(value)).join(" · ") ||
    t("common.na");
  const runtimePid =
    props.runtimeMeta?.pid != null ? String(props.runtimeMeta.pid) : t("common.na");
  const runtimeEntry = props.runtimeMeta?.entryPath ?? t("common.na");
  const runtimeRoot = props.runtimeMeta?.packageRoot ?? t("common.na");
  const runtimeSource = props.runtimeMeta?.sourceLabel ?? "unknown runtime source";

  const channels = props.channelsSnapshot?.channels ?? {};
  const telegram = asRecord(channels.telegram);
  const telegramAccounts = props.channelsSnapshot?.channelAccounts?.telegram ?? [];
  const telegramAccount = asRecord(telegramAccounts[0]);
  const telegramConfigured =
    asBoolean(telegramAccount?.configured) ??
    asBoolean(telegram?.configured) ??
    false;
  const telegramRunning = asBoolean(telegramAccount?.running) ?? asBoolean(telegram?.running) ?? false;
  const telegramLastInboundAt = asNumber(telegramAccount?.lastInboundAt);
  const telegramLastOutboundAt = asNumber(telegramAccount?.lastOutboundAt);
  const healthChannels = asRecord(props.debugHealth)?.channels;
  const healthTelegram = asRecord(asRecord(healthChannels)?.telegram);
  const telegramProbe = asRecord(healthTelegram?.probe);
  const telegramProbeOk = asBoolean(telegramProbe?.ok);
  const telegramLabel = !telegramConfigured
    ? "OFF"
    : telegramRunning && telegramProbeOk !== false
      ? "ON / OK"
      : telegramRunning
        ? "ON / WARN"
        : "OFF / IDLE";
  const telegramLastError = asString(telegramAccount?.lastError) ?? asString(telegram?.lastError);

  const gatewayHealthOk = asBoolean(asRecord(props.debugHealth)?.ok) ?? false;
  const gatewayLabel = props.connected
    ? gatewayHealthOk
      ? "CONNECTED / HEALTHY"
      : "CONNECTED / DEGRADED"
    : "DISCONNECTED";
  const gatewayProbeLabel = props.lastError ? `probe error: ${props.lastError}` : "probe: ok";

  const codexSummary = readCodexRuntimeSummary(props.debugStatus);
  const codexLabel = codexSummary.available
    ? codexSummary.lastActiveAt
      ? "AVAILABLE / ACTIVE"
      : "AVAILABLE / IDLE"
    : "NOT DETECTED";

  const approvalInsight = parseApprovalInsight(props.eventLog);

  const pairingHint = (() => {
    if (!shouldShowPairingHint(props.connected, props.lastError, props.lastErrorCode)) {
      return null;
    }
    return html`
      <div class="muted" style="margin-top: 8px">
        ${t("overview.pairing.hint")}
        <div style="margin-top: 6px">
          <span class="mono">openclaw devices list</span><br />
          <span class="mono">openclaw devices approve &lt;requestId&gt;</span>
        </div>
        <div style="margin-top: 6px; font-size: 12px;">${t("overview.pairing.mobileHint")}</div>
        <div style="margin-top: 6px">
          <a
            class="session-link"
            href="https://docs.openclaw.ai/web/control-ui#device-pairing-first-connection"
            target=${EXTERNAL_LINK_TARGET}
            rel=${buildExternalLinkRel()}
            title="Device pairing docs (opens in new tab)"
            >Docs: Device pairing</a
          >
        </div>
      </div>
    `;
  })();

  const authHint = (() => {
    const authHintKind = resolveAuthHintKind({
      connected: props.connected,
      lastError: props.lastError,
      lastErrorCode: props.lastErrorCode,
      hasToken: Boolean(props.settings.token.trim()),
      hasPassword: Boolean(props.password.trim()),
    });
    if (authHintKind == null) {
      return null;
    }
    if (authHintKind === "required") {
      return html`
        <div class="muted" style="margin-top: 8px">
          ${t("overview.auth.required")}
          <div style="margin-top: 6px">
            <span class="mono">openclaw dashboard --no-open</span> → tokenized URL<br />
            <span class="mono">openclaw doctor --generate-gateway-token</span> → set token
          </div>
          <div style="margin-top: 6px">
            <a
              class="session-link"
              href="https://docs.openclaw.ai/web/dashboard"
              target=${EXTERNAL_LINK_TARGET}
              rel=${buildExternalLinkRel()}
              title="Control UI auth docs (opens in new tab)"
              >Docs: Control UI auth</a
            >
          </div>
        </div>
      `;
    }
    return html`
      <div class="muted" style="margin-top: 8px">
        ${t("overview.auth.failed", { command: "openclaw dashboard --no-open" })}
        <div style="margin-top: 6px">
          <a
            class="session-link"
            href="https://docs.openclaw.ai/web/dashboard"
            target=${EXTERNAL_LINK_TARGET}
            rel=${buildExternalLinkRel()}
            title="Control UI auth docs (opens in new tab)"
            >Docs: Control UI auth</a
          >
        </div>
      </div>
    `;
  })();

  const insecureContextHint = (() => {
    if (props.connected || !props.lastError) {
      return null;
    }
    const isSecureContext = typeof window !== "undefined" ? window.isSecureContext : true;
    if (isSecureContext) {
      return null;
    }
    if (!shouldShowInsecureContextHint(props.connected, props.lastError, props.lastErrorCode)) {
      return null;
    }
    return html`
      <div class="muted" style="margin-top: 8px">
        ${t("overview.insecure.hint", { url: "http://127.0.0.1:18789" })}
        <div style="margin-top: 6px">
          ${t("overview.insecure.stayHttp", {
            config: "gateway.controlUi.allowInsecureAuth: true",
          })}
        </div>
        <div style="margin-top: 6px">
          <a
            class="session-link"
            href="https://docs.openclaw.ai/gateway/tailscale"
            target=${EXTERNAL_LINK_TARGET}
            rel=${buildExternalLinkRel()}
            title="Tailscale Serve docs (opens in new tab)"
            >Docs: Tailscale Serve</a
          >
          <span class="muted"> · </span>
          <a
            class="session-link"
            href="https://docs.openclaw.ai/web/control-ui#insecure-http"
            target=${EXTERNAL_LINK_TARGET}
            rel=${buildExternalLinkRel()}
            title="Insecure HTTP docs (opens in new tab)"
            >Docs: Insecure HTTP</a
          >
        </div>
      </div>
    `;
  })();

  const currentLocale = isSupportedLocale(props.settings.locale)
    ? props.settings.locale
    : i18n.getLocale();

  return html`
    <section class="grid">
      <div class="card ov-runtime-card">
        <div class="card-title">Enhanced Runtime Baseline</div>
        <div class="card-sub">
          Confirm this is the enhanced runtime candidate, not a default package instance.
        </div>
        <div class="ov-runtime-grid" style="margin-top: 16px;">
          <div class="stat">
            <div class="stat-label">Running version</div>
            <div class="stat-value">${runtimeVersion}</div>
          </div>
          <div class="stat">
            <div class="stat-label">Runtime source</div>
            <div class="stat-value">${runtimeSource}</div>
          </div>
          <div class="stat">
            <div class="stat-label">Commit / ref</div>
            <div class="stat-value">${runtimeCommit} · ${runtimeRef}</div>
          </div>
          <div class="stat">
            <div class="stat-label">Gateway PID</div>
            <div class="stat-value">${runtimePid}</div>
          </div>
        </div>
        <div class="ov-runtime-paths">
          <div class="muted">Entry path</div>
          <code class="mono">${runtimeEntry}</code>
          <div class="muted">Package root</div>
          <code class="mono">${runtimeRoot}</code>
        </div>
      </div>

      <div class="card">
        <div class="card-title">${t("overview.access.title")}</div>
        <div class="card-sub">${t("overview.access.subtitle")}</div>
        <div class="ov-access-grid" style="margin-top: 16px;">
          <label class="field ov-access-grid__full">
            <span>${t("overview.access.wsUrl")}</span>
            <input
              .value=${props.settings.gatewayUrl}
              @input=${(e: Event) => {
                const v = (e.target as HTMLInputElement).value;
                props.onSettingsChange({
                  ...props.settings,
                  gatewayUrl: v,
                  token: v.trim() === props.settings.gatewayUrl.trim() ? props.settings.token : "",
                });
              }}
              placeholder="ws://100.x.y.z:18789"
            />
          </label>
          ${isTrustedProxy
            ? ""
            : html`
                <label class="field">
                  <span>${t("overview.access.token")}</span>
                  <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
                    <input
                      type=${props.showGatewayToken ? "text" : "password"}
                      autocomplete="off"
                      style="flex: 1 1 0%; min-width: 0; box-sizing: border-box;"
                      .value=${props.settings.token}
                      @input=${(e: Event) => {
                        const v = (e.target as HTMLInputElement).value;
                        props.onSettingsChange({ ...props.settings, token: v });
                      }}
                      placeholder="OPENCLAW_GATEWAY_TOKEN"
                    />
                    <button
                      type="button"
                      class="btn btn--icon ${props.showGatewayToken ? "active" : ""}"
                      style="flex-shrink: 0; width: 36px; height: 36px; box-sizing: border-box;"
                      title=${props.showGatewayToken ? "Hide token" : "Show token"}
                      aria-label="Toggle token visibility"
                      aria-pressed=${props.showGatewayToken}
                      @click=${props.onToggleGatewayTokenVisibility}
                    >
                      ${props.showGatewayToken ? icons.eye : icons.eyeOff}
                    </button>
                  </div>
                </label>
                <label class="field">
                  <span>${t("overview.access.password")}</span>
                  <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
                    <input
                      type=${props.showGatewayPassword ? "text" : "password"}
                      autocomplete="off"
                      style="flex: 1 1 0%; min-width: 0; width: 100%; box-sizing: border-box;"
                      .value=${props.password}
                      @input=${(e: Event) => {
                        const v = (e.target as HTMLInputElement).value;
                        props.onPasswordChange(v);
                      }}
                      placeholder="system or shared password"
                    />
                    <button
                      type="button"
                      class="btn btn--icon ${props.showGatewayPassword ? "active" : ""}"
                      style="flex-shrink: 0; width: 36px; height: 36px; box-sizing: border-box;"
                      title=${props.showGatewayPassword ? "Hide password" : "Show password"}
                      aria-label="Toggle password visibility"
                      aria-pressed=${props.showGatewayPassword}
                      @click=${props.onToggleGatewayPasswordVisibility}
                    >
                      ${props.showGatewayPassword ? icons.eye : icons.eyeOff}
                    </button>
                  </div>
                </label>
              `}
          <label class="field">
            <span>${t("overview.access.sessionKey")}</span>
            <input
              .value=${props.settings.sessionKey}
              @input=${(e: Event) => {
                const v = (e.target as HTMLInputElement).value;
                props.onSessionKeyChange(v);
              }}
            />
          </label>
          <label class="field">
            <span>${t("overview.access.language")}</span>
            <select
              .value=${currentLocale}
              @change=${(e: Event) => {
                const v = (e.target as HTMLSelectElement).value as Locale;
                void i18n.setLocale(v);
                props.onSettingsChange({ ...props.settings, locale: v });
              }}
            >
              ${SUPPORTED_LOCALES.map((loc) => {
                const key = loc.replace(/-([a-zA-Z])/g, (_, c) => c.toUpperCase());
                return html`<option value=${loc} ?selected=${currentLocale === loc}>
                  ${t(`languages.${key}`)}
                </option>`;
              })}
            </select>
          </label>
        </div>
        <div class="row" style="margin-top: 14px;">
          <button class="btn" @click=${() => props.onConnect()}>${t("common.connect")}</button>
          <button class="btn" @click=${() => props.onRefresh()}>${t("common.refresh")}</button>
          <span class="muted"
            >${isTrustedProxy
              ? t("overview.access.trustedProxy")
              : t("overview.access.connectHint")}</span
          >
        </div>
        ${!props.connected
          ? html`
              <div class="login-gate__help" style="margin-top: 16px;">
                <div class="login-gate__help-title">${t("overview.connection.title")}</div>
                <ol class="login-gate__steps">
                  <li>
                    ${t("overview.connection.step1")}
                    ${renderConnectCommand("openclaw gateway run")}
                  </li>
                  <li>
                    ${t("overview.connection.step2")} ${renderConnectCommand("openclaw dashboard")}
                  </li>
                  <li>${t("overview.connection.step3")}</li>
                  <li>
                    ${t("overview.connection.step4")}<code
                      >openclaw doctor --generate-gateway-token</code
                    >
                  </li>
                </ol>
                <div class="login-gate__docs">
                  ${t("overview.connection.docsHint")}
                  <a
                    class="session-link"
                    href="https://docs.openclaw.ai/web/dashboard"
                    target="_blank"
                    rel="noreferrer"
                    >${t("overview.connection.docsLink")}</a
                  >
                </div>
              </div>
            `
          : nothing}
      </div>

      <div class="card">
        <div class="card-title">${t("overview.snapshot.title")}</div>
        <div class="card-sub">${t("overview.snapshot.subtitle")}</div>
        <div class="stat-grid" style="margin-top: 16px;">
          <div class="stat">
            <div class="stat-label">${t("overview.snapshot.status")}</div>
            <div class="stat-value ${props.connected ? "ok" : "warn"}">
              ${props.connected ? t("common.ok") : t("common.offline")}
            </div>
          </div>
          <div class="stat">
            <div class="stat-label">${t("overview.snapshot.uptime")}</div>
            <div class="stat-value">${uptime}</div>
          </div>
          <div class="stat">
            <div class="stat-label">${t("overview.snapshot.tickInterval")}</div>
            <div class="stat-value">${tick}</div>
          </div>
          <div class="stat">
            <div class="stat-label">${t("overview.snapshot.lastChannelsRefresh")}</div>
            <div class="stat-value">
              ${props.lastChannelsRefresh
                ? formatRelativeTimestamp(props.lastChannelsRefresh)
                : t("common.na")}
            </div>
          </div>
        </div>
        ${props.lastError
          ? html`<div class="callout danger" style="margin-top: 14px;">
              <div>${props.lastError}</div>
              ${pairingHint ?? ""} ${authHint ?? ""} ${insecureContextHint ?? ""}
            </div>`
          : html`
              <div class="callout" style="margin-top: 14px">
                ${t("overview.snapshot.channelsHint")}
              </div>
            `}
      </div>
    </section>

    <div class="ov-section-divider"></div>

    <section class="grid">
      <div class="card ov-remote-card">
        <div class="card-title">Remote Runtime Status</div>
        <div class="card-sub">Telegram / Gateway / Codex runtime signals from live gateway state.</div>
        <div class="ov-remote-grid">
          <div class="ov-remote-item">
            <div class="ov-remote-name">Telegram</div>
            <div class="ov-remote-status ${telegramLabel.includes("OK") ? "ok" : "warn"}">
              ${telegramLabel}
            </div>
            <div class="ov-remote-meta">Inbound: ${formatRelativeOrNa(telegramLastInboundAt)}</div>
            <div class="ov-remote-meta">Outbound: ${formatRelativeOrNa(telegramLastOutboundAt)}</div>
            <div class="ov-remote-meta">
              ${telegramLastError ? `Last error: ${telegramLastError}` : "Last callback: n/a"}
            </div>
          </div>

          <div class="ov-remote-item">
            <div class="ov-remote-name">Gateway</div>
            <div class="ov-remote-status ${gatewayLabel.includes("HEALTHY") ? "ok" : "warn"}">
              ${gatewayLabel}
            </div>
            <div class="ov-remote-meta">${gatewayProbeLabel}</div>
            <div class="ov-remote-meta">Listen: ${props.settings.gatewayUrl || t("common.na")}</div>
            <div class="ov-remote-meta">PID: ${runtimePid}</div>
          </div>

          <div class="ov-remote-item">
            <div class="ov-remote-name">Codex / Pro</div>
            <div class="ov-remote-status ${codexSummary.available ? "ok" : "warn"}">
              ${codexLabel}
            </div>
            <div class="ov-remote-meta">
              Last call: ${formatRelativeOrNa(codexSummary.lastActiveAt)}
            </div>
            <div class="ov-remote-meta">
              Sessions: ${codexSummary.sessions != null ? codexSummary.sessions : t("common.na")}
            </div>
            <div class="ov-remote-meta">
              ACP runtime tasks: ${codexSummary.acpRuns != null ? codexSummary.acpRuns : t("common.na")}
            </div>
          </div>
        </div>
        ${props.channelsError
          ? html`<div class="callout danger" style="margin-top: 12px">${props.channelsError}</div>`
          : nothing}
      </div>
    </section>

    <div class="ov-section-divider"></div>

    <section class="grid">
      <div class="card ov-auth-card">
        <div class="card-title">Authorization / Approval Insight</div>
        <div class="card-sub">
          Most recent sensitive action route, execution subject, and allow/deny rationale.
        </div>
        ${approvalInsight
          ? html`
              <div class="ov-auth-grid">
                <div class="stat">
                  <div class="stat-label">Initiator subject</div>
                  <div class="stat-value">${approvalInsight.routeSubject ?? approvalInsight.sessionKey ?? "n/a"}</div>
                </div>
                <div class="stat">
                  <div class="stat-label">Execution subject</div>
                  <div class="stat-value">
                    ${(approvalInsight.host ?? "gateway") + " · " + (approvalInsight.agentId ?? "main")}
                  </div>
                </div>
                <div class="stat">
                  <div class="stat-label">Decision</div>
                  <div class="stat-value ${approvalInsight.decision === "deny" ? "warn" : "ok"}">
                    ${approvalInsight.decision ?? "pending"}
                  </div>
                </div>
                <div class="stat">
                  <div class="stat-label">Resolved by</div>
                  <div class="stat-value">${approvalInsight.resolvedBy ?? "pending"}</div>
                </div>
              </div>
              <div class="ov-auth-detail">
                <div><span class="muted">Action:</span> <code class="mono">${approvalInsight.command}</code></div>
                <div><span class="muted">Policy:</span> ask=${approvalInsight.ask ?? "default"} · security=${approvalInsight.security ?? "n/a"}</div>
                <div><span class="muted">Risk gate:</span> ${approvalInsight.highRisk ? "high-risk restriction matched" : "no high-risk restriction match"}</div>
                <div><span class="muted">Why:</span> ${approvalInsight.reason}</div>
                <div><span class="muted">When:</span> ${formatRelativeTimestamp(approvalInsight.ts)}</div>
              </div>
            `
          : html`
              <div class="callout" style="margin-top: 14px">
                No recent approval events in the live event buffer. Current auth role:
                <code class="mono">${props.hello?.auth?.role ?? "operator"}</code>.
              </div>
            `}
      </div>
    </section>

    <div class="ov-section-divider"></div>

    ${renderOverviewCards({
      usageResult: props.usageResult,
      sessionsResult: props.sessionsResult,
      skillsReport: props.skillsReport,
      cronJobs: props.cronJobs,
      cronStatus: props.cronStatus,
      presenceCount: props.presenceCount,
      onNavigate: props.onNavigate,
    })}
    ${renderOverviewAttention({ items: props.attentionItems })}

    <div class="ov-section-divider"></div>

    <div class="ov-bottom-grid">
      ${renderOverviewEventLog({
        events: props.eventLog,
      })}
      ${renderOverviewLogTail({
        lines: props.overviewLogLines,
        onRefreshLogs: props.onRefreshLogs,
      })}
    </div>
  `;
}
