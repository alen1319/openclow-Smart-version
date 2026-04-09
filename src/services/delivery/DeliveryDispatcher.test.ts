import { describe, expect, it, vi } from "vitest";
import { Failure, Success } from "../../core/outcome.js";
import type { DeliveryParcel } from "../../domain/delivery/Parcel.js";
import { DeliveryDispatcher, type IDeliveryProvider } from "./DeliveryDispatcher.js";

function createParcel(overrides: Partial<DeliveryParcel> = {}): DeliveryParcel {
  return {
    traceId: "trace-delivery-1",
    target: {
      protocol: "telegram",
      recipientId: "12345",
    },
    content: {
      text: "hello",
    },
    options: {
      importance: "normal",
    },
    ...overrides,
  };
}

describe("DeliveryDispatcher", () => {
  it("normalizes text and dispatches to registered provider", async () => {
    let received: DeliveryParcel | undefined;
    const provider: IDeliveryProvider = {
      protocol: "telegram",
      send: vi.fn(async (parcel) => {
        received = parcel;
        return Success("msg-1");
      }),
    };
    const dispatcher = new DeliveryDispatcher({ logger: vi.fn() });
    dispatcher.registerProvider(provider);

    const result = await dispatcher.dispatch(
      createParcel({
        content: { text: "hello\r\nworld   " },
      }),
    );

    expect(result.success).toBe(true);
    expect(received?.content.text).toBe("hello\nworld");
  });

  it("returns failure when provider is missing", async () => {
    const dispatcher = new DeliveryDispatcher({ logger: vi.fn() });
    const result = await dispatcher.dispatch(
      createParcel({ target: { protocol: "web", recipientId: "x" } }),
    );

    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.error.message).toContain("No provider registered");
  });

  it("triggers diagnostics for urgent failed deliveries", async () => {
    const diagnosticsHook = vi.fn();
    const provider: IDeliveryProvider = {
      protocol: "telegram",
      send: vi.fn(async () => Failure("network down")),
    };
    const dispatcher = new DeliveryDispatcher({ diagnosticsHook, logger: vi.fn() });
    dispatcher.registerProvider(provider);

    const result = await dispatcher.dispatch(
      createParcel({
        options: { importance: "urgent" },
      }),
    );

    expect(result.success).toBe(false);
    expect(diagnosticsHook).toHaveBeenCalledTimes(1);
  });
});
