export interface RetryOptions {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  onRetry?: (attempt: number, error: Error, nextDelayMs: number) => void;
}

/**
 * Executes a function with exponential backoff retry logic.
 * Delay doubles each attempt: initialDelayMs → 2x → 4x → ... up to maxDelayMs
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const { maxRetries, initialDelayMs, maxDelayMs, onRetry } = options;

  let lastError: Error = new Error('No attempts made');
  let delay = initialDelayMs;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === maxRetries) {
        break;
      }

      if (onRetry) {
        onRetry(attempt, lastError, delay);
      }

      await sleep(delay);

      // Exponential backoff with cap
      delay = Math.min(delay * 2, maxDelayMs);
    }
  }

  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
