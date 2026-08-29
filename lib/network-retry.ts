const defaultAttempts = 3;
const defaultBaseDelayMs = 250;

type FetchWithNetworkRetryOptions = {
  attempts?: number;
  baseDelayMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (delayMs: number) => Promise<void>;
  timeoutMs: number;
};

export async function fetchWithNetworkRetry(
  input: string | URL | Request,
  init: RequestInit,
  options: FetchWithNetworkRetryOptions
) {
  const attempts = Math.max(1, options.attempts ?? defaultAttempts);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? defaultBaseDelayMs);
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? delay;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

    try {
      return await fetchImpl(input, { ...init, signal: controller.signal });
    } catch (error) {
      if (attempt === attempts || !isRetryableNetworkError(error)) {
        throw error;
      }
    } finally {
      clearTimeout(timeout);
    }

    await sleep(baseDelayMs * 2 ** (attempt - 1));
  }

  throw new Error("Network retry loop exited unexpectedly");
}

export function isRetryableNetworkError(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") {
    return true;
  }

  if (!(error instanceof TypeError) || error.message !== "fetch failed") {
    return false;
  }

  const cause = error.cause;
  if (!cause || typeof cause !== "object" || !("code" in cause)) {
    return true;
  }

  return new Set([
    "EAI_AGAIN",
    "ECONNREFUSED",
    "ECONNRESET",
    "ENETUNREACH",
    "ETIMEDOUT",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_HEADERS_TIMEOUT",
    "UND_ERR_SOCKET"
  ]).has(String(cause.code));
}

function delay(delayMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}
