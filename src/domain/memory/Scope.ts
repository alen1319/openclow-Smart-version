/**
 * @description 记忆作用域层级定义
 */
export enum MemoryScopeType {
  GLOBAL = 10,
  GROUP = 20,
  USER = 30,
  SESSION = 40,
}

export interface MemoryEntry {
  key: string;
  value: unknown;
  scope: MemoryScopeType;
  ownerId: string;
  updatedAt: number;
  /**
   * Optional expiry boundary (epoch milliseconds).
   * Used by SESSION scope to avoid long-term state pollution.
   */
  expiresAt?: number;
}
