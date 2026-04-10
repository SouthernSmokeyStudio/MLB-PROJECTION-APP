// ---------------------------------------------------------------------------
// Server-side fetch with timeout protection
// ---------------------------------------------------------------------------
// Every upstream fetch in the adapter layer routes through this wrapper.
// It applies AbortSignal.timeout so no single hanging API call can stall
// the entire /api/slate-snapshot response indefinitely.
//
// AbortSignal.timeout is native in Node >= 17.3. The repo requires >= 20.
// ---------------------------------------------------------------------------

/** Default timeout for upstream API fetches (15 seconds). */
export const DEFAULT_FETCH_TIMEOUT_MS = 15_000;

/**
 * Wrapper around global fetch that applies a timeout via AbortSignal.
 *
 * Returns a `Response` on success, or `null` if the request times out or
 * encounters a network-level error (DNS failure, connection reset, etc.).
 * The `error` property on the return carries the reason string.
 *
 * This converts thrown errors into a returnable result so that adapter
 * functions can handle timeouts through the same `if (!response)` path
 * they already use for `!response.ok`.
 */
export const fetchWithTimeout = async (
  input: string | URL | Request,
  init?: RequestInit & { readonly timeoutMs?: number }
): Promise<{ response: Response; error: null } | { response: null; error: string }> => {
  const timeoutMs = init?.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);

  // If the caller already provided a signal (e.g., for manual cancellation),
  // combine it with our timeout using AbortSignal.any.
  const signal = init?.signal
    ? AbortSignal.any([init.signal, timeoutSignal])
    : timeoutSignal;

  const { timeoutMs: _, ...restInit } = init ?? {};

  try {
    const response = await fetch(input, {
      ...restInit,
      signal
    });

    return { response, error: null };
  } catch (thrown: unknown) {
    if (thrown instanceof DOMException && thrown.name === "TimeoutError") {
      return {
        response: null,
        error: `request timed out after ${timeoutMs}ms`
      };
    }

    if (thrown instanceof DOMException && thrown.name === "AbortError") {
      return {
        response: null,
        error: "request was aborted"
      };
    }

    return {
      response: null,
      error: thrown instanceof Error ? thrown.message : "unknown fetch error"
    };
  }
};
