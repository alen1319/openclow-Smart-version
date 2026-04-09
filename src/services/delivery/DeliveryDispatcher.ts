import { Failure, type Outcome } from "../../core/outcome.js";
import type { DeliveryParcel, DeliveryProtocol } from "../../domain/delivery/Parcel.js";
import { TraceProvider } from "../../observability/tracing/TraceProvider.js";

export interface IDeliveryProvider {
  protocol: DeliveryProtocol;
  send(parcel: DeliveryParcel): Promise<Outcome<string>>;
}

export type DeliveryDiagnosticsEvent = {
  parcel: DeliveryParcel;
  reason: string;
};

export type DeliveryDispatcherOptions = {
  diagnosticsHook?: (event: DeliveryDiagnosticsEvent) => Promise<void> | void;
  logger?: (line: string) => void;
};

function normalizeText(value: string): string {
  return value.replace(/\r\n?/g, "\n").trimEnd();
}

function normalizeParcel(parcel: DeliveryParcel): DeliveryParcel {
  const content = {
    ...parcel.content,
    text: normalizeText(parcel.content.text),
  };
  return {
    ...parcel,
    traceId: parcel.traceId.trim(),
    target: {
      ...parcel.target,
      recipientId: parcel.target.recipientId.trim(),
      threadId: parcel.target.threadId?.trim() || undefined,
    },
    content,
  };
}

function validateParcel(parcel: DeliveryParcel): string | undefined {
  if (!parcel.traceId) {
    return "traceId is required";
  }
  if (!parcel.target.recipientId) {
    return "target.recipientId is required";
  }
  if (!parcel.content.text) {
    return "content.text is required";
  }
  if (parcel.options?.ttl !== undefined && parcel.options.ttl <= 0) {
    return "options.ttl must be greater than 0";
  }
  return undefined;
}

export class DeliveryDispatcher {
  private readonly providers = new Map<DeliveryProtocol, IDeliveryProvider>();
  private readonly diagnosticsHook: DeliveryDispatcherOptions["diagnosticsHook"];
  private readonly logger: (line: string) => void;

  constructor(options: DeliveryDispatcherOptions = {}) {
    this.diagnosticsHook = options.diagnosticsHook;
    this.logger = options.logger ?? ((line) => console.log(line));
  }

  registerProvider(provider: IDeliveryProvider): void {
    this.providers.set(provider.protocol, provider);
  }

  async dispatch(parcel: DeliveryParcel): Promise<Outcome<string>> {
    const normalizedParcel = normalizeParcel(parcel);
    const invalidReason = validateParcel(normalizedParcel);
    if (invalidReason) {
      return Failure(`Invalid delivery parcel: ${invalidReason}`);
    }

    const provider = this.providers.get(normalizedParcel.target.protocol);
    if (!provider) {
      const failure = Failure(
        `No provider registered for protocol: ${normalizedParcel.target.protocol}`,
      );
      await this.handleUrgentFailure(normalizedParcel, failure.error.message);
      return failure;
    }

    this.logger(
      `[Delivery] Dispatching parcel ${normalizedParcel.traceId} via ${normalizedParcel.target.protocol}`,
    );
    TraceProvider.record(normalizedParcel.traceId, "DeliveryDispatcher.dispatch", {
      protocol: normalizedParcel.target.protocol,
      recipientId: normalizedParcel.target.recipientId,
    });

    try {
      const result = await provider.send(normalizedParcel);
      if (!result.success) {
        TraceProvider.record(normalizedParcel.traceId, "DeliveryDispatcher.dispatch", {
          status: "FAILURE",
          reason: result.error.message,
        });
        await this.handleUrgentFailure(normalizedParcel, result.error.message);
      } else {
        TraceProvider.record(normalizedParcel.traceId, "DeliveryDispatcher.dispatch", {
          status: "SUCCESS",
          messageId: result.data,
        });
      }
      return result;
    } catch (error) {
      const failure = Failure(
        `Delivery provider '${provider.protocol}' threw: ${this.describeError(error)}`,
      );
      TraceProvider.record(normalizedParcel.traceId, "DeliveryDispatcher.dispatch", {
        status: "THROW",
        reason: failure.error.message,
      });
      await this.handleUrgentFailure(normalizedParcel, failure.error.message);
      return failure;
    }
  }

  private async handleUrgentFailure(parcel: DeliveryParcel, reason: string): Promise<void> {
    if (parcel.options?.importance !== "urgent") {
      return;
    }
    await this.diagnosticsHook?.({ parcel, reason });
  }

  private describeError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }
}
