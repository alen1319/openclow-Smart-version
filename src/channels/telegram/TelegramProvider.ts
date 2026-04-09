import { Failure, Success, type Outcome } from "../../core/outcome.js";
import type { DeliveryParcel } from "../../domain/delivery/Parcel.js";
import type { IDeliveryProvider } from "../../services/delivery/DeliveryDispatcher.js";

type TelegramBotLike = {
  sendMessage(
    chatId: string,
    text: string,
    options?: {
      message_thread_id?: number;
      reply_markup?: {
        inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
      };
    },
  ): Promise<{ message_id: string | number }>;
};

export class TelegramProvider implements IDeliveryProvider {
  readonly protocol = "telegram" as const;

  constructor(private readonly botInstance: TelegramBotLike) {}

  async send(parcel: DeliveryParcel): Promise<Outcome<string>> {
    try {
      const sentMsg = await this.botInstance.sendMessage(
        parcel.target.recipientId,
        this.transformText(parcel),
        this.transformOptions(parcel),
      );
      return Success(String(sentMsg.message_id));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return Failure(`Telegram delivery failed: ${message}`);
    }
  }

  private transformText(parcel: DeliveryParcel): string {
    const mediaLine = parcel.content.media?.url ? `\n${parcel.content.media.url}` : "";
    return `${parcel.content.text}${mediaLine}`.trim();
  }

  private transformOptions(parcel: DeliveryParcel): {
    message_thread_id?: number;
    reply_markup?: {
      inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
    };
  } {
    const threadIdRaw = parcel.target.threadId?.trim();
    const threadId =
      threadIdRaw && /^\d+$/.test(threadIdRaw) ? Number.parseInt(threadIdRaw, 10) : undefined;
    const replyMarkup = this.transformButtons(parcel.content.buttons);
    return {
      message_thread_id: threadId,
      reply_markup: replyMarkup,
    };
  }

  private transformButtons(buttons?: Array<{ label: string; value: string }>):
    | {
        inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
      }
    | undefined {
    if (!buttons || buttons.length === 0) {
      return undefined;
    }
    return {
      inline_keyboard: buttons.map((button) => [
        {
          text: button.label,
          callback_data: button.value,
        },
      ]),
    };
  }
}
