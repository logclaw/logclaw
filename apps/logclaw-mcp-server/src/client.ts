/**
 * LogClaw HTTP client — talks to the auth proxy.
 * All requests include x-logclaw-api-key header for tenant isolation.
 */

const endpoint = process.env.LOGCLAW_ENDPOINT || "https://ticket.logclaw.ai";
const apiKey = process.env.LOGCLAW_API_KEY || "";

if (!apiKey) {
  console.error(
    "LOGCLAW_API_KEY is required. Set it in your environment:\n" +
    '  export LOGCLAW_API_KEY="lc_proj_..."'
  );
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  timeout?: number;
}

export async function logclawFetch<T = unknown>(
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

/**
 * Ticketing Agent API — incidents, audit, health.
 * Auth proxy routes /ticketing/* → ticketing agent.
 */
export async function ticketingApi<T = unknown>(
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  return logclawFetch<T>(`/ticketing${path}`, opts);
}
