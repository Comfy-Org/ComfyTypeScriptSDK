/**
 * `setTimeout`-based sleep that rejects immediately when `signal` aborts,
 * instead of only resolving after the full delay.
 *
 * Every internal wait the `sdk` layer schedules on the caller's behalf — the
 * adaptive poll backoff in `Job.wait`, the reconnect pause in `Job.events`,
 * the queue-full retry pause in `Comfy.submit` — uses this instead of a
 * plain sleep. Without it, an aborted `AbortSignal` would only cancel the
 * *current* fetch; the loop would still wake up on its own timer and start
 * another iteration. Composing the signal into the wait itself is what
 * makes an abort actually stop the loop promptly.
 */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(abortReason(signal));
  }
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason(signal!));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("This operation was aborted", "AbortError");
}
