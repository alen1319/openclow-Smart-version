/**
 * @description 智慧版统一结果模型，取代 try-catch 驱动的逻辑流
 */
export type Outcome<T = void, E = Error> = OutcomeSuccess<T> | OutcomeFailure<E>;

export type OutcomeSuccess<T = void> = {
  success: true;
  data: T;
  timestamp: number;
};

export type OutcomeFailure<E = Error> = {
  success: false;
  error: E;
  timestamp: number;
};

export const Success = <T>(data: T): Outcome<T> => ({
  success: true,
  data,
  timestamp: Date.now(),
});

export const Failure = (error: Error | string): OutcomeFailure => ({
  success: false,
  error: typeof error === "string" ? new Error(error) : error,
  timestamp: Date.now(),
});
