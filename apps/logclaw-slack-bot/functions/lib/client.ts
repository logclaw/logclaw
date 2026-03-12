/**
 * HTTP client for the LogClaw ticketing-agent API.
 * Calls ticket.logclaw.ai (public endpoint, auth-proxy validated).
 * Adapted from apps/logclaw-mcp-server/src/client.ts for Deno.
 */

const DEFAULT_ENDPOINT = "https://ticket.logclaw.ai";

interface RequestOptions {
  method?: string;
  body?: unknown;
  timeout?: number;
}

export function createClient(apiKey: string, endpoint?: string) {
  const baseUrl = endpoint || DEFAULT_ENDPOINT;

  async function logclawFetch<T = unknown>(
    path: string,
    opts: RequestOptions = {},
  ): Promise<T> {
    const url = `${baseUrl}${path}`;
    const { method = "GET", body, timeout = 15_000 } = opts;

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
