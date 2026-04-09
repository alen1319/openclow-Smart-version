import { describe, expect, it, vi } from "vitest";
import type { DeliveryParcel } from "../../domain/delivery/Parcel.js";
import { TelegramProvider } from "./TelegramProvider.js";

function createParcel(overrides: Partial<DeliveryParcel> = {}): DeliveryParcel {
  return {
    traceId: "trace-tg-1",
    target: {
      protocol: "telegram",
      recipientId: "12345",
      threadId: "77",
    },
    content: {
      text: "hello",
      buttons: [{ label: "Approve", value: "approve:1" }],
    },
    options: {
      importance: "normal",
    },
    ...overrides,
  };
}

describe("TelegramProvider", () => {
  it("sends parcel through Telegram bot and returns message id", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 101 });
    const provider = new TelegramProvider({ sendMessage });

    const result = await provider.send(createParcel());
    expect(result.success).toBe(true);
    expect(sendMessage).toHaveBeenCalledWith(
      "12345",
      "hello",
      expect.objectContaining({
        message_thread_id: 77,
        reply_markup: {
          inline_keyboard: [[{ text: "Approve", callback_data: "approve:1" }]],
        },
      }),
    );
  });

  it("returns failure outcome on telegram send error", async () => {
    const sendMessage = vi.fn().mockRejectedValue(new Error("429 too many requests"));
    const provider = new TelegramProvider({ sendMessage });

    const result = await provider.send(createParcel());
    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.error.message).toContain("Telegram delivery failed");
  });
});
