/**
 * LogClaw HTTP client for Cloudflare Workers.
 * Uses the Worker's global fetch (not node-fetch).
 * API key comes from the authenticated session props, not env vars.
 */

interface RequestOptions {
  method?: string;
  body?: unknown;
  timeout?: number;
}

export function createLogClawClient(endpoint: string, apiKey: string) {
  async function logclawFetch<T = unknown>(
    path: string,
    opts: RequestOptions = {},
  ): Promise<T> {
    const url = `${endpoint}${path}`;
    const { method = "GET", body, timeout = 15000 } = opts;

    const headers: Record<string, string> = {
      "x-logclaw-api-key": apiKey,
      "content-type": "application/json",
    };

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`LogClaw API ${res.status}: ${text.slice(0, 200)}`);
    }

    return res.json() as Promise<T>;
  }

  return { logclawFetch };
}
