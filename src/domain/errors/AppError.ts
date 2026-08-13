export type AppErrorCategory =
  'VALIDATION' | 'CONFLICT' | 'STORAGE' | 'PLATFORM' | 'UNEXPECTED';

type AppErrorOptions = {
  category: AppErrorCategory;
  retryable: boolean;
  cause?: unknown;
};

/**
 * The only error type whose message may cross the UI boundary. `cause` is
 * intentionally retained in memory only and must never be rendered or
 * persisted because platform/SQL errors may contain paths or user data.
 */
export class AppError extends Error {
  readonly cause?: unknown;

  constructor(
    readonly code: string,
    readonly safeMessage: string,
    readonly options: AppErrorOptions,
  ) {
    super(safeMessage);
    this.name = 'AppError';
    this.cause = options.cause;
  }

  get category(): AppErrorCategory {
    return this.options.category;
  }

  get retryable(): boolean {
    return this.options.retryable;
  }
}

export function safeErrorMessage(
  error: unknown,
  fallbackMessage: string,
  fallbackCode: string,
): string {
  const safeMessage =
    error instanceof AppError ? error.safeMessage : fallbackMessage;
  const code = error instanceof AppError ? error.code : fallbackCode;
  return `${safeMessage}（错误码：${code}）`;
}
