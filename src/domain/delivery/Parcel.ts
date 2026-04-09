/**
 * @description 投递内容载体：支持文本、按钮、多媒体
 */
export interface DeliveryContent {
  text: string;
  buttons?: Array<{ label: string; value: string }>;
  media?: { type: "image" | "file"; url: string };
}

export type DeliveryProtocol = "telegram" | "web" | "webhook";

/**
 * @description 投递包裹：包含目标地址和标准化内容
 */
export interface DeliveryParcel {
  readonly traceId: string;
  readonly target: {
    protocol: DeliveryProtocol;
    recipientId: string;
    threadId?: string;
  };
  readonly content: DeliveryContent;
  readonly options?: {
    importance: "low" | "normal" | "urgent";
    ttl?: number;
  };
}
