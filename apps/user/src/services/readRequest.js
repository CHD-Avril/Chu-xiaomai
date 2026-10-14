// Only reads are retried. A timed-out submission/vote may already have committed.
const TRANSIENT_STATUS = new Set([408, 500, 502, 503, 504]);

export function isTransientReadError(error) {
  if (TRANSIENT_STATUS.has(error?.status)) return true;
  return !error?.status && /CLIENT_TIMEOUT|timeout|timed out|AbortError|Failed to fetch|fetch failed|NetworkError|network request failed|Load failed/i.test(
    `${error?.code || ""} ${error?.message || ""}`,
  );
}

export async function readRequest(operation, request, { timeoutMs = 10000, retryDelayMs = 500 } = {}) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    let timer;
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => request(controller.signal)),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            const error = Object.assign(new Error("读取请求超时"), { code: "CLIENT_TIMEOUT" });
            reject(error);
            controller.abort();
          }, timeoutMs);
        }),
      ]);
      if (result.error) throw Object.assign(new Error(result.error.message || "读取失败"), result.error, { status: result.status });
      return result.data;
    } catch (cause) {
      const error = Object.assign(new Error(cause?.message || "读取失败"), {
        code: cause?.code,
        status: cause?.status,
        operation,
      });
      const offline = typeof navigator !== "undefined" && navigator.onLine === false;
      if (attempt || offline || !isTransientReadError(error)) throw error;
    } finally {
      clearTimeout(timer);
    }
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }
}
